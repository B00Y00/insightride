// ============================================================
// InsightRide — slide tagging (server-only)
// File location in repo: src/lib/tagslides.js
// Used by: POST /api/interview/tag-slides (manual button) and
//          POST /api/summarize (runs automatically at the end of Run AI).
//
// tagInterview(supabase, interviewId) — supabase must be a SERVICE-ROLE client.
//  1. Slices the diarized transcript by the tablet's slide_timeline: every
//     utterance is stamped with the slide on screen when it was spoken.
//  2. Works out which speaker label(s) are the interviewee, separately for each
//     recording part (resumed interviews: part 2 speakers are labelled A2, B2...).
//     Order: Run AI's speaker_mapping -> single speaker -> Haiku -> word-count heuristic.
//  3. slide_segments: formal answer (voice slides), incidental speech (tap slides),
//     commentary (passive slides), pre_interview.
//  4. slide_fields: tap answers COPIED from survey_responses by code (never
//     re-extracted); voice answers get a Haiku gist + verbatim quote + timestamp.
//  5. Registers each deck question in contracts.extraction_schema (labels in the
//     deck's DEFAULT language, source "deck") and merges slide_fields into
//     structured_data.extracted_fields so statistics and the HelpBot see them.
// ============================================================

const MODEL = "claude-haiku-4-5-20251001";
const TYPE_MAP = { single_choice: "single_select", multi_select: "multi_select", scale: "scale", text: "free_text", voice: "free_text" };

export class TagError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

function L(field, lang) {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field[lang] || field.en || Object.values(field)[0] || "";
}
function asArray(v) {
  if (!v) return [];
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch (e) {
      return [];
    }
  }
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.utterances)) return v.utterances;
  return [];
}
function asObject(v) {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch (e) {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function num(v, d) {
  const n = Number(v);
  return isFinite(n) ? n : d;
}
function words(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

async function haiku(apiKey, system, userText, tool, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 3000, system, messages: [{ role: "user", content: userText }], tools: [tool], tool_choice: { type: "tool", name: tool.name } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || "AI request failed (" + res.status + ")");
  const block = (j.content || []).find((b) => b.type === "tool_use");
  return { input: block ? block.input : null, usage: j.usage || null };
}

const SPEAKER_TOOL = {
  name: "identify_speakers",
  description: "Decide which diarization label belongs to the interviewee.",
  input_schema: {
    type: "object",
    properties: { interviewee_speaker: { type: "string", description: "The speaker label (e.g. A or B2) of the interviewee" }, confidence: { type: "number" } },
    required: ["interviewee_speaker", "confidence"],
  },
};
const VOICE_TOOL = {
  name: "tag_voice_answers",
  description: "For each voice question, summarise the interviewee's spoken answer using only the provided segment text.",
  input_schema: {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question_id: { type: "string" },
            mentioned: { type: "boolean", description: "false if the interviewee did not actually answer this question in the segment" },
            gist: { type: "string", description: "One or two sentences capturing the answer in the interviewee's own terms. Empty if not answered." },
            evidence_quote: { type: "string", description: "A short VERBATIM quote copied exactly from the interviewee text in the segment. Empty if not answered." },
            sentiment: { type: "string", enum: ["very_negative", "negative", "neutral", "positive", "very_positive", "unclear"] },
          },
          required: ["question_id", "mentioned", "gist", "evidence_quote", "sentiment"],
        },
      },
    },
    required: ["answers"],
  },
};

