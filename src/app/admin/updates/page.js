"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import AdminGuard from "../AdminGuard";

const F = "var(--font-sans), 'DM Sans', sans-serif";
const input = { width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #3A3A38", background: "#0E0E0C", color: "#E8E8E4", fontSize: "13px", fontFamily: F, boxSizing: "border-box", outline: "none" };
const label = { fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: "6px" };

export default function AdminUpdatesPage() {
  const [updates, setUpdates] = useState([]);
  const [form, setForm] = useState({ title: "", body: "", video_url: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from("site_updates").select("*").order("created_at", { ascending: false });
    if (data) setUpdates(data);
  }

  async function post() {
    if (!form.title.trim()) { setMessage("Error: a title is required."); return; }
    setBusy(true); setMessage("");
    const { error } = await supabase.from("site_updates").insert([{ title: form.title, body: form.body, video_url: form.video_url || null }]);
    setMessage(error ? "Error: " + error.message : "Update posted. It now shows on the login page.");
    if (!error) setForm({ title: "", body: "", video_url: "" });
    setBusy(false); load();
  }

  async function saveEdit(u) {
    const { error } = await supabase.from("site_updates").update({ title: u.title, body: u.body, video_url: u.video_url || null, published: u.published }).eq("id", u.id);
    setMessage(error ? "Error: " + error.message : "Saved.");
    load();
  }

  async function remove(id) {
    if (confirm("Delete this update permanently?")) { await supabase.from("site_updates").delete().eq("id", id); load(); }
  }

  return (
    <AdminGuard>
      <div style={{ minHeight: "100vh", background: "#0E0E0C", fontFamily: F, paddingBottom: "60px" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1A1A18" }}>
          <a href="/admin" style={{ fontSize: "13px", color: "#D4A017", textDecoration: "none" }}>← Back to admin</a>
          <div style={{ fontSize: "22px", fontWeight: "700", color: "#E8E8E4", marginTop: "6px" }}>Login page updates</div>
          <div style={{ fontSize: "13px", color: "#888880", marginTop: "4px" }}>Posts here appear in the Updates panel on the login page. Paste a YouTube link to embed a video.</div>
        </div>

        <div style={{ padding: "20px 24px", maxWidth: "760px" }}>
          {message && <div style={{ padding: "12px 14px", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", background: message.startsWith("Error") ? "#3A2020" : "#1A2A20", color: message.startsWith("Error") ? "#E06050" : "#6EC4A7" }}>{message}</div>}

          <div style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "16px", marginBottom: "24px" }}>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "#D4A017", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "12px" }}>Post a new update</div>
            <div style={{ marginBottom: "12px" }}><label style={label}>Title</label><input style={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. New: interactive statistics dashboard" /></div>
            <div style={{ marginBottom: "12px" }}><label style={label}>Body</label><textarea style={{ ...input, minHeight: "100px", resize: "vertical", lineHeight: "1.6" }} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="What changed, and what it means for clients or interviewers." /></div>
            <div style={{ marginBottom: "14px" }}><label style={label}>Video link (optional, YouTube)</label><input style={input} value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} placeholder="https://www.youtube.com/watch?v=..." /></div>
            <button onClick={post} disabled={busy} style={{ padding: "12px 20px", borderRadius: "10px", border: "none", background: "#D4A017", color: "#0E0E0C", fontSize: "14px", fontWeight: "700", cursor: "pointer", fontFamily: F }}>{busy ? "Posting…" : "Post update"}</button>
          </div>

          <div style={{ fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "12px" }}>Existing updates</div>
          {updates.map((u, i) => (
            <div key={u.id} style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "14px", marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", color: "#888880", marginBottom: "8px" }}>{new Date(u.created_at).toLocaleString()} · {u.published ? "visible" : "hidden"}</div>
              <input style={{ ...input, marginBottom: "8px" }} value={u.title} onChange={(e) => setUpdates(updates.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
              <textarea style={{ ...input, minHeight: "80px", resize: "vertical", marginBottom: "8px", lineHeight: "1.6" }} value={u.body} onChange={(e) => setUpdates(updates.map((x, j) => j === i ? { ...x, body: e.target.value } : x))} />
              <input style={{ ...input, marginBottom: "10px" }} value={u.video_url || ""} onChange={(e) => setUpdates(updates.map((x, j) => j === i ? { ...x, video_url: e.target.value } : x))} placeholder="Video link (optional)" />
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button onClick={() => saveEdit(u)} style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: "#6EC4A7", color: "#0E0E0C", fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: F }}>Save changes</button>
                <button onClick={() => saveEdit({ ...u, published: !u.published })} style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #3A3A38", background: "#1E1E1C", color: "#A8A8A4", fontSize: "12px", cursor: "pointer", fontFamily: F }}>{u.published ? "Hide from login page" : "Show on login page"}</button>
                <button onClick={() => remove(u.id)} style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: "none", color: "#E06050", fontSize: "12px", cursor: "pointer", fontFamily: F }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminGuard>
  );
}
