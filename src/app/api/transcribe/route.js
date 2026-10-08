import { createClient } from "@supabase/supabase-js";

// ============================================================
// InsightRide — POST /api/transcribe  { interviewId }
// File location in repo: src/app/api/transcribe/route.js
//
// Signed video URL -> AssemblyAI (speaker labels, 2 speakers expected), with a
// webhook to SITE_URL/api/transcribe-webhook. Status -> transcribing.
// Resumed tablet interviews (recording_meta.parts has 2+ files): every part is
// sent, one row per part goes into interview_transcript_parts, and the webhook
// merges them onto one continuous timeline when all parts are back.
// Tablet interviews in a language other than English pass that language code.
// ============================================================

export const maxDuration = 60;

// AssemblyAI language code from the interview language ("de", "fr", "pt-br" -> "pt"...).
// English (and unknown) keeps AssemblyAI's default, exactly as before.
function aaiLanguage(lang) {
  const base = String(lang || "").toLowerCase().split(/[-_]/)[0];
  if (!base || base === "en") return null;
  return /^[a-z]{2,3}$/.test(base) ? base : null;
}

export async function POST(request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const { interviewId } = await request.json();
    if (!interviewId) return Response.json({ error: "Missing interviewId" }, { status: 400 });

    const { data: interview, error: loadErr } = await supabase
      .from("completed_interviews")
      .select("id, video_url, recording_meta, language")
      .eq("id", interviewId)
      .single();
    if (loadErr || !interview) throw new Error("Interview not found");
    if (!interview.video_url) throw new Error("This interview has no video file");

    const base = (process.env.SITE_URL || "").replace(/\/$/, "");
    const language = aaiLanguage(interview.language);

    async function submit(path) {
      // Temporary private link to the video (valid 2 hours)
      const { data: signed, error: signErr } = await supabase.storage.from("interview-videos").createSignedUrl(path, 7200);
      if (signErr || !signed?.signedUrl) throw new Error("Could not create a link to the video (" + path + ")");
      const body = {
        audio_url: signed.signedUrl,
        speaker_labels: true,
        speakers_expected: 2,
        webhook_url: `${base}/api/transcribe-webhook`,
      };
      if (language) body.language_code = language;
      const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "POST",
        headers: { authorization: process.env.ASSEMBLYAI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const aaiData = await aaiRes.json();
      if (!aaiRes.ok || !aaiData.id) throw new Error("AssemblyAI error: " + (aaiData.error || JSON.stringify(aaiData)));
      return aaiData.id;
    }

    const meta = interview.recording_meta && typeof interview.recording_meta === "object" ? interview.recording_meta : {};
    const parts = Array.isArray(meta.parts) ? meta.parts.filter((p) => p && p.path) : [];

    // Ordinary single-file interview (unchanged behaviour)
    if (parts.length < 2) {
      const id = await submit(interview.video_url);
      await supabase.from("completed_interviews").update({ assemblyai_id: id, status: "transcribing" }).eq("id", interviewId);
      return Response.json({ ok: true, assemblyai_id: id });
    }

    // Resumed interview: every part, merged later by the webhook
    await supabase.from("interview_transcript_parts").delete().eq("interview_id", interviewId);
    const ids = [];
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      const partNo = Number(p.part) || k + 1;
      const id = await submit(p.path);
      const { error: insErr } = await supabase.from("interview_transcript_parts").insert([
        { interview_id: interviewId, part: partNo, path: p.path, offset_ms: Math.max(0, Math.round(Number(p.offset_ms) || 0)), assemblyai_id: id, status: "submitted" },
      ]);
      if (insErr) throw new Error("Could not record transcription part " + partNo + ": " + insErr.message + " (has the Step 9D migration been run?)");
      ids.push(id);
    }
    await supabase
      .from("completed_interviews")
      .update({ assemblyai_id: ids[0], status: "transcribing", transcript: null, diarized_transcript: null })
      .eq("id", interviewId);

    return Response.json({ ok: true, assemblyai_id: ids[0], parts: ids.length });
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
