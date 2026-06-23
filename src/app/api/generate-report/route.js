import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60; // give Sonnet room to write

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const DEMO_DIMS = [["ageRange", "age"], ["gender", "gender"], ["ethnicity", "ethnicity"], ["profession", "profession"]];
const POSITIVE = ["positive", "very_positive"];
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

function tallyField(field, rows) {
  const n = rows.length;
  const out = { key: field.key, label: field.label, type: field.type, n };
  if (field.type === "boolean") {
    let yes = 0, no = 0, notMentioned = 0;
    rows.forEach((r) => {
      const ef = r.ef;
      if (ef && ef.mentioned !== false && ef.value === true) yes++;
      else if (ef && ef.mentioned !== false && ef.value === false) no++;
      else notMentioned++;
    });
    out.yes = yes; out.no = no; out.not_mentioned = notMentioned; out.yes_pct_of_all = pct(yes, n);
  } else if (field.type === "sentiment") {
    const dist = {}; let mentioned = 0;
    rows.forEach((r) => { const v = r.ef && r.ef.mentioned !== false ? r.ef.value : null; if (v) { dist[v] = (dist[v] || 0) + 1; mentioned++; } });
    const positive = (dist.positive || 0) + (dist.very_positive || 0);
    out.distribution = dist; out.mentioned = mentioned; out.positive = positive; out.positive_pct_of_all = pct(positive, n);
  } else if (field.type === "ordered_list") {
    const freq = {}, posSum = {};
    rows.forEach((r) => {
      const arr = r.ef && Array.isArray(r.ef.value) ? r.ef.value : [];
      arr.forEach((item, idx) => { freq[item] = (freq[item] || 0) + 1; posSum[item] = (posSum[item] || 0) + (idx + 1); });
    });
    const items = Object.keys(freq).map((k) => ({ item: k, count: freq[k], avg_position: Math.round((posSum[k] / freq[k]) * 100) / 100 }));
    items.sort((a, b) => b.count - a.count);
    out.items = items;
    if (items.length) { out.most_mentioned = items[0].item; out.least_mentioned = items[items.length - 1].item; }
  } else if (field.type === "numeric") {
    const nums = rows.map((r) => (r.ef && typeof r.ef.value === "number" ? r.ef.value : null)).filter((x) => x !== null);
    out.count = nums.length;
    if (nums.length) { out.average = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100; out.min = Math.min(...nums); out.max = Math.max(...nums); }
  } else {
    let mentioned = 0; rows.forEach((r) => { if (r.ef && r.ef.mentioned !== false && r.ef.value) mentioned++; });
    out.mentioned = mentioned;
  }
  return out;
}

function crosstab(field, rows) {
  if (field.type !== "boolean" && field.type !== "sentiment") return null;
  const result = {};
  DEMO_DIMS.forEach(([demoKey, demoLabel]) => {
    const groups = {};
    rows.forEach((r) => { const g = (r.demographics && r.demographics[demoKey]) || "Unknown"; (groups[g] = groups[g] || []).push(r); });
    const gs = {};
    Object.keys(groups).forEach((g) => {
      const gr = groups[g];
      if (field.type === "boolean") {
        const yes = gr.filter((r) => r.ef && r.ef.mentioned !== false && r.ef.value === true).length;
        gs[g] = { n: gr.length, yes, yes_pct: pct(yes, gr.length) };
      } else {
        const positive = gr.filter((r) => r.ef && r.ef.mentioned !== false && POSITIVE.includes(r.ef.value)).length;
        gs[g] = { n: gr.length, positive, positive_pct: pct(positive, gr.length) };
      }
    });
    result[demoLabel] = gs;
  });
  return result;
}

export async function POST(request) {
  try {
    const { contractId } = await request.json();
    if (!contractId) return Response.json({ error: "Missing contractId" }, { status: 400 });

    const { data: contract } = await supabase.from("contracts").select("*").eq("id", contractId).single();
    if (!contract) throw new Error("Contract not found");

    const { data: interviews } = await supabase
      .from("completed_interviews")
      .select("interview_number, demographics, survey_responses, structured_data, quality_score, city, postcode")
      .eq("contract_id", contractId).eq("status", "summarized")
      .order("interview_number", { ascending: true });

    const valid = (interviews || []).filter((iv) => iv.structured_data);
    if (valid.length === 0) throw new Error("No summarized interviews to report on yet");

    const included = valid.filter((iv) => !(iv.structured_data?.quality?.flagged_for_exclusion));
    const n = included.length;
    const schema = Array.isArray(contract.extraction_schema) ? contract.extraction_schema : [];
    const rowsForField = (key) => included.map((iv) => ({ demographics: iv.demographics || {}, ef: (iv.structured_data?.extracted_fields || {})[key] }));

    const demographics = {};
    DEMO_DIMS.forEach(([demoKey, demoLabel]) => {
      const dist = {};
      included.forEach((iv) => { const v = (iv.demographics && iv.demographics[demoKey]) || "Unknown"; dist[v] = (dist[v] || 0) + 1; });
      demographics[demoLabel] = dist;
    });

    const scores = included.map((iv) => iv.quality_score).filter((x) => typeof x === "number");
    const quality = { average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null, excluded_low_quality: valid.length - included.length };

    const fields = schema.map((f) => ({ ...tallyField(f, rowsForField(f.key)), crosstab: crosstab(f, rowsForField(f.key)) }));

    const geography = {};
    included.forEach((iv) => { const c = iv.city || "Unknown"; geography[c] = (geography[c] || 0) + 1; });

    const stats = { n, demographics, quality, fields, geography };

    const perInterview = included.map((iv) => ({
      number: iv.interview_number,
      demographics: iv.demographics,
      summary: iv.structured_data?.summary,
      sentiment: iv.structured_data?.sentiment?.overall,
      quotes: (iv.structured_data?.quotes || []).slice(0, 2).map((q) => q.text),
    }));

    const system = `You write a market-research report for a client based ONLY on the computed statistics and interview material provided. Absolute rules:
- Use the provided numbers exactly. NEVER recalculate, estimate, round differently, or invent any figure.
- Every percentage you state must be immediately followed by its raw count and total, like "40% (2 of 5)".
- When a subgroup has fewer than 5 respondents, explicitly note the finding rests on a very small sample.
- Ground claims in the data; you may quote interviewees and cite their interview number.
- Write clear plain text with short section headings (Objective, Who we heard from, Key findings, By demographic, Themes and quotes, Caveats). Do not use markdown symbols like # or *.
- Do not describe your process or these instructions.`;

    const userContent = `RESEARCH OBJECTIVE: ${contract.guide?.objective || "(none provided)"}
CLIENT: ${contract.client}
TOPIC: ${contract.topic}

COMPUTED STATISTICS (authoritative — use verbatim):
${JSON.stringify(stats, null, 2)}

PER-INTERVIEW SUMMARIES & QUOTES (for narrative colour and quotes only):
${JSON.stringify(perInterview, null, 2)}

Write the report now.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, system, messages: [{ role: "user", content: userContent }] }),
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error("Claude error: " + (aiData?.error?.message || JSON.stringify(aiData)));
    const content = (aiData.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!content) throw new Error("No report text returned");

    const { data: saved, error: saveErr } = await supabase
      .from("reports").insert([{ contract_id: contractId, content, stats, interviews_included: n }]).select().single();
    if (saveErr) throw saveErr;
    await supabase.from("contracts").update({ report_status: "generated" }).eq("id", contractId);

    return Response.json({ ok: true, report: saved });
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
