"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import AdminGuard from "../AdminGuard";

const F = "var(--font-sans), 'DM Sans', sans-serif";

export default function AdminInboxPage() {
  const [messages, setMessages] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [showHandled, setShowHandled] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const [{ data: m }, { data: p }] = await Promise.all([
      supabase.from("support_messages").select("*").order("created_at", { ascending: false }).limit(300),
      supabase.from("profiles").select("id, email, full_name"),
    ]);
    setMessages(m || []); setProfiles(p || []);
  }
  const who = (id) => { const p = profiles.find((x) => x.id === id); return p ? `${p.full_name || p.email}${p.full_name ? ` (${p.email})` : ""}` : "Unknown client"; };
  async function setStatus(msg, status) { await supabase.from("support_messages").update({ status }).eq("id", msg.id); load(); }

  const visible = messages.filter((m) => showHandled || m.status === "open");

  return (
    <AdminGuard>
      <div style={{ minHeight: "100vh", background: "#0E0E0C", fontFamily: F, paddingBottom: "60px" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1A1A18" }}>
          <a href="/admin" style={{ fontSize: "13px", color: "#D4A017", textDecoration: "none" }}>← Back to admin</a>
          <div style={{ fontSize: "22px", fontWeight: "700", color: "#E8E8E4", marginTop: "6px" }}>Support inbox</div>
          <div style={{ fontSize: "13px", color: "#888880", marginTop: "4px" }}>Client messages land here. Reply to the client by email, then mark the message handled.</div>
        </div>
        <div style={{ padding: "20px 24px", maxWidth: "760px" }}>
          <button onClick={() => setShowHandled(!showHandled)} style={{ marginBottom: "16px", padding: "8px 14px", borderRadius: "8px", border: "1px solid #3A3A38", background: "#1E1E1C", color: "#A8A8A4", fontSize: "12px", cursor: "pointer", fontFamily: F }}>
            {showHandled ? "Hide handled messages" : "Show handled messages"}
          </button>
          {visible.length === 0 && <div style={{ fontSize: "13px", color: "#888880" }}>No {showHandled ? "" : "open "}messages.</div>}
          {visible.map((m) => (
            <div key={m.id} style={{ background: "#1A1A18", border: m.status === "open" ? "1px solid #4A3A20" : "1px solid #2A2A28", borderRadius: "12px", padding: "14px 16px", marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: "600", color: "#E8E8E4" }}>{m.subject}</div>
                  <div style={{ fontSize: "12px", color: "#888880", marginTop: "2px" }}>{who(m.client_id)} · {new Date(m.created_at).toLocaleString()}</div>
                </div>
                <button onClick={() => setStatus(m, m.status === "open" ? "handled" : "open")} style={{ padding: "6px 12px", borderRadius: "8px", border: "none", background: m.status === "open" ? "#1A2A20" : "#2A2A28", color: m.status === "open" ? "#6EC4A7" : "#A8A8A4", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: F }}>
                  {m.status === "open" ? "Mark handled" : "Reopen"}
                </button>
              </div>
              <div style={{ fontSize: "13px", color: "#C8C8C4", lineHeight: "1.7", marginTop: "10px", whiteSpace: "pre-wrap" }}>{m.body}</div>
            </div>
          ))}
        </div>
      </div>
    </AdminGuard>
  );
}
