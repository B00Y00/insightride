import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// InsightRide — POST /api/interview/upload-url
// File location in repo: src/app/api/interview/upload-url/route.js
//
// Called by the tablet before uploading each video file of an interview.
// Verifies the tablet (session_id + device_id) and returns a signed upload URL
// for the PRIVATE bucket, so video goes straight from the tablet to Supabase
// Storage (never through Vercel, which caps request bodies).
//   part 1 : reserves the next interview number for the contract
//   part 2+: (resumed interviews) reuses the interview_number from part 1
// Path: contractId/interview-N-<runtag>[-partK].ext  — the folder is still the
// contract UUID (storage access rules depend on that); the run tag keeps two
// tablets uploading at the same moment from overwriting each other.
// ============================================================

export const runtime = "nodejs";

function json(body, status) {
  return NextResponse.json(body, { status: status || 200 });
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { session_id, device_id, contract_id, run_id } = body || {};
    const ext = body && body.ext === "mp4" ? "mp4" : "webm";
    const part = Math.max(1, parseInt((body && body.part) || "1", 10) || 1);
    if (!session_id || !device_id || !contract_id || !run_id) return json({ ok: false, error: "missing fields" }, 400);

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: session } = await supabase.from("interview_sessions").select("id, device_id").eq("id", session_id).maybeSingle();
    if (!session || session.device_id !== device_id) return json({ ok: false, error: "tablet session not recognised" }, 403);

    const { data: contract } = await supabase.from("contracts").select("id").eq("id", contract_id).maybeSingle();
    if (!contract) return json({ ok: false, error: "contract not found" }, 404);

    let n;
    if (part === 1) {
      // Idempotency: if this run was already saved (e.g. the tablet lost the reply), say so
      const { data: existing } = await supabase.from("completed_interviews").select("id, interview_number, video_url").eq("contract_id", contract_id).eq("recording_meta->>run_id", run_id).maybeSingle();
      if (existing) return json({ ok: true, already_complete: true, interview_id: existing.id, interview_number: existing.interview_number, path: existing.video_url });
      const { data: maxRows } = await supabase.from("completed_interviews").select("interview_number").eq("contract_id", contract_id).order("interview_number", { ascending: false }).limit(1);
      n = ((maxRows && maxRows[0] && maxRows[0].interview_number) || 0) + 1;
    } else {
      n = parseInt(body.interview_number, 10);
      if (!n) return json({ ok: false, error: "interview_number is required for part " + part }, 400);
    }

    const tag = String(run_id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "run";
    const path = contract_id + "/interview-" + n + "-" + tag + (part > 1 ? "-part" + part : "") + "." + ext;

    const { data: signed, error } = await supabase.storage.from("interview-videos").createSignedUploadUrl(path, { upsert: true });
    if (error || !signed) return json({ ok: false, error: (error && error.message) || "could not create the upload link" }, 500);

    return json({ ok: true, path: signed.path || path, token: signed.token, interview_number: n, part });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
