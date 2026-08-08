import { createClient } from "@supabase/supabase-js";

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server is missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key);
}

export async function POST(request) {
  try {
    const admin = db();
    const token = (request.headers.get("authorization") || "").replace("Bearer ", "");
    if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { data: caller } = await admin.auth.getUser(token);
    if (!caller?.user) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { data: prof } = await admin.from("profiles").select("role, username, full_name").eq("id", caller.user.id).single();
    if (!prof || (prof.role !== "interviewer" && prof.role !== "admin")) {
      return Response.json({ error: "Interviewer access only" }, { status: 403 });
    }

    const { contractId, videoPath, demographics, latitude, longitude } = await request.json();
    if (!contractId || !videoPath) return Response.json({ error: "Missing contract or video" }, { status: 400 });
    if (!videoPath.startsWith(`${contractId}/`)) return Response.json({ error: "Video path doesn't match the contract" }, { status: 400 });

    const { data: contract } = await admin.from("contracts").select("id").eq("id", contractId).single();
    if (!contract) return Response.json({ error: "Contract not found" }, { status: 404 });

    const { data: existing } = await admin.from("completed_interviews")
      .select("interview_number").eq("contract_id", contractId)
      .order("interview_number", { ascending: false }).limit(1);
    const nextNumber = ((existing && existing[0] && existing[0].interview_number) || 0) + 1;

    const { error: insertErr } = await admin.from("completed_interviews").insert([{
      contract_id: contractId,
      interview_number: nextNumber,
      interviewer_name: prof.username || prof.full_name || null,
      uploaded_by: caller.user.id,
      demographics: demographics || {},
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      video_url: videoPath,
      status: "uploaded",
    }]);
    if (insertErr) throw insertErr;

    return Response.json({ ok: true, interview_number: nextNumber });
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
