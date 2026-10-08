import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// InsightRide — POST /api/admin/void-interview
// File location in repo: src/app/api/admin/void-interview/route.js
// Body: { interview_id, voided: true|false, reason }
// Admin sign-in required.
//
// Voiding: hides the interview from the client portal (database access rule),
// excludes it from statistics, reports and the HelpBot (database rule sets the
// exclusion flag), and frees its slot in the contract quota. Restoring reverses
// all of it. The quota is RECALCULATED as total minus non-voided interviews, so
// it is correct however the interviews were created (tablet or upload page).
// ============================================================

export const runtime = "nodejs";

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
    const voided = !!(body && body.voided);
    const reason = body && typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!interviewId) return json({ ok: false, error: "interview_id is required" }, 400);

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json({ ok: false, error: "admin sign-in required" }, 403);

    const { data: iv } = await supabase.from("completed_interviews").select("id, contract_id, voided, interview_number").eq("id", interviewId).maybeSingle();
    if (!iv) return json({ ok: false, error: "interview not found" }, 404);

    const patch = voided ? { voided: true, void_reason: reason || null, voided_at: new Date().toISOString() } : { voided: false, void_reason: null, voided_at: null };
    const { error: upErr } = await supabase.from("completed_interviews").update(patch).eq("id", iv.id);
    if (upErr) return json({ ok: false, error: upErr.message }, 500);

    // Recalculate the quota from what actually counts
    const { data: contract } = await supabase.from("contracts").select("id, interviews_total").eq("id", iv.contract_id).maybeSingle();
    let remaining = null;
    let counted = null;
    if (contract) {
      const { count } = await supabase.from("completed_interviews").select("id", { count: "exact", head: true }).eq("contract_id", contract.id).eq("voided", false);
      counted = count || 0;
      remaining = Math.max(0, (contract.interviews_total || 0) - counted);
      await supabase.from("contracts").update({ interviews_remaining: remaining }).eq("id", contract.id);
    }

    return json({ ok: true, interview_number: iv.interview_number, voided, counted, interviews_total: contract ? contract.interviews_total : null, interviews_remaining: remaining });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
