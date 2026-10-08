import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

const HAIKU = "claude-haiku-4-5-20251001";
const DEMO_OPTIONS = {
  ageRange: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+", "Prefer not to say"],
  gender: ["Male", "Female", "Non-binary", "Prefer not to say"],
  ethnicity: ["White", "South Asian", "East Asian", "Southeast Asian", "Black", "Middle Eastern", "Latin American", "Indigenous", "Mixed/Other", "Prefer not to say"],
  profession: ["Healthcare", "Medical", "Technology", "Finance", "Legal", "Education", "Retail / Service", "Trades / Construction", "Executive", "Student", "Retired", "Other", "Prefer not to say"],
};
const CHOICE_TYPES = ["single_select", "multi_select"];
const NUMBER_TYPES = ["scale", "numeric"];
const TEXT_TYPES = ["free_text", "ordered_list"];

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function fmtShare(count, total) {
  if (total <= 0) return "no matching respondents";
  if (total <= 2) return `${count} of ${total} respondent${total === 1 ? "" : "s"}`;
  return `${Math.round((count / total) * 1000) / 10}% (${count} of ${total})`;
}

function formatTranscript(r) {
  const utt = r.diarized_transcript;
  if (Array.isArray(utt) && utt.length > 0) {
    return utt.map((u) => `Speaker ${u.speaker} (t=${u.start != null ? Math.floor(u.start / 1000) : 0}s): ${u.text}`).join("\n");
  }
  return r.transcript || "";
}

// Answers the interviewee TYPED on the tablet (not in the audio), so the qualitative mode can use them too
function typedAnswers(r) {
  const ef = (r.structured_data && r.structured_data.extracted_fields) || {};
  const lines = Object.values(ef)
    .filter((f) => f && f.source === "tablet" && f.question_type === "text" && f.value)
    .map((f) => `Typed on the tablet in answer to "${f.label || "a question"}": ${String(f.value).slice(0, 600)}`);
  return lines.length ? "\n" + lines.join("\n") : "";
}

// ── Tablet deck helpers (option IDs are stable across languages; labels are not) ──
function L(field, lang) {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field[lang] || field.en || Object.values(field)[0] || "";
}
function norm(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}
function deckQuestion(deck, key) {
  for (const s of (deck && deck.slides) || []) for (const q of s.interactions || []) if (q.id === key) return q;
  return null;
}
function optionCatalog(fieldDef, dq, deckLang) {
  if (dq && Array.isArray(dq.options)) {
    const cat = dq.options.map((o) => {
      const names = new Set([norm(o.id)]);
      if (o.label && typeof o.label === "object") Object.values(o.label).forEach((v) => names.add(norm(v)));
      else names.add(norm(o.label));
      return { id: o.id, label: L(o.label, deckLang) || o.id, names };
    });
    if (dq.allow_other) cat.push({ id: "other", label: "Other", names: new Set(["other", "other (please specify)"]) });
    if (dq.allow_prefer_not) cat.push({ id: "prefer_not", label: "Prefer not to say", names: new Set(["prefer_not", "prefer not to say"]) });
    return cat;
  }
  return (Array.isArray(fieldDef.options) ? fieldDef.options : []).map((o) => ({ id: norm(o), label: String(o), names: new Set([norm(o)]) }));
}
function chosenIds(ef, catalog) {
  const ids = [];
  if (ef.option_id) ids.push(String(ef.option_id));
  if (Array.isArray(ef.option_ids)) ef.option_ids.forEach((x) => ids.push(String(x)));
  if (!ids.length) {
    const vals = Array.isArray(ef.value) ? ef.value : [ef.value];
    vals.forEach((v) => {
      const c = catalog.find((o) => o.names.has(norm(v)));
      ids.push(c ? c.id : norm(v));
    });
  }
  return ids;
}
function compare(v, th) {
  if (!th || typeof th.value !== "number" || !isFinite(v)) return false;
  if (th.op === ">=") return v >= th.value;
  if (th.op === ">") return v > th.value;
  if (th.op === "<=") return v <= th.value;
  if (th.op === "<") return v < th.value;
  return v === th.value;
}

