import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(request) {
  try {
    const body = await request.json();
    const transcriptId = body.transcript_id;
    const status = body.status;
    if (!transcriptId) return Response.json({ ok: true });

    const { data: interview } = await supabase
      .from("completed_interviews")
      .select("id")
      .eq("assemblyai_id", transcriptId)
      .single();
    if (!interview) return Response.json({ ok: true }); // not one of ours

    if (status === "error") {
      await supabase.from("completed_interviews").update({ status: "failed" }).eq("id", interview.id);
      return Response.json({ ok: true });
    }

    if (status === "completed") {
      // Re-fetch the real transcript from AssemblyAI (don't trust the webhook body)
      const res = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
      });
      const t = await res.json();
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
