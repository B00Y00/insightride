import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server is missing SUPABASE_SERVICE_ROLE_KEY — add it in Vercel and redeploy.");
  return createClient(url, key);
}

export async function POST(request) {
  try {
    const admin = getAdminClient();

    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { data: caller, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !caller?.user) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", caller.user.id).single();
    if (!callerProfile || callerProfile.role !== "admin") {
      return Response.json({ error: "Admin access only" }, { status: 403 });
    }

    const { email, tempPassword, fullName, role, username } = await request.json();
    const accountRole = role === "interviewer" ? "interviewer" : "client";
    if (!email || !tempPassword) return Response.json({ error: "Email and temporary password are required" }, { status: 400 });
    if (tempPassword.length < 8) return Response.json({ error: "Temporary password must be at least 8 characters" }, { status: 400 });
    if (accountRole === "interviewer" && !username?.trim()) return Response.json({ error: "Interviewer accounts need a username" }, { status: 400 });

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: email.trim(),
      password: tempPassword,
      email_confirm: true,
    });
    if (createErr) throw new Error(createErr.message);

    const { error: profileErr } = await admin.from("profiles").insert([{
      id: created.user.id,
      email: email.trim(),
      role: accountRole,
      full_name: fullName || null,
      username: accountRole === "interviewer" ? username.trim() : null,
      created_by: caller.user.id,
      must_change_password: true,
    }]);
    if (profileErr) throw new Error("Account created but profile failed: " + profileErr.message);

    return Response.json({ ok: true, userId: created.user.id });
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
