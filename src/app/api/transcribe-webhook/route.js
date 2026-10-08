import { createClient } from "@supabase/supabase-js";

// ============================================================
// InsightRide — POST /api/transcribe-webhook   (called by AssemblyAI)
// File location in repo: src/app/api/transcribe-webhook/route.js
//
// Re-fetches the transcript from AssemblyAI (never trusts the webhook body).
//  - Part of a resumed interview (found in interview_transcript_parts): store it
//    with timestamps shifted onto the interview clock and part-2+ speakers renamed
//    (A -> A2), then merge once every part is back -> transcript, diarized_transcript,
//    status "transcribed".
//  - Ordinary interview: save transcript + diarized_transcript, status "transcribed".
// Always returns 200 so AssemblyAI doesn't retry.
// ============================================================

async function fetchTranscript(transcriptId) {
  const res = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
    headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
  });
  return await res.json();
}

// Move a part's utterances onto the interview's continuous clock
function shiftUtterances(utterances, part, offsetMs) {
  const off = Number(offsetMs) || 0;
  const rename = (s) => (part > 1 && s != null && s !== "" ? String(s) + part : s);
  return (utterances || []).map((u) => ({
    ...u,
    speaker: rename(u.speaker),
    start: (Number(u.start) || 0) + off,
    end: (Number(u.end) || 0) + off,
    part,
    words: Array.isArray(u.words) ? u.words.map((w) => ({ ...w, start: (Number(w.start) || 0) + off, end: (Number(w.end) || 0) + off, speaker: rename(w.speaker) })) : u.words,
  }));
}

// Combine the parts once none is still waiting. Safe to run more than once (same result).
function combineParts(parts) {
  const done = parts.filter((p) => p.status === "completed").sort((a, b) => a.part - b.part);
  const diarized = done.flatMap((p) => (Array.isArray(p.utterances) ? p.utterances : [])).sort((a, b) => (a.start || 0) - (b.start || 0));
  const texts = parts
    .slice()
    .sort((a, b) => a.part - b.part)
    .map((p) => {
      if (p.status !== "completed") return `[Part ${p.part} of the recording could not be transcribed]`;
      return p.part > 1 ? `[Recording resumed — part ${p.part}]\n${p.text || ""}` : p.text || "";
    });
  return { anyDone: done.length > 0, diarized, transcript: texts.join("\n\n").trim() };
}

async function mergeParts(supabase, interviewId) {
  const { data: parts } = await supabase.from("interview_transcript_parts").select("part, status, text, utterances").eq("interview_id", interviewId).order("part");
  if (!parts || !parts.length) return;
  if (parts.some((p) => p.status === "submitted")) return; // still waiting for another part
  const merged = combineParts(parts);
  if (!merged.anyDone) {
    await supabase.from("completed_interviews").update({ status: "failed" }).eq("id", interviewId);
    return;
  }
  await supabase
    .from("completed_interviews")
    .update({ transcript: merged.transcript, diarized_transcript: merged.diarized, status: "transcribed" })
    .eq("id", interviewId);
}

export async function POST(request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const body = await request.json();
    const transcriptId = body.transcript_id;
    const status = body.status;
    if (!transcriptId) return Response.json({ ok: true });

    // 1. One part of a resumed (multi-part) interview?
    const { data: partRow } = await supabase
      .from("interview_transcript_parts")
      .select("id, interview_id, part, offset_ms")
      .eq("assemblyai_id", transcriptId)
      .maybeSingle();
    if (partRow) {
      if (status === "error") {
        const t = await fetchTranscript(transcriptId).catch(() => ({}));
        await supabase.from("interview_transcript_parts").update({ status: "error", error: (t && t.error) || "AssemblyAI reported an error", completed_at: new Date().toISOString() }).eq("id", partRow.id);
      } else if (status === "completed") {
        const t = await fetchTranscript(transcriptId);
        await supabase
          .from("interview_transcript_parts")
          .update({ status: "completed", text: t.text || "", utterances: shiftUtterances(t.utterances || [], partRow.part, partRow.offset_ms), completed_at: new Date().toISOString() })
          .eq("id", partRow.id);
      } else {
        return Response.json({ ok: true });
      }
      await mergeParts(supabase, partRow.interview_id);
      return Response.json({ ok: true });
    }

    // 2. Ordinary single-file interview (unchanged behaviour)
    const { data: interview } = await supabase
      .from("completed_interviews")
      .select("id")
      .eq("assemblyai_id", transcriptId)
      .maybeSingle();
    if (!interview) return Response.json({ ok: true }); // not one of ours

    if (status === "error") {
      await supabase.from("completed_interviews").update({ status: "failed" }).eq("id", interview.id);
      return Response.json({ ok: true });
    }

    if (status === "completed") {
      // Re-fetch the real transcript from AssemblyAI (don't trust the webhook body)
      const t = await fetchTranscript(transcriptId);
      await supabase
        .from("completed_interviews")
        .update({ transcript: t.text || "", diarized_transcript: t.utterances || [], status: "transcribed" })
        .eq("id", interview.id);
    }

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: true, note: e.message || String(e) }); // always 200 so AssemblyAI doesn't retry
  }
}