// ── Timeline -> windows -> utterance assignment ──
export function buildWindows(timeline, endMs) {
  const tl = asArray(timeline)
    .map((e) => ({ slide_id: e && e.slide_id, at_ms: num(e && e.at_ms, 0) }))
    .filter((e) => e.slide_id)
    .sort((a, b) => a.at_ms - b.at_ms);
  return tl.map((e, i) => ({ slide_id: e.slide_id, start_ms: e.at_ms, end_ms: i + 1 < tl.length ? tl[i + 1].at_ms : Math.max(endMs, e.at_ms + 1) }));
}
export function assignUtterances(raw, windows) {
  return raw
    .map((u) => {
      const start = num(u.start, num(u.start_ms, 0));
      const end = num(u.end, num(u.end_ms, start));
      const mid = (start + end) / 2;
      let w = null;
      for (const x of windows) {
        if (mid >= x.start_ms && mid < x.end_ms) {
          w = x;
          break;
        }
      }
      if (!w && windows.length && mid >= windows[windows.length - 1].end_ms) w = windows[windows.length - 1];
      return { speaker: String(u.speaker || "?"), part: num(u.part, 1) || 1, start_ms: start, end_ms: end, text: String(u.text || "").trim(), slide_id: w ? w.slide_id : null };
    })
    .filter((u) => u.text.length > 0);
}
// Every label that Run AI's speaker_mapping says is the interviewee.
// Handles { interviewer: "A", interviewee: "B" } (current Run AI format) and { A: "interviewee" }.
export function mappedIntervieweeLabels(mapping) {
  const out = new Set();
  if (!mapping || typeof mapping !== "object") return out;
  for (const [k, v] of Object.entries(mapping)) {
    const ks = String(k).toLowerCase();
    const vs = typeof v === "string" ? v.toLowerCase() : "";
    if (vs.includes("interviewee")) out.add(String(k));
    if (ks.includes("interviewee") && typeof v === "string" && v.trim()) out.add(v.trim().replace(/^speaker\s+/i, ""));
    if (v && typeof v === "object" && String(v.role || "").toLowerCase().includes("interviewee")) out.add(String(k));
  }
  return out;
}
export function heuristicInterviewee(utts, voiceSlideIds) {
  const count = {};
  const inVoice = utts.filter((u) => u.slide_id && voiceSlideIds.has(u.slide_id));
  const pool = inVoice.length ? inVoice : utts;
  pool.forEach((u) => {
    count[u.speaker] = (count[u.speaker] || 0) + words(u.text);
  });
  const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]);
  return ranked.length ? ranked[0][0] : null;
}
function timestampForQuote(quote, utts, fallbackMs) {
  const q = String(quote || "").trim().toLowerCase();
  if (q.length >= 8) {
    const probe = q.slice(0, 40);
    const hit = utts.find((u) => u.text.toLowerCase().includes(probe));
    if (hit) return Math.round(hit.start_ms / 1000);
  }
  return fallbackMs != null ? Math.round(fallbackMs / 1000) : null;
}

