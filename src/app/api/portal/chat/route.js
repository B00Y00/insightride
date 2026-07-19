import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

const HAIKU = "claude-haiku-4-5-20251001";
const DEMO_OPTIONS = {
  ageRange: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"],
  gender: ["Male", "Female", "Non-binary", "Prefer not to say"],
  ethnicity: ["White", "South Asian", "East Asian", "Southeast Asian", "Black", "Middle Eastern", "Latin American", "Indigenous", "Mixed/Other", "Prefer not to say"],
  profession: ["Healthcare", "Medical", "Technology", "Finance", "Legal", "Education", "Retail / Service", "Trades / Construction", "Executive", "Student", "Retired", "Other"],
};

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

    const { data: contract } = await admin.from("contracts").select("topic, guide, extraction_schema").eq("id", contractId).single();
    const schema = Array.isArray(contract?.extraction_schema) ? contract.extraction_schema : [];
    const { data: ivs } = await admin.from("completed_interviews")
      .select("id, interview_number, demographics, structured_data, transcript, diarized_transcript, city, neighbourhood")
      .eq("contract_id", contractId).eq("status", "summarized");
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
          mode: { type: "string", enum: ["stat", "qualitative"], description: "stat = wants a count/percentage/comparison. qualitative = wants what people said, themes, opinions, or where/whether something was said." },
          filters: { type: "array", items: { type: "object", properties: { demo: { type: "string", enum: ["ageRange", "gender", "ethnicity", "profession", "city", "neighbourhood"] }, values: { type: "array", items: { type: "string" } } }, required: ["demo", "values"] }, description: "Demographic/location filters implied by the question, mapped EXACTLY to the provided option values (e.g. 'over 45' -> ageRange 45-54, 55-64, 65+). Empty if about all respondents." },
          existing_field_key: { type: ["string", "null"], description: "If an existing field answers a stat question, its key. Else null." },
          new_field: { type: ["object", "null"], properties: { key: { type: "string" }, label: { type: "string" }, type: { type: "string", enum: ["boolean", "sentiment"] }, description: { type: "string", description: "Precise yes-if instruction for extraction, covering implicit/slang phrasings." } }, description: "For a stat question no existing field fits, define one. Null otherwise." },
          hit_definition: { type: "string", description: "One phrase for what counts as a 'hit', e.g. 'said cost was a barrier'." }
        },
        required: ["mode", "filters", "hit_definition"],
      },
    };
    const fieldList = schema.map((f) => `- ${f.key} (${f.type}): ${f.label}${f.description ? " — " + f.description : ""}`).join("\n") || "(none)";
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

    if (plan.mode === "qualitative") {
      const qualTool = {
        name: "answer_question",
        description: "Answer from transcripts with cited evidence.",
        input_schema: {
          type: "object",
          properties: {
            answer: { type: "string", description: "The answer, citing interview numbers like (Interview 3). Never invent percentages; you may say 'X of the matching interviews' only if you name which ones. If the transcripts don't address it, say so plainly." },
            evidence: { type: "array", items: { type: "object", properties: { interview_number: { type: "integer" }, quote: { type: "string", description: "Short verbatim quote from that interview supporting the answer." }, approx_timestamp_seconds: { type: ["number", "null"], description: "From the (t=...s) markers." } }, required: ["interview_number", "quote"] } },
          },
          required: ["answer", "evidence"],
        },
      };
      const transcripts = filtered.map((r) => `--- Interview ${r.interview_number} ---\n${formatTranscript(r).slice(0, 7000)}`).join("\n\n");
      const q = await claude(
        `You answer a client's question using ONLY the interview transcripts provided. Cite interview numbers. Include each supporting verbatim quote in evidence with its timestamp from the (t=...s) markers. If nothing addresses the question, say so and return empty evidence.`,
        `Question: "${question.trim()}"\nMatching interviews (${scope}):\n\n${transcripts}\n\nCall answer_question.`,
        qualTool
      );
      totalCost += q.cost;
      answer = q.out.answer;
      evidence = (q.out.evidence || []).map((e) => ({ interview_number: e.interview_number, quote: e.quote, timestamp: e.approx_timestamp_seconds ?? null }));
    } else {
      let key = plan.existing_field_key;
      let fieldDef = schema.find((f) => f.key === key) || null;

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
        const answeredRows = filtered.filter((r) => { const e = getEf(r); return e && e.mentioned !== false && e.value !== null && e.value !== undefined; });
        const hits = fieldDef.type === "sentiment"
          ? answeredRows.filter((r) => ["positive", "very_positive"].includes(getEf(r).value))
          : answeredRows.filter((r) => getEf(r).value === true);
        const n = filtered.length;
        const notMentioned = n - answeredRows.length;

        answer = `Of the ${n} respondent${n === 1 ? "" : "s"} matching ${scope}, ${fmtShare(hits.length, n)} ${plan.hit_definition}.`;
        if (notMentioned > 0) answer += ` Note: ${notMentioned} of them didn't address this topic at all, and are counted in the total.`;
        if (n > 0 && n < 5) answer += ` This group is very small (${n} ${n === 1 ? "person" : "people"}), so treat this as describing those individuals rather than a general pattern.`;
        if (n === 0) answer = `No completed interviews match ${scope}, so there's no data to answer this yet.`;
        evidence = hits.map((r) => ({ interview_number: r.interview_number, quote: getEf(r).evidence_quote, timestamp: getEf(r).approx_timestamp_seconds })).filter((e) => e.quote);
      }
    }

    await admin.from("chat_logs").insert([{ ...logBase, answer, status: "answered", evidence, cost_estimate: totalCost }]);
    return Response.json({ answer, evidence, used: (used || 0) + 1, allowance });
  } catch (e) {
    try { if (logBase) await db().from("chat_logs").insert([{ ...logBase, status: "failed", cost_estimate: 0 }]); } catch {}
    return Response.json({ error: "Something went wrong answering that — it hasn't used one of your prompts. Please try again.", detail: e.message }, { status: 500 });
  }
}
