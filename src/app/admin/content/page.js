"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const F = "var(--font-sans), 'DM Sans', sans-serif";

export default function AdminContentPage() {
  const [sections, setSections] = useState([]);
  const [savingKey, setSavingKey] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from("site_content").select("*");
    const order = ["terms_of_use", "cookie_policy", "faq", "customer_service"];
    if (data) setSections(order.map((k) => data.find((d) => d.key === k)).filter(Boolean));
  }
  async function save(section) {
    setSavingKey(section.key); setMessage("");
    const { error } = await supabase.from("site_content")
      .update({ content: section.content, updated_at: new Date().toISOString() }).eq("key", section.key);
    setMessage(error ? "Error: " + error.message : `Saved "${section.title}".`);
    setSavingKey(null);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0E0E0C", fontFamily: F, paddingBottom: "60px" }}>
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1A1A18" }}>
        <a href="/admin" style={{ fontSize: "13px", color: "#D4A017", textDecoration: "none" }}>← Back to admin</a>
        <div style={{ fontSize: "22px", fontWeight: "700", color: "#E8E8E4", marginTop: "6px" }}>Login page content</div>
        <div style={{ fontSize: "13px", color: "#888880", marginTop: "4px" }}>These four sections appear at the bottom of the login page.</div>
      </div>
      <div style={{ padding: "20px 24px", maxWidth: "760px" }}>
        {message && <div style={{ padding: "12px 14px", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", background: message.startsWith("Error") ? "#3A2020" : "#1A2A20", color: message.startsWith("Error") ? "#E06050" : "#6EC4A7" }}>{message}</div>}
        {sections.map((s, i) => (
          <div key={s.key} style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "16px", marginBottom: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "#D4A017", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "10px" }}>{s.title}</div>
            <textarea value={s.content} onChange={(e) => setSections(sections.map((x, j) => j === i ? { ...x, content: e.target.value } : x))}
              style={{ width: "100%", minHeight: "140px", padding: "12px 14px", borderRadius: "10px", border: "1px solid #3A3A38", background: "#0E0E0C", color: "#E8E8E4", fontSize: "13px", fontFamily: F, boxSizing: "border-box", outline: "none", resize: "vertical", lineHeight: "1.6" }} />
            <button onClick={() => save(s)} disabled={savingKey === s.key} style={{ marginTop: "10px", padding: "10px 18px", borderRadius: "9px", border: "none", background: "#D4A017", color: "#0E0E0C", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: F }}>
              {savingKey === s.key ? "Saving…" : "Save section"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
