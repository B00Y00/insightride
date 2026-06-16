import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const SENTIMENT_VALUES = ["very_negative", "negative", "neutral", "positive", "very_positive"];

function formatTranscript(interview) {
  const utt = interview.diarized_transcript;
  if (Array.isArray(utt) && utt.length > 0) {
    return utt.map((u) => {
      const t = u.start != null ? Math.floor(u.start / 1000) : 0;
      return `Speaker ${u.speaker} (t=${t}s): ${u.text}`;
    }).join("\n");
  }
  return interview.transcript || "";
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16&addressdetails=1`, {
      headers: { "User-Agent": "InsightRide/1.0 (market research platform)" },
    });
    if (!res.ok) return null;
    const a = (await res.json()).address || {};
    return {
      postcode: a.postcode || null,
      city: a.city || a.town || a.village || a.municipality || null,
      neighbourhood: a.neighbourhood || a.suburb || a.quarter || a.city_district || null,
    };
  } catch {
    return null;
  }
}

export async function POST(request) {
  try {
    const { interviewId } = await request.json();
    if (!interviewId) return Response.json({ error: "Missing interviewId" }, { status: 400 });

    const { data: interview, error: e1 } = await supabase
      .from("completed_interviews")
      .select("id, contract_id, transcript, diarized_transcript, survey_responses, demographics, latitude, longitude, postcode")
      .eq("id", interviewId).single();
    if (e1 || !interview) throw new Error("Interview not found");
    if (!interview.transcript && !(interview.diarized_transcript || []).length) throw new Error("No transcript to analyse yet");

    const { data: contract } = await supabase
      .from("contracts").select("guide, extraction_schema").eq("id", interview.contract_id).single();

    const questions = (contract?.guide?.questions || []).map((q, i) => `${i + 1}. (${q.type}) ${q.question}`).join("\n") || "No script provided.";
    const extractionSchema = contract?.extraction_schema || [];
    const transcriptText = formatTranscript(interview);

    const system = `You analyse a single in-person market-research interview and return your analysis by calling the save_interview_analysis tool. Follow these rules exactly:
- Identify which diarized speaker is the INTERVIEWER (the one asking the scripted questions) and which is the INTERVIEWEE; report it in speaker_mapping. Quotes should be the interviewee's words.
- summary: 2-4 plain-language sentences.
- quality: an overall score 1-10 plus sub-scores engagement, consistency, specificity, sentiment_diversity (each 1-10). Set flagged_for_exclusion true only when score is below 4, with a flag_reason.
- sentiment.overall must be one of: ${SENTIMENT_VALUES.join(", ")}. by_topic is optional and uses the same five values.
- quotes: a few notable interviewee quotes, verbatim, each with approx_timestamp_seconds taken from the (t=...s) markers, and a short topic.
- extracted_fields: produce ONE entry for EACH field in the EXTRACTION SCHEMA, keyed by that field's "key". Each entry is { value, mentioned, evidence_quote, approx_timestamp_seconds, confidence }.
   - Never fabricate. If the transcript does not contain it, set value to null and mentioned to false.
   - single_select / multi_select: value must come only from that field's options (or null); multi_select returns an array.
   - ordered_list: an array of strings in the exact order spoken.
   - boolean: true/false/null. numeric/scale: a number or null. free_text: a short string. sentiment: one of the five sentiment values.
   - When mentioned, include a short verbatim evidence_quote and its timestamp. confidence is "high", "medium", or "low" - use "low" instead of guessing.
- extraction_warnings: note anything ambiguous, or a spoken answer that matched none of a field's options.
- Do NOT compute statistics, counts, or percentages. Describe only THIS interview. The survey answers and demographics are context only - do not re-extract them.`;

    const userContent = `INTERVIEW SCRIPT:
${questions}

EXTRACTION SCHEMA (produce one entry per field, keyed by "key"):
${JSON.stringify(extractionSchema, null, 2)}

ALREADY-STRUCTURED CONTEXT (do not re-extract; for understanding only):
Demographics: ${JSON.stringify(interview.demographics || {})}
Survey responses: ${JSON.stringify(interview.survey_responses || {})}

TRANSCRIPT:
${transcriptText}

Now call save_interview_analysis with your analysis.`;

    const tool = {
      name: "save_interview_analysis",
      description: "Save the structured analysis of one interview.",
      input_schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          speaker_mapping: { type: "object", properties: { interviewer: { type: "string" }, interviewee: { type: "string" } }, required: ["interviewer", "interviewee"] },
          quality: { type: "object", properties: { score: { type: "integer" }, engagement: { type: "integer" }, consistency: { type: "integer" }, specificity: { type: "integer" }, sentiment_diversity: { type: "integer" }, flagged_for_exclusion: { type: "boolean" }, flag_reason: { type: ["string", "null"] } }, required: ["score", "engagement", "consistency", "specificity", "sentiment_diversity", "flagged_for_exclusion"] },
          sentiment: { type: "object", properties: { overall: { type: "string", enum: SENTIMENT_VALUES }, by_topic: { type: "array", items: { type: "object", properties: { topic: { type: "string" }, sentiment: { type: "string", enum: SENTIMENT_VALUES } }, required: ["topic", "sentiment"] } } }, required: ["overall"] },
          themes: { type: "array", items: { type: "string" } },
          quotes: { type: "array", items: { type: "object", properties: { text: { type: "string" }, speaker: { type: "string" }, approx_timestamp_seconds: { type: ["number", "null"] }, topic: { type: "string" } }, required: ["text"] } },
          extracted_fields: { type: "object", additionalProperties: { type: "object", properties: { value: {}, mentioned: { type: "boolean" }, evidence_quote: { type: ["string", "null"] }, approx_timestamp_seconds: { type: ["number", "null"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } }, required: ["value", "mentioned", "confidence"] } },
          extraction_warnings: { type: "array", items: { type: "string" } },
        },
        required: ["summary", "speaker_mapping", "quality", "sentiment", "themes", "quotes", "extracted_fields", "extraction_warnings"],
      },
    };

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system,
        tools: [tool],
        tool_choice: { type: "tool", name: "save_interview_analysis" },
        messages: [{ role: "user", content: userContent }],
      }),
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error("Claude error: " + (aiData?.error?.message || JSON.stringify(aiData)));
    const toolUse = (aiData.content || []).find((b) => b.type === "tool_use");
    if (!toolUse) throw new Error("Claude did not return structured output");
    const structured = toolUse.input;

    let geo = {};
    if (interview.latitude != null && interview.longitude != null && !interview.postcode) {
      const g = await reverseGeocode(interview.latitude, interview.longitude);
      if (g) geo = g;
    }

    const { error: upErr } = await supabase
      .from("completed_interviews")
      .update({ structured_data: structured, ai_summary: structured.summary || null, quality_score: structured.quality?.score ?? null, status: "summarized", ...geo })
      .eq("id", interviewId);
    if (upErr) throw upErr;

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