async function claude(system, userContent, tool) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: HAIKU, max_tokens: 3000, system,
      tools: tool ? [tool] : undefined,
      tool_choice: tool ? { type: "tool", name: tool.name } : undefined,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "AI call failed");
  const usage = data.usage || {};
  const cost = ((usage.input_tokens || 0) * 1 + (usage.output_tokens || 0) * 5) / 1e6;
  if (tool) {
    const tu = (data.content || []).find((b) => b.type === "tool_use");
    if (!tu) throw new Error("No structured output");
    return { out: tu.input, cost };
  }
  return { out: (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n"), cost };
}

async function answerQualitative(question, filtered, scope) {
  const qualTool = {
    name: "answer_question",
    description: "Answer from transcripts with cited evidence.",
    input_schema: {
      type: "object",
      properties: {
        answer: { type: "string", description: "The answer, citing interview numbers like (Interview 3). Never invent percentages; you may say 'X of the matching interviews' only if you name which ones. If the transcripts don't address it, say so plainly." },
        evidence: { type: "array", items: { type: "object", properties: { interview_number: { type: "integer" }, quote: { type: "string", description: "Short verbatim quote from that interview supporting the answer." }, approx_timestamp_seconds: { type: ["number", "null"], description: "From the (t=...s) markers; null for typed tablet answers." } }, required: ["interview_number", "quote"] } },
      },
      required: ["answer", "evidence"],
    },
  };
  const transcripts = filtered.map((r) => `--- Interview ${r.interview_number} ---\n${formatTranscript(r).slice(0, 7000)}${typedAnswers(r)}`).join("\n\n");
  const q = await claude(
    `You answer a client's question using ONLY the interview transcripts provided (plus any answers the interviewee typed on the tablet, listed under each transcript). Cite interview numbers. Include each supporting verbatim quote in evidence with its timestamp from the (t=...s) markers. If nothing addresses the question, say so and return empty evidence.`,
    `Question: "${question}"\nMatching interviews (${scope}):\n\n${transcripts}\n\nCall answer_question.`,
    qualTool
  );
  return {
    answer: q.out.answer,
    evidence: (q.out.evidence || []).map((e) => ({ interview_number: e.interview_number, quote: e.quote, timestamp: e.approx_timestamp_seconds ?? null })),
    cost: q.cost,
  };
}

export async function POST(request) {
  const admin = db();
  let logBase = null;
  try {
    const token = (request.headers.get("authorization") || "").replace("Bearer ", "");
    if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { data: caller } = await admin.auth.getUser(token);
    if (!caller?.user) return Response.json({ error: "Not signed in" }, { status: 401 });
    const userId = caller.user.id;

    const { contractId, question } = await request.json();
    if (!contractId || !question?.trim()) return Response.json({ error: "Missing question" }, { status: 400 });
    logBase = { contract_id: contractId, client_id: userId, question: question.trim() };

    const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).single();
    const isAdminUser = prof?.role === "admin";
    let allowance = 50;
    if (!isAdminUser) {
      const { data: link } = await admin.from("client_contracts").select("prompt_allowance, access_revoked, chat_paused")
        .eq("client_id", userId).eq("contract_id", contractId).single();
      if (!link || link.access_revoked) return Response.json({ error: "This contract isn't assigned to your account." }, { status: 403 });
      if (link.chat_paused) return Response.json({ paused: true, answer: "Your questions for this contract are currently paused. Contact InsightRide to restore access." });
      allowance = link.prompt_allowance ?? 50;
    }
    const { count: used } = await admin.from("chat_logs").select("id", { count: "exact", head: true })
      .eq("client_id", userId).eq("contract_id", contractId).eq("status", "answered");
    if (!isAdminUser && (used || 0) >= allowance) {
      return Response.json({ limitReached: true, used, allowance });
    }

    const { data: contract } = await admin.from("contracts").select("topic, guide, extraction_schema, deck").eq("id", contractId).single();
    const schema = Array.isArray(contract?.extraction_schema) ? contract.extraction_schema : [];
    const deck = contract?.deck && Array.isArray(contract.deck.slides) ? contract.deck : null;
    const deckLang = (deck && deck.default_language) || "en";
    // Voided interviews never count (they are also flagged for exclusion by a database rule)
    const { data: ivs } = await admin.from("completed_interviews")
      .select("id, interview_number, demographics, structured_data, transcript, diarized_transcript, city, neighbourhood")
      .eq("contract_id", contractId).eq("status", "summarized").eq("voided", false);
    const rows = (ivs || []).filter((r) => r.structured_data && !(r.structured_data.quality?.flagged_for_exclusion));
    if (rows.length === 0) return Response.json({ answer: "There are no processed interviews in this contract yet, so I can't answer questions about the data.", used, allowance });

    let totalCost = 0;

    // Plan (no relevance gate — every question is answered)
    const planTool = {
      name: "plan_answer",
      description: "Plan how to answer a question about this contract's interviews.",
      input_schema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["stat", "qualitative"], description: "stat = wants a count/percentage/comparison/average. qualitative = wants what people said, themes, opinions, or where/whether something was said. Questions about typed (free_text) tablet answers are qualitative." },
          filters: { type: "array", items: { type: "object", properties: { demo: { type: "string", enum: ["ageRange", "gender", "ethnicity", "profession", "city", "neighbourhood"] }, values: { type: "array", items: { type: "string" } } }, required: ["demo", "values"] }, description: "Demographic/location filters implied by the question, mapped EXACTLY to the provided option values (e.g. 'over 45' -> ageRange 45-54, 55-64, 65+). Empty if about all respondents." },
          existing_field_key: { type: ["string", "null"], description: "If an existing field answers a stat question, its key. Else null. Tablet questions (single_select, multi_select, scale) answer 'how many chose X' and 'how did people rate it' questions directly." },
          target_values: { type: "array", items: { type: "string" }, description: "For a single_select or multi_select field: the option(s) that count as a hit, copied EXACTLY from the field's listed options. Leave empty to report the full breakdown of answers." },
          numeric_threshold: { type: ["object", "null"], properties: { op: { type: "string", enum: [">=", ">", "<=", "<", "="] }, value: { type: "number" } }, description: "For a scale or numeric field when the question asks how many are above/below a value (e.g. 'rated 4 or higher' -> op >=, value 4). Null to report the average." },
          new_field: { type: ["object", "null"], properties: { key: { type: "string" }, label: { type: "string" }, type: { type: "string", enum: ["boolean", "sentiment"] }, description: { type: "string", description: "Precise yes-if instruction for extraction, covering implicit/slang phrasings." } }, description: "For a stat question no existing field fits, define one. Null otherwise." },
          hit_definition: { type: "string", description: "One phrase for what counts as a 'hit', e.g. 'said cost was a barrier' or 'chose Curious'." }
        },
        required: ["mode", "filters", "hit_definition"],
      },
    };
    const fieldList = schema.map((f) => {
      let extra = "";
      if (CHOICE_TYPES.includes(f.type)) {
        const cat = optionCatalog(f, deckQuestion(deck, f.key), deckLang);
        if (cat.length) extra = ` — options: ${cat.map((o) => o.label).join(" | ")}`;
      } else if (f.type === "scale") {
        const dq = deckQuestion(deck, f.key);
        const sc = (dq && dq.scale) || f.scale;
        if (sc) extra = ` — scale ${sc.min} to ${sc.max}`;
      }
      return `- ${f.key} (${f.type}): ${f.label}${f.description ? " — " + f.description : ""}${extra}`;
    }).join("\n") || "(none)";
    const plan1 = await claude(
      `You plan answers about a market-research contract titled "${contract.topic}". Available demographic option values: ${JSON.stringify(DEMO_OPTIONS)}. Existing extracted fields:\n${fieldList}\nCities/neighbourhoods present: ${JSON.stringify(Array.from(new Set(rows.flatMap((r) => [r.city, r.neighbourhood]).filter(Boolean))))}`,
      `Question from the client: "${question.trim()}"\nCall plan_answer.`,
      planTool
    );
    totalCost += plan1.cost;
    const plan = plan1.out;

    // Exact demographic filters in code
    let filtered = rows;
    const filterDescs = [];
    for (const f of plan.filters || []) {
      const vals = (f.values || []).map((v) => String(v).toLowerCase());
      if (!vals.length) continue;
      filtered = filtered.filter((r) => {
        const v = f.demo === "city" ? r.city : f.demo === "neighbourhood" ? r.neighbourhood : (r.demographics || {})[f.demo];
        return v && vals.includes(String(v).toLowerCase());
      });
      filterDescs.push(`${f.demo}: ${f.values.join(" / ")}`);
    }
    const scope = filterDescs.length ? filterDescs.join("; ") : "all respondents";

    let answer = "", evidence = [];
    let key = plan.existing_field_key;
    let fieldDef = plan.mode === "stat" ? schema.find((f) => f.key === key) || null : null;
    // Text fields cannot be counted: answer them from what people said instead
    const useQualitative = plan.mode === "qualitative" || (fieldDef && TEXT_TYPES.includes(fieldDef.type));

    if (useQualitative) {
      const q = await answerQualitative(question.trim(), filtered, scope);
      totalCost += q.cost;
      answer = q.answer;
      evidence = q.evidence;
    } else {
      if (!fieldDef && plan.new_field?.key) {
        fieldDef = plan.new_field;
        key = fieldDef.key;
        const extractTool = {
          name: "save_labels",
          description: "Per-interview labels for one field.",
          input_schema: { type: "object", properties: { labels: { type: "array", items: { type: "object", properties: {
            interview_number: { type: "integer" }, value: {}, mentioned: { type: "boolean" },
            evidence_quote: { type: ["string", "null"] }, approx_timestamp_seconds: { type: ["number", "null"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] } }, required: ["interview_number", "value", "mentioned", "confidence"] } } }, required: ["labels"] },
        };
        const transcripts = filtered.map((r) => `--- Interview ${r.interview_number} ---\n${formatTranscript(r).slice(0, 7000)}`).join("\n\n");
        const ext = await claude(
          `Extract ONE field from each interview. Field: ${fieldDef.key} (${fieldDef.type}). Definition: ${fieldDef.description}. Rules: never fabricate — if not addressed, value null and mentioned false ("didn't come up" is distinct from an explicit no). ${fieldDef.type === "sentiment" ? "Values: very_negative, negative, neutral, positive, very_positive." : "Values: true, false, or null."} Include a short verbatim evidence_quote with timestamp from (t=...s) markers when mentioned. Low confidence beats guessing. Call save_labels with one entry per interview.`,
          transcripts, extractTool
        );
        totalCost += ext.cost;
        for (const lab of ext.out.labels || []) {
          const row = filtered.find((r) => r.interview_number === lab.interview_number);
          if (!row) continue;
          const sd = row.structured_data;
          sd.extracted_fields = sd.extracted_fields || {};
          sd.extracted_fields[key] = { value: lab.value, mentioned: lab.mentioned, evidence_quote: lab.evidence_quote || null, approx_timestamp_seconds: lab.approx_timestamp_seconds ?? null, confidence: lab.confidence };
          await admin.from("completed_interviews").update({ structured_data: sd }).eq("id", row.id);
        }
        await admin.from("contracts").update({ extraction_schema: [...schema, { key: fieldDef.key, label: fieldDef.label, type: fieldDef.type, description: fieldDef.description }] }).eq("id", contractId);
      }

      if (!fieldDef) {
        answer = `I couldn't map that question onto the data. Try asking about a specific opinion, barrier, or behaviour — for example, "how many respondents said cost was a barrier?"`;
      } else {
        const getEf = (r) => (r.structured_data?.extracted_fields || {})[key];
        const answeredRows = filtered.filter((r) => { const e = getEf(r); return e && e.mentioned !== false && e.value !== null && e.value !== undefined && !(Array.isArray(e.value) && e.value.length === 0); });
        const n = filtered.length;
        const notMentioned = n - answeredRows.length;
        const smallNote = n > 0 && n < 5 ? ` This group is very small (${n} ${n === 1 ? "person" : "people"}), so treat this as describing those individuals rather than a general pattern.` : "";
        let noteKind = "tablet"; // which wording the "not answered" note uses
        const tabletEvidence = (rowsList, describe) => rowsList.slice(0, 25).map((r) => {
          const e = getEf(r);
          return { interview_number: r.interview_number, quote: e.evidence_quote || ("Answered on the tablet: " + describe(e)), timestamp: e.approx_timestamp_seconds ?? null };
        });

        if (CHOICE_TYPES.includes(fieldDef.type)) {
          const dq = deckQuestion(deck, key);
          const catalog = optionCatalog(fieldDef, dq, deckLang);
          const labelFor = (id) => { const c = catalog.find((o) => o.id === id); return c ? c.label : id; };
          const describe = (e) => chosenIds(e, catalog).map(labelFor).join(", ");
          const targets = (plan.target_values || []).map((t) => { const c = catalog.find((o) => o.names.has(norm(t))); return c ? c.id : norm(t); });
          if (targets.length) {
            const hits = answeredRows.filter((r) => chosenIds(getEf(r), catalog).some((id) => targets.includes(id)));
            answer = `Of the ${n} respondent${n === 1 ? "" : "s"} matching ${scope}, ${fmtShare(hits.length, n)} ${plan.hit_definition}.`;
            evidence = tabletEvidence(hits, describe);
          } else {
            const counts = {};
            answeredRows.forEach((r) => Array.from(new Set(chosenIds(getEf(r), catalog))).forEach((id) => { counts[id] = (counts[id] || 0) + 1; }));
            const order = catalog.map((o) => o.id).concat(Object.keys(counts).filter((id) => !catalog.find((o) => o.id === id)));
            const parts = order.filter((id) => counts[id]).map((id) => `${labelFor(id)}: ${fmtShare(counts[id], n)}`);
            answer = parts.length
              ? `Of the ${n} respondent${n === 1 ? "" : "s"} matching ${scope}, answers to "${fieldDef.label}" were — ${parts.join("; ")}.${fieldDef.type === "multi_select" ? " People could choose more than one answer, so the shares can add up to more than 100%." : ""}`
              : `None of the ${n} respondent${n === 1 ? "" : "s"} matching ${scope} have an answer recorded for "${fieldDef.label}".`;
            evidence = tabletEvidence(answeredRows, describe);
          }
        } else if (NUMBER_TYPES.includes(fieldDef.type)) {
          const dq = deckQuestion(deck, key);
          const sc = (dq && dq.scale) || fieldDef.scale || null;
          const numRows = answeredRows.filter((r) => isFinite(Number(getEf(r).value)));
          const describe = (e) => String(e.value) + (sc ? ` on a ${sc.min}–${sc.max} scale` : "");
          const th = plan.numeric_threshold;
          if (th && typeof th.value === "number") {
            const hits = numRows.filter((r) => compare(Number(getEf(r).value), th));
            answer = `Of the ${n} respondent${n === 1 ? "" : "s"} matching ${scope}, ${fmtShare(hits.length, n)} ${plan.hit_definition}.`;
            evidence = tabletEvidence(hits, describe);
          } else if (numRows.length) {
            const vals = numRows.map((r) => Number(getEf(r).value));
            const avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
            noteKind = "average";
            answer = `Among the ${vals.length} respondent${vals.length === 1 ? "" : "s"} matching ${scope} who answered "${fieldDef.label}", the average was ${avg}${sc ? ` on a ${sc.min}–${sc.max} scale` : ""} (lowest ${Math.min(...vals)}, highest ${Math.max(...vals)}).`;
            evidence = tabletEvidence(numRows, describe);
          } else {
            answer = `None of the ${n} respondent${n === 1 ? "" : "s"} matching ${scope} have an answer recorded for "${fieldDef.label}".`;
          }
        } else {
          noteKind = "ai";
          const hits = fieldDef.type === "sentiment"
            ? answeredRows.filter((r) => ["positive", "very_positive"].includes(getEf(r).value))
            : answeredRows.filter((r) => getEf(r).value === true);
          answer = `Of the ${n} respondent${n === 1 ? "" : "s"} matching ${scope}, ${fmtShare(hits.length, n)} ${plan.hit_definition}.`;
          evidence = hits.map((r) => ({ interview_number: r.interview_number, quote: getEf(r).evidence_quote, timestamp: getEf(r).approx_timestamp_seconds })).filter((e) => e.quote);
        }

        if (notMentioned > 0 && n > 0) {
          if (noteKind === "ai") answer += ` Note: ${notMentioned} of them didn't address this topic at all, and are counted in the total.`;
          else if (noteKind === "average") answer += ` ${notMentioned} other matching respondent${notMentioned === 1 ? " has" : "s have"} no answer recorded and ${notMentioned === 1 ? "is" : "are"} not included in the average.`;
          else answer += ` Note: ${notMentioned} of them ${notMentioned === 1 ? "has" : "have"} no answer recorded for this, and ${notMentioned === 1 ? "is" : "are"} counted in the total.`;
        }
        answer += smallNote;
        if (n === 0) answer = `No completed interviews match ${scope}, so there's no data to answer this yet.`;
      }
    }

    await admin.from("chat_logs").insert([{ ...logBase, answer, status: "answered", evidence, cost_estimate: totalCost }]);
    return Response.json({ answer, evidence, used: (used || 0) + 1, allowance });
  } catch (e) {
    try { if (logBase) await db().from("chat_logs").insert([{ ...logBase, status: "failed", cost_estimate: 0 }]); } catch {}
    return Response.json({ error: "Something went wrong answering that — it hasn't used one of your prompts. Please try again.", detail: e.message }, { status: 500 });
  }
}
