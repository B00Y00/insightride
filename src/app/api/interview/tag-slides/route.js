import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tagInterview, TagError } from "../../../../lib/tagslides";

// ============================================================
// InsightRide — POST /api/interview/tag-slides   { interview_id }
// File location in repo: src/app/api/interview/tag-slides/route.js
// Admin sign-in required. The tagging logic lives in src/lib/tagslides.js and
// also runs automatically at the end of Run AI (/api/summarize); this route is
// the manual "Tag slides" / "Re-tag slides" button on /admin/tablet.
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 60;

function json(b, s) {
  return NextResponse.json(b, { status: s || 200 });
}
async function requireAdmin(req, supabase) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return profile && profile.role === "admin" ? data.user : null;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const interviewId = body && body.interview_id;
    if (!interviewId) return json({ ok: false, error: "interview_id is required" }, 400);
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json({ ok: false, error: "admin sign-in required" }, 403);
    const result = await tagInterview(supabase, interviewId);
    return json(result);
  } catch (e) {
    const status = e instanceof TagError ? e.status : 500;
    return json({ ok: false, error: String((e && e.message) || e) }, status);
  }
}
