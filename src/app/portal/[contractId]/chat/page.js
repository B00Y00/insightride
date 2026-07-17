"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

const ink = "#0F1F18", pine = "#1B6B4A", porcelain = "#EEF1EC", card = "#FFFFFF",
  line = "#D9DED7", text = "#1A241E", faint = "#63705F";
const serif = "'Young Serif', Georgia, serif";
const sans = "'Outfit', sans-serif";
const mono = "'IBM Plex Mono', ui-monospace, monospace";

export default function ChatPage() {
  const { contractId } = useParams();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [counter, setCounter] = useState(null); // { used, allowance }
  const bottomRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      const { data: logs } = await supabase.from("chat_logs").select("question, answer, status, evidence")
        .eq("contract_id", contractId).eq("client_id", user.id).order("created_at", { ascending: true }).limit(60);
      const restored = [];
      (logs || []).forEach((l) => {
        restored.push({ role: "user", text: l.question });
        if (l.answer) restored.push({ role: "ai", text: l.answer, evidence: l.evidence || [] });
      });
      setMessages(restored);
    })();
  }, [contractId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/portal/chat", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ contractId, question: q }),
      });
      const data = await res.json();
      if (data.limitReached) {
        setCounter({ used: data.used, allowance: data.allowance });
        setMessages((m) => [...m, { role: "ai", text: `You've used all ${data.allowance} questions for this contract. Contact InsightRide to request more.` }]);
      } else if (data.error) {
        setMessages((m) => [...m, { role: "ai", text: data.error }]);
      } else {
        if (data.used != null) setCounter({ used: data.used, allowance: data.allowance });
        setMessages((m) => [...m, { role: "ai", text: data.answer, evidence: data.evidence || [], flagged: data.flagged }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "Connection problem — that didn't use one of your prompts. Please try again." }]);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ minHeight: "100vh", background: porcelain, fontFamily: sans, display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Outfit:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ background: ink, padding: "18px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: serif, fontSize: "22px", color: porcelain }}>InsightRide</div>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          {counter && <span style={{ fontFamily: mono, fontSize: "11px", color: "#7FA893" }}>{counter.used} / {counter.allowance} QUESTIONS USED</span>}
          <a href={`/portal/${contractId}`} style={{ fontSize: "13px", color: "#B9C6BB", textDecoration: "none" }}>← Back to contract</a>
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: "760px", width: "100%", margin: "0 auto", padding: "28px 24px 140px", boxSizing: "border-box" }}>
        {messages.length === 0 && (
          <div style={{ background: card, border: `1.5px solid ${line}`, borderRadius: "14px", padding: "24px", fontSize: "14px", color: faint, lineHeight: "1.8" }}>
            <div style={{ fontFamily: serif, fontSize: "17px", color: ink, marginBottom: "8px" }}>Ask your research data</div>
            Ask about your respondents and findings — for example: <em>"What percent of respondents said distance was a barrier?"</em>, <em>"How did women feel about the brand?"</em>, or <em>"Did anyone mention the app being easy to use?"</em> Every number comes from an exact count of your interviews.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: "14px" }}>
            <div style={{ maxWidth: "85%", background: m.role === "user" ? pine : card, color: m.role === "user" ? "#fff" : text, border: m.role === "user" ? "none" : `1.5px solid ${line}`, borderRadius: "14px", padding: "13px 16px", fontSize: "14px", lineHeight: "1.7", whiteSpace: "pre-wrap" }}>
              {m.text}
              {m.evidence && m.evidence.length > 0 && (
                <div style={{ marginTop: "12px", borderTop: `1px solid ${line}`, paddingTop: "10px" }}>
                  <div style={{ fontFamily: mono, fontSize: "10px", color: pine, letterSpacing: "0.1em", marginBottom: "6px" }}>EVIDENCE</div>
                  {m.evidence.map((e, j) => (
                    <div key={j} style={{ fontSize: "13px", color: faint, marginBottom: "5px" }}>
                      Interview {e.interview_number}: “{e.quote}”
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div style={{ fontSize: "13px", color: faint }}>Analyzing your interviews…</div>}
        <div ref={bottomRef} />
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: `linear-gradient(transparent, ${porcelain} 30%)`, padding: "30px 24px 22px" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", gap: "10px" }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask a question about this research…"
            style={{ flex: 1, padding: "15px 18px", borderRadius: "12px", border: `1.5px solid ${line}`, background: card, fontSize: "14.5px", fontFamily: sans, color: text, outline: "none" }} />
          <button onClick={send} disabled={busy || !input.trim()} style={{ padding: "0 24px", borderRadius: "12px", border: "none", background: busy || !input.trim() ? "#B9C6BB" : pine, color: "#fff", fontSize: "14.5px", fontWeight: "600", cursor: busy || !input.trim() ? "not-allowed" : "pointer", fontFamily: sans }}>
            {busy ? "…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
