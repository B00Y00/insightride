import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// InsightRide — POST /api/interview/complete
// File location in repo: src/app/api/interview/complete/route.js
//
// Called by the tablet after the video is in Storage. Writes the
// completed_interviews row (the same shape the admin upload page creates,
// plus the tablet's timeline/meta), and decrements the contract's
// interviews_remaining. Idempotent by run_id.
// ============================================================

export const runtime = "nodejs";

function json(body, status) {
  return NextResponse.json(body, { status: status || 200 });
}
function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    const { session_id, device_id, contract_id, run_id, video_path } = b || {};
    if (!session_id || !device_id || !contract_id || !run_id || !video_path) return json({ ok: false, error: "missing fields" }, 400);

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: session } = await supabase.from("interview_sessions").select("id, device_id").eq("id", session_id).maybeSingle();
    if (!session || session.device_id !== device_id) return json({ ok: false, error: "tablet session not recognised" }, 403);

    // Already saved? Return the existing row instead of creating a duplicate.
    const { data: existing } = await supabase.from("completed_interviews").select("id, interview_number").eq("contract_id", contract_id).eq("recording_meta->>run_id", run_id).maybeSingle();
    if (existing) return json({ ok: true, already_complete: true, interview_id: existing.id, interview_number: existing.interview_number });

    // Use the number reserved at upload time unless it was taken meanwhile
    let n = Number(b.interview_number) || null;
    if (n) {
      const { data: clash } = await supabase.from("completed_interviews").select("id").eq("contract_id", contract_id).eq("interview_number", n).maybeSingle();
      if (clash) n = null;
    }
    if (!n) {
      const { data: maxRows } = await supabase.from("completed_interviews").select("interview_number").eq("contract_id", contract_id).order("interview_number", { ascending: false }).limit(1);
      n = ((maxRows && maxRows[0] && maxRows[0].interview_number) || 0) + 1;
    }

    // Interviewee-reported demographics win over interviewer-supplied ones for the same field
    const demographics = { ...(b.interviewer_demographics || {}), ...(b.demographics || {}) };
    const loc = b.end_location || {};

    const row = {
      contract_id,
      interviewer_name: b.interviewer_name || null,
      latitude: num(loc.latitude),
      longitude: num(loc.longitude),
      demographics,
      survey_responses: b.survey_responses || {},
      video_url: video_path,
      interview_number: n,
      status: "uploaded",
      session_id,
      deck_version: Number(b.deck_version) || null,
      language: b.language || null,
      slide_timeline: Array.isArray(b.slide_timeline) ? b.slide_timeline : [],
      slide_meta: b.slide_meta && typeof b.slide_meta === "object" ? b.slide_meta : {},
      recording_meta: { run_id, ...(b.recording && typeof b.recording === "object" ? b.recording : {}), partial: !!b.partial },
    };

    const { data: inserted, error } = await supabase.from("completed_interviews").insert([row]).select("id, interview_number").single();
    if (error || !inserted) return json({ ok: false, error: (error && error.message) || "could not save the interview" }, 500);

    // Quota: one fewer interview remaining (never below zero)
    const { data: c } = await supabase.from("contracts").select("interviews_remaining").eq("id", contract_id).maybeSingle();
    if (c) await supabase.from("contracts").update({ interviews_remaining: Math.max(0, (c.interviews_remaining || 0) - 1) }).eq("id", contract_id);

    return json({ ok: true, interview_id: inserted.id, interview_number: inserted.interview_number });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
