"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import AdminGuard from "../AdminGuard";

const F = "var(--font-sans), 'DM Sans', sans-serif";
const btn = (bg, color, border) => ({ padding: "7px 13px", borderRadius: "8px", border: border || "none", background: bg, color, fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: F });

export default function ChatLogsPage() {
  const [logs, setLogs] = useState([]);
  const [links, setLinks] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [message, setMessage] = useState("");
  const [openClient, setOpenClient] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    const [{ data: l }, { data: k }, { data: p }, { data: c }, { data: r }] = await Promise.all([
      supabase.from("chat_logs").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("client_contracts").select("*"),
      supabase.from("profiles").select("id, email, full_name").eq("role", "client"),
      supabase.from("contracts").select("id, client, topic"),
      supabase.from("prompt_requests").select("*").eq("status", "pending").order("created_at", { ascending: true }),
    ]);
    setLogs(l || []); setLinks(k || []); setProfiles(p || []); setContracts(c || []); setRequests(r || []);
  }

  const pName = (id) => { const p = profiles.find((x) => x.id === id); return p ? (p.full_name || p.email) : "Unknown client"; };
  const cName = (id) => { const c = contracts.find((x) => x.id === id); return c ? `${c.client}: ${c.topic}` : "(deleted)"; };

  async function grantPrompts(link, amount) {
    await supabase.from("client_contracts").update({ prompt_allowance: (link.prompt_allowance ?? 50) + amount }).eq("id", link.id);
    setMessage(`Allowance raised by ${amount}.`); load();
  }
  async function unpause(link) {
    await supabase.from("client_contracts").update({ chat_paused: false }).eq("id", link.id);
    setMessage("Chat restored for this client."); load();
  }
  async function handleRequest(req) {
    const link = links.find((l) => l.client_id === req.client_id && l.contract_id === req.contract_id);
    if (link) await supabase.from("client_contracts").update({ prompt_allowance: (link.prompt_allowance ?? 50) + 25 }).eq("id", link.id);
    await supabase.from("prompt_requests").update({ status: "handled" }).eq("id", req.id);
    setMessage("Granted +25 prompts and marked the request handled."); load();
  }

  return (
    <AdminGuard>
      <div style={{ minHeight: "100vh", background: "#0E0E0C", fontFamily: F, paddingBottom: "60px" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1A1A18" }}>
          <a href="/admin" style={{ fontSize: "13px", color: "#D4A017", textDecoration: "none" }}>← Back to admin</a>
          <div style={{ fontSize: "22px", fontWeight: "700", color: "#E8E8E4", marginTop: "6px" }}>Chatbot logs & controls</div>
        </div>

        <div style={{ padding: "20px 24px", maxWidth: "820px" }}>
          {message && <div style={{ padding: "12px 14px", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", background: "#1A2A20", color: "#6EC4A7" }}>{message}</div>}

          {requests.length > 0 && (
            <div style={{ background: "#2A2520", border: "1px solid #4A3A20", borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#D4A017", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "10px" }}>Prompt requests ({requests.length})</div>
              {requests.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", padding: "10px 0", borderTop: "1px solid #3A3020", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "13px", color: "#E8E8E4" }}>{pName(r.client_id)} <span style={{ color: "#888880" }}>· {cName(r.contract_id)} · {new Date(r.created_at).toLocaleString()}</span></div>
                  <button onClick={() => handleRequest(r)} style={btn("#D4A017", "#0E0E0C")}>Grant +25 prompts</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "12px" }}>Per-client summary</div>
          {links.map((link) => {
            const clientLogs = logs.filter((l) => l.client_id === link.client_id && l.contract_id === link.contract_id);
            const answered = clientLogs.filter((l) => l.status === "answered").length;
            const flagged = clientLogs.filter((l) => l.status === "flagged").length;
            const cost = clientLogs.reduce((s, l) => s + Number(l.cost_estimate || 0), 0);
            const key = link.id;
            return (
              <div key={key} style={{ background: "#1A1A18", border: flagged >= 10 ? "1px solid #E06050" : "1px solid #2A2A28", borderRadius: "12px", padding: "14px", marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <div style={{ fontSize: "14px", color: "#E8E8E4", fontWeight: "600" }}>
                      {pName(link.client_id)}
                      {flagged >= 10 && <span style={{ marginLeft: "8px", fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#3A2020", color: "#E06050", fontWeight: "700" }}>⚠ {flagged} FLAGGED QUESTIONS</span>}
                      {link.chat_paused && <span style={{ marginLeft: "8px", fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#3A2020", color: "#E06050", fontWeight: "700" }}>CHAT PAUSED</span>}
                    </div>
                    <div style={{ fontSize: "12px", color: "#888880", marginTop: "3px" }}>{cName(link.contract_id)}</div>
                    <div style={{ fontSize: "12px", color: "#A8A8A4", marginTop: "5px" }}>
                      {answered} / {link.prompt_allowance ?? 50} used · {flagged} flagged · est. cost ${cost.toFixed(4)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button onClick={() => grantPrompts(link, 25)} style={btn("#1A2A20", "#6EC4A7", "1px solid #2A3A2E")}>+25 prompts</button>
                    {link.chat_paused && <button onClick={() => unpause(link)} style={btn("#D4A017", "#0E0E0C")}>Restore chat</button>}
                    <button onClick={() => setOpenClient(openClient === key ? null : key)} style={btn("#1E1E1C", "#A8A8A4", "1px solid #3A3A38")}>{openClient === key ? "Hide log" : "View log"}</button>
                  </div>
                </div>
                {openClient === key && (
                  <div style={{ marginTop: "12px", borderTop: "1px solid #2A2A28", paddingTop: "10px", maxHeight: "400px", overflowY: "auto" }}>
                    {clientLogs.length === 0 && <div style={{ fontSize: "12px", color: "#888880" }}>No questions yet.</div>}
                    {clientLogs.map((l) => (
                      <div key={l.id} style={{ padding: "9px 0", borderBottom: "1px solid #222220" }}>
                        <div style={{ fontSize: "11px", color: "#888880", marginBottom: "3px" }}>
                          {new Date(l.created_at).toLocaleString()} · <span style={{ color: l.status === "flagged" ? "#E06050" : l.status === "failed" ? "#D4A017" : "#6EC4A7" }}>{l.status}</span> · ${Number(l.cost_estimate || 0).toFixed(4)}
                        </div>
                        <div style={{ fontSize: "13px", color: "#E8E8E4" }}>{l.question}</div>
                        {l.answer && <div style={{ fontSize: "12px", color: "#A8A8A4", marginTop: "4px", lineHeight: "1.6" }}>{l.answer.slice(0, 300)}{l.answer.length > 300 ? "…" : ""}</div>}
                      </div>
                    ))}
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
