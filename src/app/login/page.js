"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

const ink = "#0F1F18", pine = "#1B6B4A", pineDark = "#14523A", porcelain = "#EEF1EC",
  card = "#FFFFFF", line = "#D9DED7", text = "#1A241E", faint = "#63705F";
const serif = "'Young Serif', Georgia, serif";
const sans = "'Outfit', sans-serif";
const mono = "'IBM Plex Mono', ui-monospace, monospace";

function youtubeEmbed(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [stage, setStage] = useState("signin");
  const [pendingRole, setPendingRole] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sections, setSections] = useState([]);
  const [openSection, setOpenSection] = useState(null);
  const [updates, setUpdates] = useState([]);

  useEffect(() => {
    supabase.from("site_content").select("*").then(({ data }) => {
      const order = ["terms_of_use", "cookie_policy", "faq", "customer_service"];
      if (data) setSections(order.map((k) => data.find((d) => d.key === k)).filter(Boolean));
    });
    supabase.from("site_updates").select("*").eq("published", true)
      .order("created_at", { ascending: false }).limit(12)
      .then(({ data }) => { if (data) setUpdates(data); });
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
        {/* Left: company updates */}
        <div style={{ flex: "1 1 380px", background: ink, color: porcelain, padding: "44px 44px 36px", display: "flex", flexDirection: "column", minHeight: "320px" }}>
          <div style={{ fontFamily: serif, fontSize: "30px", letterSpacing: "0.01em", marginBottom: "28px" }}>InsightRide</div>

          <div style={{ fontFamily: mono, fontSize: "11px", color: "#7FA893", letterSpacing: "0.1em", marginBottom: "14px" }}>UPDATES</div>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: "62vh", paddingRight: "6px" }}>
            {updates.length === 0 ? (
              <div style={{ fontSize: "14px", color: "#B9C6BB" }}>No updates posted yet.</div>
            ) : (
              updates.map((u) => {
                const embed = youtubeEmbed(u.video_url);
                return (
                  <div key={u.id} style={{ background: "#16281F", border: "1px solid #244435", borderRadius: "12px", padding: "18px", marginBottom: "12px" }}>
                    <div style={{ fontFamily: mono, fontSize: "10px", color: "#7FA893", letterSpacing: "0.08em", marginBottom: "8px" }}>
                      {new Date(u.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }).toUpperCase()}
                    </div>
                    <div style={{ fontFamily: serif, fontSize: "17px", color: porcelain, marginBottom: "8px", lineHeight: "1.4" }}>{u.title}</div>
                    <div style={{ fontSize: "13.5px", color: "#B9C6BB", lineHeight: "1.7", whiteSpace: "pre-wrap" }}>{u.body}</div>
                    {embed && (
                      <div style={{ marginTop: "12px", borderRadius: "8px", overflow: "hidden", aspectRatio: "16 / 9" }}>
                        <iframe src={embed} title={u.title} style={{ width: "100%", height: "100%", border: "none" }} allowFullScreen />
                      </div>
                    )}
                    {u.video_url && !embed && (
                      <a href={u.video_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: "10px", fontSize: "13px", color: "#7FA893" }}>Watch video</a>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: sign-in (unchanged) */}
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

      {/* Footer: centered links, © pinned bottom-right */}
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
        <div style={{ position: "relative", padding: "18px 24px" }}>
          <div style={{ display: "flex", gap: "26px", flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
            {sections.map((s) => (
              <button key={s.key} onClick={() => setOpenSection(openSection?.key === s.key ? null : s)} style={{ background: "none", border: "none", color: openSection?.key === s.key ? pine : faint, fontSize: "13px", fontWeight: openSection?.key === s.key ? "600" : "400", cursor: "pointer", fontFamily: sans, padding: 0 }}>
                {s.title}
              </button>
            ))}
          </div>
          <span style={{ position: "absolute", right: "24px", bottom: "18px", fontFamily: mono, fontSize: "11px", color: "#93A092" }}>© {new Date().getFullYear()} InsightRide</span>
        </div>
      </div>
    </div>
  );
}
