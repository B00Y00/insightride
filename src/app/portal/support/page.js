"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useTheme, sans, FONT_LINK, Icon } from "../theme";

export default function SupportPage() {
  const [T] = useTheme();
  const [userId, setUserId] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data?.user) { window.location.href = "/login"; return; }
      setUserId(data.user.id);
      const { data: msgs } = await supabase.from("support_messages").select("subject, status, created_at")
        .eq("client_id", data.user.id).order("created_at", { ascending: false }).limit(20);
      setHistory(msgs || []);
    });
  }, []);

  async function send() {
    if (!subject.trim() || !body.trim() || !userId) return;
    setBusy(true); setMessage(null);
    const { error } = await supabase.from("support_messages").insert([{ client_id: userId, subject: subject.trim(), body: body.trim() }]);
    if (error) setMessage({ type: "err", text: "Couldn't send your message: " + error.message });
    else {
      setMessage({ type: "ok", text: "Message sent — InsightRide will get back to you by email." });
      setHistory([{ subject: subject.trim(), status: "open", created_at: new Date().toISOString() }, ...history]);
      setSubject(""); setBody("");
    }
    setBusy(false);
  }

  const input = { width: "100%", padding: "13px 15px", borderRadius: "9px", border: `1.5px solid ${T.line}`, background: T.inputBg, color: T.text, fontSize: "14.5px", fontFamily: sans, boxSizing: "border-box", outline: "none" };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: sans }}>
      <link href={FONT_LINK} rel="stylesheet" />
      <div style={{ background: T.ink, padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, letterSpacing: "-0.02em", fontSize: "19px", color: "#EEF1EC" }}>InsightRide</div>
        <a href="/portal" style={{ fontSize: "13px", color: "#B9C6BB", textDecoration: "none" }}>← Back to portal</a>
      </div>

      <div style={{ maxWidth: "620px", margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", color: T.pine }}>
          <Icon name="chat" size={22} />
          <span style={{ fontSize: "19px", fontWeight: 700, letterSpacing: "-0.01em", color: T.text }}>Support</span>
        </div>
        <p style={{ fontSize: "13.5px", color: T.faint, margin: "0 0 22px", lineHeight: "1.6" }}>Report a problem or ask a question — your message goes straight to the InsightRide team.</p>

        {message && <div style={{ padding: "12px 14px", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", background: message.type === "err" ? T.errBg : T.pineSoft, color: message.type === "err" ? T.errText : T.pine }}>{message.text}</div>}

        <div style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "14px", padding: "22px", marginBottom: "20px" }}>
          <input style={{ ...input, marginBottom: "10px" }} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject — e.g. Can't play interview 4" />
          <textarea style={{ ...input, minHeight: "140px", resize: "vertical", lineHeight: "1.6", marginBottom: "12px" }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe the issue or question…" />
          <button onClick={send} disabled={busy || !subject.trim() || !body.trim()} style={{ padding: "12px 20px", borderRadius: "9px", border: "none", background: busy || !subject.trim() || !body.trim() ? T.line : T.pine, color: "#fff", fontSize: "14px", fontWeight: 600, cursor: busy || !subject.trim() || !body.trim() ? "not-allowed" : "pointer", fontFamily: sans }}>
            {busy ? "Sending…" : "Send message"}
          </button>
        </div>

        {history.length > 0 && (
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, color: T.faint, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "10px" }}>Your messages</div>
            {history.map((m, i) => (
              <div key={i} style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "11px", padding: "12px 16px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                <div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: T.text }}>{m.subject}</div>
                  <div style={{ fontSize: "11.5px", color: T.faint }}>{new Date(m.created_at).toLocaleString()}</div>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, padding: "4px 10px", borderRadius: "7px", background: m.status === "open" ? T.warnBg : T.pineSoft, color: m.status === "open" ? T.warnText : T.pine }}>{m.status === "open" ? "OPEN" : "HANDLED"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
