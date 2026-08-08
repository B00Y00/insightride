"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import AdminGuard from "../AdminGuard";

const F = "var(--font-sans), 'DM Sans', sans-serif";
const input = { width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #3A3A38", background: "#0E0E0C", color: "#E8E8E4", fontSize: "13px", fontFamily: F, boxSizing: "border-box", outline: "none" };
const label = { fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: "6px" };
const btn = (bg, color, border) => ({ padding: "7px 13px", borderRadius: "8px", border: border || "none", background: bg, color, fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: F });

export default function AdminInterviewersPage() {
  const [interviewers, setInterviewers] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [records, setRecords] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({ email: "", username: "", fullName: "", tempPassword: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  useEffect(() => { loadAll(); }, []);
  async function loadAll() {
    const [{ data: p }, { data: c }, { data: d }, { data: u }, { data: l }] = await Promise.all([
      supabase.from("profiles").select("id, email, role, full_name, username, reputation, created_at, created_by, must_change_password"),
      supabase.from("contracts").select("id, client, topic"),
      supabase.from("disciplinary_records").select("*").order("created_at", { ascending: false }),
      supabase.from("completed_interviews").select("id, contract_id, interview_number, quality_score, status, created_at, uploaded_by").not("uploaded_by", "is", null).order("created_at", { ascending: false }),
      supabase.from("interviewer_locations").select("*").order("updated_at", { ascending: false }),
    ]);
    setAllProfiles(p || []);
    setInterviewers((p || []).filter((x) => x.role === "interviewer"));
    setContracts(c || []); setRecords(d || []); setUploads(u || []); setLocations(l || []);
  }

  const who = (id) => { const p = allProfiles.find((x) => x.id === id); return p ? (p.username || p.full_name || p.email) : "—"; };
  const contractName = (id) => { const c = contracts.find((x) => x.id === id); return c ? `${c.client}: ${c.topic}` : "(deleted)"; };

  async function createInterviewer() {
    setMessage(""); setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your admin session expired — sign in again at /login.");
      const res = await fetch("/api/admin/create-client", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: form.email, tempPassword: form.tempPassword, fullName: form.fullName, username: form.username, role: "interviewer" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create interviewer");
      setMessage(`Interviewer "${form.username}" created. Give them: email "${form.email}" and the temporary password. They'll set their own password on first sign-in.`);
      setForm({ email: "", username: "", fullName: "", tempPassword: "" });
      loadAll();
    } catch (e) { setMessage("Error: " + (e.message || String(e))); }
    finally { setBusy(false); }
  }

  async function addStrike(iv, kind) {
    const points = kind === "severe" ? -3 : -1;
    const reason = prompt(`Reason for this ${kind} strike for ${iv.username || iv.email}:`);
    if (reason === null) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error: e1 } = await supabase.from("disciplinary_records").insert([{ interviewer_id: iv.id, kind, points, reason: reason || null, created_by: user?.id || null }]);
    if (e1) { setMessage("Error: " + e1.message); return; }
    const { error: e2 } = await supabase.from("profiles").update({ reputation: (iv.reputation ?? 0) + points }).eq("id", iv.id);
    setMessage(e2 ? "Error: " + e2.message : `${kind === "severe" ? "Severe strike (-3)" : "Strike (-1)"} recorded for ${iv.username || iv.email}.`);
    loadAll();
  }

  async function resetReputation(iv) {
    if (!confirm(`Reset ${iv.username || iv.email}'s reputation to 0? Their history stays visible.`)) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("disciplinary_records").insert([{ interviewer_id: iv.id, kind: "reset", points: 0, reason: "Reputation reset to 0 by admin", created_by: user?.id || null }]);
    const { error } = await supabase.from("profiles").update({ reputation: 0 }).eq("id", iv.id);
    setMessage(error ? "Error: " + error.message : "Reputation reset to 0 (history kept).");
    loadAll();
  }

  return (
    <AdminGuard>
      <div style={{ minHeight: "100vh", background: "#0E0E0C", fontFamily: F, paddingBottom: "60px" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1A1A18" }}>
          <a href="/admin" style={{ fontSize: "13px", color: "#D4A017", textDecoration: "none" }}>← Back to admin</a>
          <div style={{ fontSize: "22px", fontWeight: "700", color: "#E8E8E4", marginTop: "6px" }}>Interviewer accounts</div>
          <div style={{ fontSize: "13px", color: "#888880", marginTop: "4px" }}>Create interviewer logins, track upload history and quality, and manage disciplinary records. Interviewers cannot see this page or their own records.</div>
        </div>

        <div style={{ padding: "20px 24px", maxWidth: "820px" }}>
          {message && <div style={{ padding: "12px 14px", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", background: message.startsWith("Error") ? "#3A2020" : "#1A2A20", color: message.startsWith("Error") ? "#E06050" : "#6EC4A7", lineHeight: "1.5" }}>{message}</div>}

          <div style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "16px", marginBottom: "24px" }}>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "#D4A017", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "12px" }}>Create an interviewer account</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div><label style={label}>Email</label><input style={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="interviewer@email.com" /></div>
              <div><label style={label}>Username / UserID</label><input style={input} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. AlexR-01" /></div>
              <div><label style={label}>Real (legal) name</label><input style={input} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="e.g. Alexandra Reyes" /></div>
              <div><label style={label}>Temporary password (min 8 chars)</label><input style={input} value={form.tempPassword} onChange={(e) => setForm({ ...form, tempPassword: e.target.value })} placeholder="e.g. Ride2026Start" /></div>
            </div>
            <button onClick={createInterviewer} disabled={busy || !form.email || !form.username || form.tempPassword.length < 8} style={{ padding: "12px 20px", borderRadius: "10px", border: "none", background: busy || !form.email || !form.username || form.tempPassword.length < 8 ? "#3A3A38" : "#D4A017", color: busy || !form.email || !form.username || form.tempPassword.length < 8 ? "#888880" : "#0E0E0C", fontSize: "14px", fontWeight: "700", cursor: "pointer", fontFamily: F }}>
              {busy ? "Creating…" : "Create interviewer"}
            </button>
          </div>

          <div style={{ fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "12px" }}>Interviewers ({interviewers.length})</div>
          {interviewers.length === 0 && <div style={{ fontSize: "13px", color: "#888880" }}>No interviewer accounts yet.</div>}
          {interviewers.map((iv) => {
            const ivUploads = uploads.filter((u) => u.uploaded_by === iv.id);
            const scored = ivUploads.filter((u) => typeof u.quality_score === "number");
            const avg = scored.length ? Math.round((scored.reduce((s, u) => s + u.quality_score, 0) / scored.length) * 10) / 10 : null;
            const ivRecords = records.filter((r) => r.interviewer_id === iv.id);
            const loc = locations.find((l) => l.interviewer_id === iv.id);
            const rep = iv.reputation ?? 0;
            return (
              <div key={iv.id} style={{ background: "#1A1A18", border: rep < 0 ? "1px solid #4A3020" : "1px solid #2A2A28", borderRadius: "12px", padding: "14px 16px", marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: "600", color: "#E8E8E4" }}>
                      {iv.username || "(no username)"}
                      <span style={{ marginLeft: "10px", fontSize: "11px", padding: "3px 9px", borderRadius: "6px", background: rep < 0 ? "#3A2020" : "#1A2A20", color: rep < 0 ? "#E06050" : "#6EC4A7", fontWeight: "700" }}>REP {rep}</span>
                      {avg !== null && <span style={{ marginLeft: "6px", fontSize: "11px", padding: "3px 9px", borderRadius: "6px", background: "#2A2A28", color: "#A8A8A4", fontWeight: "600" }}>AVG QUALITY {avg}/10</span>}
                    </div>
                    <div style={{ fontSize: "12px", color: "#888880", marginTop: "3px" }}>
                      {iv.full_name || "—"} · {iv.email}{iv.must_change_password ? " · hasn't signed in yet" : ""}
                    </div>
                    <div style={{ fontSize: "11.5px", color: "#888880", marginTop: "3px" }}>
                      Created {new Date(iv.created_at).toLocaleDateString()} by {who(iv.created_by)} · {ivUploads.length} upload{ivUploads.length === 1 ? "" : "s"} · Location: {loc ? `${loc.latitude?.toFixed(4)}, ${loc.longitude?.toFixed(4)} (${new Date(loc.updated_at).toLocaleString()})` : "not yet broadcast"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button onClick={() => addStrike(iv, "minor")} style={btn("#2A2520", "#D4A017", "1px solid #4A3A20")}>Strike −1</button>
                    <button onClick={() => addStrike(iv, "severe")} style={btn("#3A2020", "#E06050", "1px solid #4A2A2A")}>Severe −3</button>
                    <button onClick={() => resetReputation(iv)} style={btn("#1A2A20", "#6EC4A7", "1px solid #2A3A2E")}>Reset to 0</button>
                    <button onClick={() => setOpen(open === iv.id ? null : iv.id)} style={btn("#1E1E1C", "#A8A8A4", "1px solid #3A3A38")}>{open === iv.id ? "Hide details" : "Details"}</button>
                  </div>
                </div>

                {open === iv.id && (
                  <div style={{ marginTop: "12px", borderTop: "1px solid #2A2A28", paddingTop: "12px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "8px" }}>Interview history</div>
                    {ivUploads.length === 0 ? <div style={{ fontSize: "12.5px", color: "#888880", marginBottom: "12px" }}>No uploads yet.</div> : (
                      <div style={{ marginBottom: "14px" }}>
                        {ivUploads.map((u) => (
                          <div key={u.id} style={{ fontSize: "12.5px", color: "#C8C8C4", padding: "5px 0", borderBottom: "1px solid #222220" }}>
                            Interview {u.interview_number} — {contractName(u.contract_id)} · {new Date(u.created_at).toLocaleString()} · quality: {typeof u.quality_score === "number" ? `${u.quality_score}/10` : "pending"}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "8px" }}>Disciplinary history</div>
                    {ivRecords.length === 0 ? <div style={{ fontSize: "12.5px", color: "#888880" }}>Clean record.</div> : (
                      ivRecords.map((r) => (
                        <div key={r.id} style={{ fontSize: "12.5px", color: r.kind === "reset" ? "#6EC4A7" : "#E0A090", padding: "5px 0", borderBottom: "1px solid #222220" }}>
                          {new Date(r.created_at).toLocaleString()} · {r.kind === "reset" ? "RESET to 0" : r.kind === "severe" ? "SEVERE (−3)" : "STRIKE (−1)"} · by {who(r.created_by)}{r.reason ? ` · ${r.reason}` : ""}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AdminGuard>
  );
}
