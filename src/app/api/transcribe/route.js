import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(request) {
  try {
    const { interviewId } = await request.json();
    if (!interviewId) return Response.json({ error: "Missing interviewId" }, { status: 400 });

    const { data: interview, error: loadErr } = await supabase
      .from("completed_interviews")
      .select("id, video_url")
      .eq("id", interviewId)
      .single();
    if (loadErr || !interview) throw new Error("Interview not found");
    if (!interview.video_url) throw new Error("This interview has no video file");

    // Temporary private link to the video (valid 2 hours)
    const { data: signed, error: signErr } = await supabase
      .storage.from("interview-videos")
      .createSignedUrl(interview.video_url, 7200);
    if (signErr || !signed?.signedUrl) throw new Error("Could not create a link to the video");

    const base = (process.env.SITE_URL || "").replace(/\/$/, "");
    const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { authorization: process.env.ASSEMBLYAI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        audio_url: signed.signedUrl,
        speaker_labels: true,
        speakers_expected: 2,
        webhook_url: `${base}/api/transcribe-webhook`,
      }),
    });
    const aaiData = await aaiRes.json();
    if (!aaiRes.ok || !aaiData.id) throw new Error("AssemblyAI error: " + (aaiData.error || JSON.stringify(aaiData)));

    await supabase
      .from("completed_interviews")
      .update({ assemblyai_id: aaiData.id, status: "transcribing" })
      .eq("id", interviewId);

    return Response.json({ ok: true, assemblyai_id: aaiData.id });
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
