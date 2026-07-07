"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

const ink = "#0F1F18", pine = "#1B6B4A", pineDark = "#14523A", porcelain = "#EEF1EC",
  card = "#FFFFFF", line = "#D9DED7", text = "#1A241E", faint = "#63705F";
const serif = "'Young Serif', Georgia, serif";
const sans = "'Outfit', sans-serif";
const mono = "'IBM Plex Mono', ui-monospace, monospace";

const TRANSCRIPT = [
  ["SPEAKER A", "00:41", 72], ["SPEAKER B", "00:52", 100], ["SPEAKER B", "01:18", 88],
  ["SPEAKER A", "01:31", 55], ["SPEAKER B", "01:44", 96], ["SPEAKER B", "02:20", 64],
  ["SPEAKER A", "02:37", 78], ["SPEAKER B", "02:51", 91],
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [stage, setStage] = useState("signin"); // signin | newpass
  const [pendingRole, setPendingRole] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sections, setSections] = useState([]);
  const [openSection, setOpenSection] = useState(null);

  useEffect(() => {
    supabase.from("site_content").select("*").then(({ data }) => {
      const order = ["terms_of_use", "cookie_policy", "faq", "customer_service"];
      if (data) setSections(order.map((k) => data.find((d) => d.key === k)).filter(Boolean));
    });
  }, []);

  function redirectByRole(role) {
    if (role === "admin") window.location.href = "/admin";
    else if (role === "interviewer") window.location.href = "/interviewer";
    else window.location.href = "/portal";
  }

  async function signIn() {
    setError(""); setBusy(true);
    try {
      const { data, error: authErr } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authErr) throw new Error("Email or password is incorrect.");
      const userId = data.user.id;
      const { data: profile } = await supabase.from("profiles").select("role, must_change_password").eq("id", userId).single();
      if (!profile) throw new Error("This account has no role assigned. Contact your administrator.");
      if (profile.must_change_password) { setPendingRole(profile.role); setStage("newpass"); }
      else redirectByRole(profile.role);
    } catch (e) { setError(e.message || String(e)); } finally { setBusy(false); }
  }

  async function setNewPassword() {
    setError("");
    if (newPass.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPass !== newPass2) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password: newPass });
      if (upErr) throw upErr;
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) await supabase.from("profiles").update({ must_change_password: false }).eq("id", userData.user.id);
      redirectByRole(pendingRole);
    } catch (e) { setError(e.message || String(e)); } finally { setBusy(false); }
  }

  const inputStyle = { width: "100%", padding: "13px 15px", borderRadius: "8px", border: `1.5px solid ${line}`, background: "#FBFCFA", color: text, fontSize: "15px", fontFamily: sans, boxSizing: "border-box", outline: "none" };
  const labelStyle = { fontSize: "12px", fontWeight: "600", color: faint, letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: "7px", fontFamily: sans };

  return (
    <div style={{ minHeight: "100vh", background: porcelain, fontFamily: sans, display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Outfit:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ flex: 1, display: "flex", flexWrap: "wrap" }}>
        {/* Left: transcript motif */}
        <div style={{ flex: "1 1 380px", background: ink, color: porcelain, padding: "48px 44px", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "320px" }}>
          <div>
            <div style={{ fontFamily: serif, fontSize: "30px", letterSpacing: "0.01em" }}>InsightRide</div>
            <div style={{ fontFamily: mono, fontSize: "11px", color: "#7FA893", marginTop: "6px", letterSpacing: "0.08em" }}>IN-PERSON RESEARCH · RECORDED · VERIFIED</div>
          </div>

          <div style={{ margin: "40px 0", maxWidth: "420px" }} aria-hidden="true">
            {TRANSCRIPT.map(([sp, t, w], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px", opacity: 0.9 - i * 0.07 }}>
                <span style={{ fontFamily: mono, fontSize: "10px", color: sp === "SPEAKER A" ? "#7FA893" : "#C8D6CC", width: "86px", flexShrink: 0, letterSpacing: "0.06em" }}>{sp} · {t}</span>
                <span style={{ height: "8px", borderRadius: "4px", background: sp === "SPEAKER A" ? "#24443533" : "#2E4F3F", width: `${w}%`, display: "block", flex: `0 1 ${w}%` }} />
              </div>
            ))}
          </div>

          <div style={{ fontSize: "14px", lineHeight: "1.7", color: "#B9C6BB", maxWidth: "380px" }}>
            Every finding in your portal traces back to a real conversation — recorded, transcribed, and tied to the moment it was said.
          </div>
        </div>

        {/* Right: sign-in */}
        <div style={{ flex: "1 1 420px", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
          <div style={{ width: "100%", maxWidth: "400px" }}>
            <div style={{ background: card, border: `1.5px solid ${line}`, borderRadius: "14px", padding: "34px 30px", boxShadow: "0 2px 14px rgba(15,31,24,0.05)" }}>
              {stage === "signin" ? (
                <>
                  <h1 style={{ fontFamily: serif, fontSize: "24px", color: ink, margin: "0 0 6px" }}>Sign in</h1>
                  <p style={{ fontSize: "14px", color: faint, margin: "0 0 26px", lineHeight: "1.6" }}>Access your research portal.</p>
                  <div style={{ marginBottom: "18px" }}>
                    <label style={labelStyle}>Email</label>
                    <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" onKeyDown={(e) => e.key === "Enter" && signIn()} />
                  </div>
                  <div style={{ marginBottom: "22px" }}>
                    <label style={labelStyle}>Password</label>
                    <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" onKeyDown={(e) => e.key === "Enter" && signIn()} />
                  </div>
                  {error && <div style={{ padding: "11px 14px", borderRadius: "8px", background: "#F7E9E6", color: "#8C3A2B", fontSize: "13px", marginBottom: "16px", lineHeight: "1.5" }}>{error}</div>}
                  <button onClick={signIn} disabled={busy || !email || !password} style={{ width: "100%", padding: "14px", borderRadius: "9px", border: "none", background: busy || !email || !password ? "#B9C6BB" : pine, color: "#fff", fontSize: "15px", fontWeight: "600", cursor: busy || !email || !password ? "not-allowed" : "pointer", fontFamily: sans }}
                    onMouseOver={(e) => { if (!busy && email && password) e.currentTarget.style.background = pineDark; }}
                    onMouseOut={(e) => { if (!busy && email && password) e.currentTarget.style.background = pine; }}>
                    {busy ? "Signing in…" : "Sign in"}
                  </button>
                  <p style={{ fontSize: "12px", color: faint, marginTop: "18px", lineHeight: "1.6" }}>
                    Accounts are created by InsightRide. If you've purchased a research contract and need access, contact your account manager.
                  </p>
                </>
              ) : (
                <>
                  <h1 style={{ fontFamily: serif, fontSize: "24px", color: ink, margin: "0 0 6px" }}>Set a new password</h1>
                  <p style={{ fontSize: "14px", color: faint, margin: "0 0 26px", lineHeight: "1.6" }}>You're signing in with a temporary password. Choose your own to continue.</p>
                  <div style={{ marginBottom: "18px" }}>
                    <label style={labelStyle}>New password</label>
                    <input style={inputStyle} type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="At least 8 characters" />
                  </div>
                  <div style={{ marginBottom: "22px" }}>
                    <label style={labelStyle}>Confirm new password</label>
                    <input style={inputStyle} type="password" value={newPass2} onChange={(e) => setNewPass2(e.target.value)} placeholder="Type it again" onKeyDown={(e) => e.key === "Enter" && setNewPassword()} />
                  </div>
                  {error && <div style={{ padding: "11px 14px", borderRadius: "8px", background: "#F7E9E6", color: "#8C3A2B", fontSize: "13px", marginBottom: "16px", lineHeight: "1.5" }}>{error}</div>}
                  <button onClick={setNewPassword} disabled={busy} style={{ width: "100%", padding: "14px", borderRadius: "9px", border: "none", background: busy ? "#B9C6BB" : pine, color: "#fff", fontSize: "15px", fontWeight: "600", cursor: busy ? "not-allowed" : "pointer", fontFamily: sans }}>
                    {busy ? "Saving…" : "Save password & continue"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer sections */}
      <div style={{ borderTop: `1.5px solid ${line}`, background: "#E7EBE4" }}>
        {openSection && (
          <div style={{ maxWidth: "760px", margin: "0 auto", padding: "26px 24px 6px" }}>
            <div style={{ background: card, border: `1.5px solid ${line}`, borderRadius: "12px", padding: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ fontFamily: serif, fontSize: "18px", color: ink }}>{openSection.title}</div>
                <button onClick={() => setOpenSection(null)} style={{ background: "none", border: "none", color: faint, fontSize: "13px", cursor: "pointer", fontFamily: sans }}>Close</button>
              </div>
              <div style={{ fontSize: "14px", color: text, lineHeight: "1.75", whiteSpace: "pre-wrap" }}>{openSection.content}</div>
            </div>
          </div>
        )}
        <div style={{ maxWidth: "760px", margin: "0 auto", padding: "18px 24px", display: "flex", gap: "26px", flexWrap: "wrap", alignItems: "center" }}>
          {sections.map((s) => (
            <button key={s.key} onClick={() => setOpenSection(openSection?.key === s.key ? null : s.key === openSection?.key ? null : s)} style={{ background: "none", border: "none", color: openSection?.key === s.key ? pine : faint, fontSize: "13px", fontWeight: openSection?.key === s.key ? "600" : "400", cursor: "pointer", fontFamily: sans, padding: 0 }}>
              {s.title}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: "11px", color: "#93A092" }}>© {new Date().getFullYear()} InsightRide</span>
        </div>
      </div>
    </div>
  );
}