export async function tagInterview(supabase, interviewId, options) {
  const apiKey = (options && options.apiKey) || process.env.ANTHROPIC_API_KEY;
  const { data: iv, error: ivErr } = await supabase.from("completed_interviews").select("*").eq("id", interviewId).maybeSingle();
  if (ivErr || !iv) throw new TagError("interview not found", 404);
  const { data: contract } = await supabase.from("contracts").select("id, deck, extraction_schema").eq("id", iv.contract_id).maybeSingle();
  if (!contract || !contract.deck || !Array.isArray(contract.deck.slides)) throw new TagError("this contract has no slide deck", 400);

  const deck = contract.deck;
  const deckLang = deck.default_language || "en";
  const lang = iv.language || deckLang;
  const rawUtts = asArray(iv.diarized_transcript);
  if (!rawUtts.length) throw new TagError("no diarized transcript yet — run Transcribe first", 400);
  const timeline = asArray(iv.slide_timeline);
  if (!timeline.length) throw new TagError("this interview has no slide timeline (not a tablet interview)", 400);

  const warnings = [];
  const recMeta = asObject(iv.recording_meta);
  const lastEnd = rawUtts.reduce((m, u) => Math.max(m, num(u.end, num(u.end_ms, 0))), 0);
  const endMs = Math.max(num(recMeta.duration_ms, 0), lastEnd + 1);
  const windows = buildWindows(timeline, endMs);
  const utts = assignUtterances(rawUtts, windows);

  const slides = deck.slides;
  const qOf = (s) => (s.interactions && s.interactions[0]) || null;
  const voiceSlideIds = new Set(slides.filter((s) => qOf(s) && qOf(s).type === "voice").map((s) => s.id));

  let usage = { input_tokens: 0, output_tokens: 0 };
  const addUsage = (u) => {
    if (u) {
      usage.input_tokens += num(u.input_tokens, 0);
      usage.output_tokens += num(u.output_tokens, 0);
    }
  };

  // ── Who is the interviewee? Decided separately for each recording part ──
  const sd = asObject(iv.structured_data);
  const mapped = mappedIntervieweeLabels(sd.speaker_mapping);
  const interviewee = new Set();
  const methods = [];
  const partsSeen = Array.from(new Set(utts.map((u) => u.part))).sort((a, b) => a - b);
  const multi = partsSeen.length > 1;
  for (const part of partsSeen) {
    const pu = utts.filter((u) => u.part === part);
    const labels = Array.from(new Set(pu.map((u) => u.speaker)));
    const tag = multi ? "part " + part + ": " : "";
    const known = labels.filter((l) => mapped.has(l));
    if (known.length) {
      known.forEach((l) => interviewee.add(l));
      methods.push(tag + "speaker_mapping");
      continue;
    }
    if (labels.length === 1) {
      interviewee.add(labels[0]);
      methods.push(tag + "single_speaker");
      warnings.push((multi ? "Part " + part + ": only" : "Only") + " one speaker label found; treated as the interviewee.");
      continue;
    }
    let picked = null;
    if (apiKey) {
      try {
        const sample = pu.slice(0, 30).map((u) => u.speaker + ": " + u.text.slice(0, 220)).join("\n");
        const r = await haiku(apiKey, "You are labelling a diarized market-research interview. The INTERVIEWER asks questions, gives instructions, and follows a script. The INTERVIEWEE answers about their own life and opinions. Decide which speaker label is the interviewee.", "Speaker labels present: " + labels.join(", ") + "\n\nTranscript sample:\n" + sample, SPEAKER_TOOL, 300);
        addUsage(r.usage);
        if (r.input && labels.includes(String(r.input.interviewee_speaker))) {
          picked = String(r.input.interviewee_speaker);
          methods.push(tag + "ai");
        }
      } catch (e) {
        warnings.push("Speaker identification by AI failed: " + e.message);
      }
    }
    if (!picked) {
      picked = heuristicInterviewee(pu, voiceSlideIds);
      methods.push(tag + "heuristic");
      warnings.push((multi ? "Part " + part + ": i" : "I") + "nterviewee guessed by who spoke most during voice prompts.");
    }
    if (picked) interviewee.add(picked);
  }
  const roleOf = (spk) => (interviewee.has(spk) ? "interviewee" : "interviewer");

  // ── Segments ──
  const windowsBySlide = {};
  windows.forEach((w) => {
    (windowsBySlide[w.slide_id] = windowsBySlide[w.slide_id] || []).push({ start_ms: w.start_ms, end_ms: w.end_ms });
  });
  const toSeg = (u) => ({ speaker: u.speaker, role: roleOf(u.speaker), part: u.part, start_ms: u.start_ms, end_ms: u.end_ms, text: u.text });
  const segments = [];
  const pre = utts.filter((u) => !u.slide_id);
  if (pre.length) {
    segments.push({
      slide_id: null,
      title: "Before the first slide",
      question_id: null,
      question_type: null,
      prompt: "",
      kind: "pre_interview",
      windows: [{ start_ms: 0, end_ms: windows.length ? windows[0].start_ms : endMs }],
      utterances: pre.map(toSeg),
      interviewee_text: pre.filter((u) => roleOf(u.speaker) === "interviewee").map((u) => u.text).join(" "),
      interviewer_text: pre.filter((u) => roleOf(u.speaker) === "interviewer").map((u) => u.text).join(" "),
    });
  }
  const segBySlide = {};
  for (const s of slides) {
    const q = qOf(s);
    const su = utts.filter((u) => u.slide_id === s.id);
    const ws = windowsBySlide[s.id] || [];
    const seg = {
      slide_id: s.id,
      title: L(s.title, lang) || s.id,
      question_id: q ? q.id : null,
      question_type: q ? q.type : null,
      prompt: q ? L(q.prompt, lang) : s.text ? L(s.text.heading, lang) : "",
      kind: q ? (q.type === "voice" ? "formal" : "incidental") : "commentary",
      shown: ws.length > 0,
      windows: ws,
      start_ms: ws.length ? ws[0].start_ms : null,
      end_ms: ws.length ? ws[ws.length - 1].end_ms : null,
      utterances: su.map(toSeg),
      interviewee_text: su.filter((u) => roleOf(u.speaker) === "interviewee").map((u) => u.text).join(" "),
      interviewer_text: su.filter((u) => roleOf(u.speaker) === "interviewer").map((u) => u.text).join(" "),
    };
    segments.push(seg);
    segBySlide[s.id] = seg;
  }

  // ── Fields: tap answers copied by code; voice answers via AI ──
  const responses = asObject(iv.survey_responses);
  const fields = {};
  const optionLabel = (q, id) => {
    if (id === "other") return "Other";
    if (id === "prefer_not") return "Prefer not to say";
    const o = (q.options || []).find((x) => x.id === id);
    return o ? L(o.label, lang) : String(id);
  };
  const voiceJobs = [];
  for (const s of slides) {
    const q = qOf(s);
    if (!q) continue;
    const seg = segBySlide[s.id];
    const a = responses[q.id];
    const ts = seg && seg.start_ms != null ? Math.round(seg.start_ms / 1000) : null;
    const base = { question_type: q.type, slide_id: s.id, label: L(q.prompt, lang), source: q.type === "voice" ? "transcript" : "tablet", shown: !!(seg && seg.shown) };
    if (q.type !== "voice" && seg && seg.interviewee_text) base.incidental_speech = seg.interviewee_text;
    if (q.type === "single_choice") {
      const has = a && a.option;
      fields[q.id] = { ...base, value: has ? optionLabel(q, a.option) : null, option_id: has ? a.option : null, other_text: has && a.option === "other" ? a.other_text || "" : null, mentioned: !!has, evidence_quote: has && a.option === "other" ? a.other_text || null : null, approx_timestamp_seconds: ts, confidence: has ? 1 : 0 };
    } else if (q.type === "multi_select") {
      const list = a && Array.isArray(a.options) ? a.options : [];
      fields[q.id] = { ...base, value: list.length ? list.map((id) => optionLabel(q, id)) : null, option_ids: list.length ? list : null, other_text: list.includes("other") ? a.other_text || "" : null, mentioned: list.length > 0, evidence_quote: list.includes("other") ? a.other_text || null : null, approx_timestamp_seconds: ts, confidence: list.length ? 1 : 0 };
    } else if (q.type === "scale") {
      const has = a && typeof a.value === "number";
      fields[q.id] = { ...base, value: has ? a.value : null, mentioned: !!has, evidence_quote: null, approx_timestamp_seconds: ts, confidence: has ? 1 : 0, scale: q.scale || null };
    } else if (q.type === "text") {
      const txt = a && typeof a.text === "string" ? a.text.trim() : "";
      fields[q.id] = { ...base, value: txt || null, mentioned: txt.length > 0, evidence_quote: txt || null, approx_timestamp_seconds: ts, confidence: txt ? 1 : 0, private: !!q.private };
    } else if (q.type === "voice") {
      const spoken = seg ? seg.interviewee_text : "";
      fields[q.id] = { ...base, value: null, mentioned: spoken.length > 0, evidence_quote: null, approx_timestamp_seconds: ts, confidence: 0, segment_text: spoken, sentiment: null };
      if (spoken.trim().length > 0) voiceJobs.push({ question_id: q.id, prompt: L(q.prompt, lang), spoken: spoken.slice(0, 3500), seg });
    }
  }

  const rawFallback = (j) => {
    const f = fields[j.question_id];
    f.value = j.spoken.slice(0, 300);
    f.evidence_quote = j.spoken.slice(0, 200);
    f.confidence = 0.4;
  };
  if (voiceJobs.length) {
    if (apiKey) {
      try {
        const userText = voiceJobs.map((j, i) => "QUESTION " + (i + 1) + " [question_id: " + j.question_id + "]\nAsked: " + j.prompt + "\nInterviewee said (verbatim transcript for this slide):\n" + j.spoken + "\n").join("\n---\n");
        const r = await haiku(
          apiKey,
          "You summarise spoken answers from a market-research interview. Use ONLY the transcript text provided for each question. Never invent or infer facts that are not said. The evidence_quote must be copied verbatim from the interviewee text. If the interviewee did not answer the question, set mentioned=false with empty gist and quote. Write the gist in the same language the interviewee spoke.",
          userText,
          VOICE_TOOL,
          2500
        );
        addUsage(r.usage);
        const answers = (r.input && Array.isArray(r.input.answers) ? r.input.answers : []).reduce((m, x) => {
          m[x.question_id] = x;
          return m;
        }, {});
        for (const j of voiceJobs) {
          const x = answers[j.question_id];
          const f = fields[j.question_id];
          if (!x) {
            rawFallback(j);
            warnings.push("AI returned nothing for " + j.question_id + "; raw transcript used.");
            continue;
          }
          const quote = String(x.evidence_quote || "").trim();
          const verbatim = quote && j.spoken.toLowerCase().includes(quote.toLowerCase().slice(0, 40));
          f.mentioned = !!x.mentioned;
          f.value = x.mentioned ? String(x.gist || "").trim() || j.spoken.slice(0, 300) : null;
          f.evidence_quote = x.mentioned ? (verbatim ? quote : j.spoken.slice(0, 200)) : null;
          f.sentiment = x.mentioned ? x.sentiment || "unclear" : null;
          f.confidence = x.mentioned ? (verbatim ? 0.85 : 0.6) : 0.5;
          f.approx_timestamp_seconds = timestampForQuote(f.evidence_quote, j.seg.utterances.filter((u) => u.role === "interviewee"), j.seg.start_ms);
        }
      } catch (e) {
        warnings.push("AI voice tagging failed (" + e.message + "); raw transcript text used as the answer.");
        voiceJobs.forEach(rawFallback);
      }
    } else {
      warnings.push("ANTHROPIC_API_KEY is not set; raw transcript text used for voice answers.");
      voiceJobs.forEach(rawFallback);
    }
  }

  // ── Register deck questions in the extraction schema (deck's default language) ──
  const schema = asArray(contract.extraction_schema).filter((f) => f && f.key);
  const byKey = new Map(schema.map((f) => [f.key, f]));
  for (const s of slides) {
    const q = qOf(s);
    if (!q) continue;
    const entry = {
      key: q.id,
      label: L(q.prompt, deckLang),
      type: TYPE_MAP[q.type] || "free_text",
      description: "Tablet deck question on slide \"" + (L(s.title, deckLang) || s.id) + "\" (" + q.type + "). Answered on the tablet; filled in by slide tagging, never extracted from the transcript.",
      source: "deck",
      slide_id: s.id,
    };
    if (q.type === "single_choice" || q.type === "multi_select") {
      entry.options = (q.options || []).map((o) => L(o.label, deckLang));
      if (q.allow_other) entry.options.push("Other");
      if (q.allow_prefer_not) entry.options.push("Prefer not to say");
    }
    if (q.type === "scale" && q.scale) entry.scale = { min: q.scale.min, max: q.scale.max };
    if (byKey.has(q.id)) byKey.set(q.id, { ...byKey.get(q.id), ...entry });
    else {
      byKey.set(q.id, entry);
      schema.push(entry);
    }
  }
  const newSchema = schema.map((f) => byKey.get(f.key) || f);
  await supabase.from("contracts").update({ extraction_schema: newSchema }).eq("id", contract.id);

  // ── Save on the interview ──
  const taggedAt = new Date().toISOString();
  const intervieweeLabels = Array.from(interviewee);
  const method = methods.join(", ") || "none";
  const patch = { slide_segments: segments, slide_fields: fields, slide_tagged_at: taggedAt };
  let mergedIntoStats = false;
  if (iv.structured_data && typeof iv.structured_data === "object") {
    patch.structured_data = { ...sd, extracted_fields: { ...asObject(sd.extracted_fields), ...fields }, slide_tagging: { tagged_at: taggedAt, interviewee_speakers: intervieweeLabels, method } };
    mergedIntoStats = true;
  } else {
    warnings.push("Run AI has not been run on this interview yet, so the slide answers are saved but not yet visible in statistics. Run AI to finish (it tags automatically).");
  }
  const { error: upErr } = await supabase.from("completed_interviews").update(patch).eq("id", iv.id);
  if (upErr) throw new TagError(upErr.message, 500);

  const cost = (usage.input_tokens * 1 + usage.output_tokens * 5) / 1e6; // rough Haiku estimate in USD
  return {
    ok: true,
    interview_id: iv.id,
    interview_number: iv.interview_number,
    interviewee_speaker: intervieweeLabels.join(", "),
    method,
    parts: partsSeen.length,
    segments: segments.length,
    utterances: utts.length,
    fields: Object.keys(fields).length,
    voice_answers: voiceJobs.length,
    merged_into_stats: mergedIntoStats,
    schema_fields: newSchema.length,
    warnings,
    cost_estimate: Number(cost.toFixed(4)),
  };
}
