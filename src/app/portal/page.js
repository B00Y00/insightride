"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const ink = "#0F1F18", pine = "#1B6B4A", porcelain = "#EEF1EC", card = "#FFFFFF",
  line = "#D9DED7", text = "#1A241E", faint = "#63705F";
const serif = "'Young Serif', Georgia, serif";
const sans = "'Outfit', sans-serif";
const mono = "'IBM Plex Mono', ui-monospace, monospace";

export default function ClientPortal() {
  const [state, setState] = useState("loading"); // loading | ok
  const [profile, setProfile] = useState(null);
  const [contracts, setContracts] = useState([]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      const { data: prof } = await supabase.from("profiles").select("role, full_name, email").eq("id", user.id).single();
      setProfile(prof || { email: user.email });
      const { data: linkRows } = await supabase
        .from("client_contracts")
        .select("contract_id, access_revoked, contracts ( id, client, topic, type, estimated_minutes, interviews_total, interviews_remaining, created_at )")
        .eq("access_revoked", false);
      const list = (linkRows || []).map((r) => r.contracts).filter(Boolean);
      setContracts(list);
      setState("ok");
    })();
  }, []);

  async function signOut() { await supabase.auth.signOut(); window.location.href = "/login"; }

  if (state === "loading") {
    return <div style={{ minHeight: "100vh", background: porcelain, display: "flex", alignItems: "center", justifyContent: "center", color: faint, fontFamily: sans, fontSize: "14px" }}>Loading your portal…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: porcelain, fontFamily: sans }}>
      <link href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Outfit:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ background: ink, padding: "18px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: serif, fontSize: "22px", color: porcelain }}>InsightRide</div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "13px", color: "#B9C6BB" }}>{profile?.full_name || profile?.email}</span>
          {profile?.role === "admin" && <a href="/admin" style={{ fontSize: "13px", color: "#7FA893", textDecoration: "none" }}>Admin dashboard</a>}
          <button onClick={signOut} style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #2E4F3F", background: "transparent", color: "#B9C6BB", fontSize: "13px", cursor: "pointer", fontFamily: sans }}>Sign out</button>
        </div>
      </div>

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "36px 24px" }}>
        <h1 style={{ fontFamily: serif, fontSize: "26px", color: ink, margin: "0 0 6px" }}>Your research contracts</h1>
        <p style={{ fontSize: "14px", color: faint, margin: "0 0 28px", lineHeight: "1.6" }}>Each contract holds its interview videos, transcripts, and final report.</p>

        {contracts.length === 0 ? (
          <div style={{ background: card, border: `1.5px solid ${line}`, borderRadius: "14px", padding: "36px", textAlign: "center" }}>
            <div style={{ fontFamily: serif, fontSize: "18px", color: ink, marginBottom: "8px" }}>No contracts yet</div>
            <div style={{ fontSize: "14px", color: faint, lineHeight: "1.6" }}>When InsightRide assigns a research contract to your account, it will appear here.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }}>
            {contracts.map((c) => {
              const done = c.interviews_total - c.interviews_remaining;
              const pct = c.interviews_total > 0 ? Math.round((done / c.interviews_total) * 100) : 0;
              return (
                <div key={c.id} style={{ background: card, border: `1.5px solid ${line}`, borderRadius: "14px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <div style={{ fontFamily: mono, fontSize: "10px", color: pine, letterSpacing: "0.1em", marginBottom: "8px" }}>{(c.type || "RESEARCH").toUpperCase()} · ~{c.estimated_minutes} MIN INTERVIEWS</div>
                    <div style={{ fontFamily: serif, fontSize: "18px", color: ink, lineHeight: "1.4" }}>{c.topic}</div>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                      <span style={{ fontSize: "12px", color: faint }}>Interviews completed</span>
                      <span style={{ fontSize: "12px", color: text, fontWeight: "600" }}>{done} of {c.interviews_total}</span>
                    </div>
                    <div style={{ height: "6px", background: "#E2E7E0", borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: pine, borderRadius: "3px" }} />
                    </div>
                  </div>
                  <a href={`/portal/${c.id}`} style={{ padding: "12px 14px", borderRadius: "9px", background: pine, color: "#fff", fontSize: "13.5px", fontWeight: "600", textAlign: "center", textDecoration: "none" }}>
                    Open contract →
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
