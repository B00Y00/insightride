"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useTheme, sans, FONT_LINK, Icon, LIGHT, DARK } from "../theme";

export default function SettingsPage() {
  const [T, themeName, setThemeName] = useTheme();
  const [userId, setUserId] = useState(null);
  const [name, setName] = useState("");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [message, setMessage] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data?.user) { window.location.href = "/login"; return; }
      setUserId(data.user.id);
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", data.user.id).single();
      if (p?.full_name) setName(p.full_name);
    });
  }, []);

  async function setTheme(next) {
    setThemeName(next);
    if (userId) await supabase.from("profiles").update({ theme: next }).eq("id", userId);
  }

  async function saveName() {
    if (!userId) return;
    const { error } = await supabase.from("profiles").update({ full_name: name.trim() || null }).eq("id", userId);
    setMessage(error ? { type: "err", text: "Couldn't save your name: " + error.message } : { type: "ok", text: "Display name saved." });
  }

  async function changePassword() {
    setMessage(null);
    if (pass1.length < 8) { setMessage({ type: "err", text: "New password must be at least 8 characters." }); return; }
    if (pass1 !== pass2) { setMessage({ type: "err", text: "Passwords don't match." }); return; }
    const { error } = await supabase.auth.updateUser({ password: pass1 });
    if (error) setMessage({ type: "err", text: "Couldn't change password: " + error.message });
    else { setMessage({ type: "ok", text: "Password changed." }); setPass1(""); setPass2(""); }
  }

  const card = { background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "14px", padding: "22px", marginBottom: "16px" };
  const label = { fontSize: "12px", fontWeight: 600, color: T.faint, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: "7px" };
  const input = { width: "100%", padding: "13px 15px", borderRadius: "9px", border: `1.5px solid ${T.line}`, background: T.inputBg, color: T.text, fontSize: "14.5px", fontFamily: sans, boxSizing: "border-box", outline: "none" };
  const btn = { padding: "11px 18px", borderRadius: "9px", border: "none", background: T.pine, color: "#fff", fontSize: "13.5px", fontWeight: 600, cursor: "pointer", fontFamily: sans };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: sans }}>
      <link href={FONT_LINK} rel="stylesheet" />
      <div style={{ background: T.ink, padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, letterSpacing: "-0.02em", fontSize: "19px", color: "#EEF1EC" }}>InsightRide</div>
        <a href="/portal" style={{ fontSize: "13px", color: "#B9C6BB", textDecoration: "none" }}>← Back to portal</a>
      </div>

      <div style={{ maxWidth: "620px", margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px", color: T.pine }}>
          <Icon name="settings" size={22} />
          <span style={{ fontSize: "19px", fontWeight: 700, letterSpacing: "-0.01em", color: T.text }}>Settings</span>
        </div>

        {message && <div style={{ padding: "12px 14px", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", background: message.type === "err" ? T.errBg : T.pineSoft, color: message.type === "err" ? T.errText : T.pine }}>{message.text}</div>}

        <div style={card}>
          <label style={label}>Appearance</label>
          <div style={{ display: "flex", gap: "10px" }}>
            {[["light", "Light", LIGHT], ["dark", "Dark", DARK]].map(([key, lbl, P]) => (
              <button key={key} onClick={() => setTheme(key)} style={{ flex: 1, padding: "14px", borderRadius: "11px", border: themeName === key ? `2px solid ${T.pine}` : `1.5px solid ${T.line}`, background: P.bg, cursor: "pointer", fontFamily: sans, textAlign: "left" }}>
                <div style={{ width: "100%", height: "34px", borderRadius: "7px", background: P.card, border: `1px solid ${P.line}`, marginBottom: "8px" }} />
                <span style={{ fontSize: "13.5px", fontWeight: themeName === key ? 700 : 500, color: P.text }}>{lbl}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={card}>
          <label style={label}>Display name</label>
          <div style={{ display: "flex", gap: "10px" }}>
            <input style={{ ...input, flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="How should we greet you?" />
            <button onClick={saveName} style={btn}>Save</button>
          </div>
        </div>

        <div style={card}>
          <label style={label}>Change password</label>
          <input style={{ ...input, marginBottom: "10px" }} type="password" value={pass1} onChange={(e) => setPass1(e.target.value)} placeholder="New password (at least 8 characters)" />
          <input style={{ ...input, marginBottom: "12px" }} type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="Confirm new password" />
          <button onClick={changePassword} style={btn}>Change password</button>
        </div>
      </div>
    </div>
  );
}
