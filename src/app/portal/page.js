"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme, sans, mono, FONT_LINK, Icon } from "./theme";

export default function ClientPortal() {
  const [T] = useTheme();
  const [state, setState] = useState("loading");
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
      setContracts((linkRows || []).map((r) => r.contracts).filter(Boolean));
      setState("ok");
    })();
  }, []);

  async function signOut() { await supabase.auth.signOut(); window.location.href = "/login"; }

  if (state === "loading") {
    return <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontFamily: sans, fontSize: "14px" }}>Loading your portal…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: sans }}>
      <link href={FONT_LINK} rel="stylesheet" />

      <div style={{ background: T.ink, padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ fontWeight: 700, letterSpacing: "-0.02em", fontSize: "19px", color: "#EEF1EC" }}>InsightRide</div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", color: "#B9C6BB" }}>{profile?.full_name || profile?.email}</span>
          {profile?.role === "admin" && <a href="/admin" style={{ fontSize: "13px", color: "#7FA893", textDecoration: "none" }}>Admin dashboard</a>}
          <a href="/portal/settings" title="Settings" style={{ display: "flex", alignItems: "center", color: "#B9C6BB", textDecoration: "none" }}><Icon name="settings" size={18} /></a>
          <button onClick={signOut} style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #2E4F3F", background: "transparent", color: "#B9C6BB", fontSize: "13px", cursor: "pointer", fontFamily: sans }}>Sign out</button>
        </div>
      </div>

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "36px 24px" }}>
        <h1 style={{ fontSize: "23px", fontWeight: 700, letterSpacing: "-0.01em", color: T.text, margin: "0 0 6px" }}>Your research contracts</h1>
        <p style={{ fontSize: "14px", color: T.faint, margin: "0 0 28px", lineHeight: "1.6" }}>Each contract holds its interview videos, transcripts, and final report.</p>

        {contracts.length === 0 ? (
          <div style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "14px", padding: "36px", textAlign: "center" }}>
            <div style={{ fontSize: "17px", fontWeight: 700, color: T.text, marginBottom: "8px" }}>No contracts yet</div>
            <div style={{ fontSize: "14px", color: T.faint, lineHeight: "1.6" }}>When InsightRide assigns a research contract to your account, it will appear here.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }}>
            {contracts.map((c) => {
              const done = c.interviews_total - c.interviews_remaining;
              const pct = c.interviews_total > 0 ? Math.round((done / c.interviews_total) * 100) : 0;
              return (
                <div key={c.id} style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "14px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <div style={{ fontFamily: mono, fontSize: "10px", color: T.pine, letterSpacing: "0.1em", marginBottom: "8px" }}>{(c.type || "RESEARCH").toUpperCase()} · ~{c.estimated_minutes} MIN INTERVIEWS</div>
                    <div style={{ fontSize: "16.5px", fontWeight: 600, color: T.text, lineHeight: "1.4", letterSpacing: "-0.01em" }}>{c.topic}</div>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                      <span style={{ fontSize: "12px", color: T.faint }}>Interviews completed</span>
                      <span style={{ fontSize: "12px", color: T.text, fontWeight: 600 }}>{done} of {c.interviews_total}</span>
                    </div>
                    <div style={{ height: "6px", background: T.track, borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: T.pine, borderRadius: "3px" }} />
                    </div>
                  </div>
                  <a href={`/portal/${c.id}`} style={{ padding: "12px 14px", borderRadius: "9px", background: T.pine, color: "#fff", fontSize: "13.5px", fontWeight: 600, textAlign: "center", textDecoration: "none" }}>
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
