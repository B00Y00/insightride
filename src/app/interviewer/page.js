"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

const F = "var(--font-sans), 'DM Sans', sans-serif";
const AGE_OPTIONS = ["", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
const GENDER_OPTIONS = ["", "Male", "Female", "Non-binary", "Prefer not to say"];
const ETHNICITY_OPTIONS = ["", "White", "South Asian", "East Asian", "Southeast Asian", "Black", "Middle Eastern", "Latin American", "Indigenous", "Mixed/Other", "Prefer not to say"];
const PROFESSION_OPTIONS = ["", "Healthcare", "Medical", "Technology", "Finance", "Legal", "Education", "Retail / Service", "Trades / Construction", "Executive", "Student", "Retired", "Other"];
const input = { width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #3A3A38", background: "#0E0E0C", color: "#E8E8E4", fontSize: "13px", fontFamily: F, boxSizing: "border-box", outline: "none" };
const label = { fontSize: "11px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: "5px" };

export default function InterviewerApp() {
  const [state, setState] = useState("checking"); // checking | ok | denied
  const [me, setMe] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [online, setOnline] = useState(false);
  const [openContract, setOpenContract] = useState(null);
  const [tab, setTab] = useState("guide"); // guide | upload
  const [demo, setDemo] = useState({ ageRange: "", gender: "", ethnicity: "", profession: "" });
  const [lat, setLat] = useState(""); const [lng, setLng] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [myUploads, setMyUploads] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      const { data: prof } = await supabase.from("profiles").select("id, role, username, full_name").eq("id", user.id).single();
      if (!prof || (prof.role !== "interviewer" && prof.role !== "admin")) { setState("denied"); return; }
      setMe(prof);
      const { data: c } = await supabase.from("contracts").select("*").order("created_at", { ascending: false });
      setContracts(c || []);
      const { data: loc } = await supabase.from("interviewer_locations").select("status").eq("interviewer_id", user.id).maybeSingle();
      if (loc && loc.status === "available") setOnline(true);
      setState("ok");
    })();
  }, []);

  function getPosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null), { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  async function toggleOnline() {
    if (!me) return;
    if (online) {
      await supabase.from("interviewer_locations")
        .upsert({ interviewer_id: me.id, name: me.username || me.full_name || "Interviewer", status: "offline", updated_at: new Date().toISOString() }, { onConflict: "interviewer_id" });
      setOnline(false);
      return;
    }
    const pos = await getPosition();
    if (!pos) { setMessage({ type: "error", text: "Couldn't get your location — allow location access to go online." }); return; }
    await supabase.from("interviewer_locations")
      .upsert({ interviewer_id: me.id, name: me.username || me.full_name || "Interviewer", latitude: pos.lat, longitude: pos.lng, status: "available", updated_at: new Date().toISOString() }, { onConflict: "interviewer_id" });
    setOnline(true);
    setMessage({ type: "ok", text: "You're online — the admin can see your location." });
  }

  async function openUpload(c) {
    setOpenContract(c); setTab("upload"); setMessage(null);
    setDemo({ ageRange: "", gender: "", ethnicity: "", profession: "" }); setFile(null);
    const pos = await getPosition();
    if (pos) { setLat(String(pos.lat)); setLng(String(pos.lng)); } else { setLat(""); setLng(""); }
    const { data: { user } } = await supabase.auth.getUser();
    // count my uploads for this contract (via server-visible chat? no — simple: we can't select interviews; show session count only)
    setMyUploads(null);
  }

  async function handleUpload() {
    setMessage(null);
    if (!openContract) return;
    if (!file) { setMessage({ type: "error", text: "Choose a video file first." }); return; }
    setBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
      const path = `${openContract.id}/iv-${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("interview-videos").upload(path, file, { contentType: file.type || "video/mp4" });
      if (upErr) throw upErr;

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/interviewer/complete-upload", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ contractId: openContract.id, videoPath: path, demographics: demo, latitude: lat ? parseFloat(lat) : null, longitude: lng ? parseFloat(lng) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload record failed");
      setMessage({ type: "ok", text: `Interview #${data.interview_number} uploaded — thank you. It's now queued for processing.` });
      setFile(null); setDemo({ ageRange: "", gender: "", ethnicity: "", profession: "" });
      const el = document.getElementById("iv-file"); if (el) el.value = "";
    } catch (e) {
      setMessage({ type: "error", text: "Upload failed: " + (e.message || String(e)) });
    } finally { setBusy(false); }
  }

  async function signOut() { await supabase.auth.signOut(); window.location.href = "/login"; }

  if (state === "checking") return <div style={{ minHeight: "100vh", background: "#0E0E0C", color: "#888880", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F, fontSize: "14px" }}>Checking access…</div>;
  if (state === "denied") return (
    <div style={{ minHeight: "100vh", background: "#0E0E0C", color: "#E8E8E4", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: F, padding: "24px", textAlign: "center" }}>
      <div style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px" }}>Interviewer access only</div>
      <div style={{ fontSize: "14px", color: "#888880", marginBottom: "20px" }}>Sign in with an interviewer account to use this app.</div>
      <a href="/login" style={{ padding: "12px 22px", borderRadius: "9px", background: "#D4A017", color: "#0E0E0C", fontSize: "14px", fontWeight: "600", textDecoration: "none" }}>Go to sign in</a>
    </div>
  );

  const demoFields = [["ageRange", "Age range", AGE_OPTIONS], ["gender", "Gender", GENDER_OPTIONS], ["ethnicity", "Ethnicity", ETHNICITY_OPTIONS], ["profession", "Profession", PROFESSION_OPTIONS]];

  return (
    <div style={{ minHeight: "100vh", background: "#0E0E0C", fontFamily: F, paddingBottom: "60px" }}>
      <div style={{ padding: "18px 20px", borderBottom: "1px solid #1A1A18", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <div style={{ fontSize: "11px", color: "#888880", letterSpacing: "0.08em", textTransform: "uppercase" }}>InsightRide</div>
          <div style={{ fontSize: "19px", fontWeight: "700", color: "#E8E8E4" }}>Interviewer App</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "13px", color: "#A8A8A4" }}>{me?.username || me?.full_name}</span>
          <button onClick={toggleOnline} style={{ padding: "10px 16px", borderRadius: "10px", border: "none", background: online ? "#1A2A20" : "#D4A017", color: online ? "#6EC4A7" : "#0E0E0C", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: F }}>
            {online ? "● Online — tap to go offline" : "Go Online"}
          </button>
          <button onClick={signOut} style={{ padding: "10px 14px", borderRadius: "10px", border: "1px solid #3A3A38", background: "#1A1A18", color: "#A8A8A4", fontSize: "13px", cursor: "pointer", fontFamily: F }}>Sign out</button>
        </div>
      </div>

      <div style={{ padding: "18px 20px", maxWidth: "680px" }}>
        {message && <div style={{ padding: "12px 14px", borderRadius: "10px", marginBottom: "14px", fontSize: "13px", background: message.type === "error" ? "#3A2020" : "#1A2A20", color: message.type === "error" ? "#E06050" : "#6EC4A7", lineHeight: "1.5" }}>{message.text}</div>}

        {!openContract && (
          <>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "12px" }}>Available contracts</div>
            {contracts.length === 0 && <div style={{ fontSize: "13px", color: "#888880" }}>No contracts right now — check back soon.</div>}
            {contracts.map((c) => (
              <div key={c.id} style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "14px", padding: "16px", marginBottom: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "2px" }}>{c.client}</div>
                    <div style={{ fontSize: "15px", color: "#E8E8E4", fontWeight: "500", lineHeight: "1.4" }}>{c.topic}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "14px" }}>
                    <div style={{ fontSize: "18px", fontWeight: "700", color: "#D4A017" }}>${c.interviewer_payout}</div>
                    <div style={{ fontSize: "11px", color: "#888880" }}>per interview</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                  <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#2A2A28", color: "#A8A8A4" }}>{c.type}</span>
                  <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#2A2A28", color: "#A8A8A4" }}>~{c.estimated_minutes} min</span>
                  <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#2A2A28", color: "#A8A8A4" }}>Interviewee gets ${c.interviewee_incentive}</span>
                  <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#2A2A28", color: "#A8A8A4" }}>{c.interviews_remaining} needed</span>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => { setOpenContract(c); setTab("guide"); setMessage(null); }} style={{ flex: 1, padding: "11px", borderRadius: "9px", border: "1px solid #3A3A38", background: "#1E1E1C", color: "#A8A8A4", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: F }}>View guide</button>
                  <button onClick={() => openUpload(c)} style={{ flex: 1, padding: "11px", borderRadius: "9px", border: "none", background: "#D4A017", color: "#0E0E0C", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: F }}>Upload interview</button>
                </div>
              </div>
            ))}
          </>
        )}

        {openContract && (
          <div>
            <button onClick={() => setOpenContract(null)} style={{ fontSize: "13px", color: "#D4A017", background: "none", border: "none", cursor: "pointer", fontFamily: F, padding: 0, marginBottom: "12px" }}>← All contracts</button>
            <div style={{ fontSize: "11px", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "2px" }}>{openContract.client}</div>
            <div style={{ fontSize: "17px", color: "#E8E8E4", fontWeight: "600", lineHeight: "1.4", marginBottom: "14px" }}>{openContract.topic}</div>

            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              {[["guide", "Interview guide"], ["upload", "Upload interview"]].map(([v, lbl]) => (
                <button key={v} onClick={() => setTab(v)} style={{ padding: "9px 16px", borderRadius: "20px", border: tab === v ? "2px solid #D4A017" : "1.5px solid #3A3A38", background: tab === v ? "#2A2520" : "#1A1A18", color: tab === v ? "#F0D060" : "#A8A8A4", fontSize: "13px", fontWeight: tab === v ? "600" : "400", cursor: "pointer", fontFamily: F }}>{lbl}</button>
              ))}
            </div>

            {tab === "guide" && (
              <div style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "16px" }}>
                {openContract.guide?.objective && (
                  <div style={{ marginBottom: "14px" }}>
                    <div style={label}>Objective</div>
                    <div style={{ fontSize: "13.5px", color: "#C8C8C4", lineHeight: "1.7" }}>{openContract.guide.objective}</div>
                  </div>
                )}
                <div style={label}>Questions</div>
                {(openContract.guide?.questions || []).map((q, i) => (
                  <div key={i} style={{ marginBottom: "10px", paddingBottom: "10px", borderBottom: "1px solid #222220" }}>
                    <div style={{ fontSize: "13.5px", color: "#E8E8E4" }}>{i + 1}. {q.question} <span style={{ fontSize: "11px", color: "#888880" }}>({q.type})</span></div>
                    {(q.follow_ups || []).filter(Boolean).map((fu, j) => (
                      <div key={j} style={{ fontSize: "12.5px", color: "#8AA890", marginTop: "3px", paddingLeft: "16px" }}>→ {fu}</div>
                    ))}
                  </div>
                ))}
                {(openContract.guide?.tips || []).length > 0 && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={label}>Tips</div>
                    {(openContract.guide.tips || []).map((t, i) => (
                      <div key={i} style={{ fontSize: "12.5px", color: "#C8C8C4", lineHeight: "1.6", marginBottom: "4px" }}>• {t}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "upload" && (
              <div style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "16px" }}>
                <div style={{ fontSize: "12.5px", color: "#888880", lineHeight: "1.6", marginBottom: "14px" }}>
                  Upload the recorded interview and enter the interviewee's demographics. Your location fills in automatically.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
                  {demoFields.map(([key, lbl, opts]) => (
                    <div key={key}>
                      <label style={label}>{lbl}</label>
                      <select style={{ ...input, cursor: "pointer" }} value={demo[key]} onChange={(e) => setDemo({ ...demo, [key]: e.target.value })}>
                        {opts.map((o) => <option key={o} value={o}>{o === "" ? "— not set —" : o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: "14px" }}>
                  <label style={label}>Location (auto-filled)</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input style={input} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" />
                    <input style={input} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude" />
                    <button onClick={async () => { const p = await getPosition(); if (p) { setLat(String(p.lat)); setLng(String(p.lng)); } }} style={{ padding: "0 14px", borderRadius: "10px", border: "1px solid #3A3A38", background: "#1E1E1C", color: "#A8A8A4", fontSize: "12px", cursor: "pointer", fontFamily: F, whiteSpace: "nowrap" }}>Refresh</button>
                  </div>
                </div>
                <div style={{ marginBottom: "16px" }}>
                  <label style={label}>Interview video</label>
                  <input id="iv-file" type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ ...input, padding: "10px 14px", cursor: "pointer" }} />
                </div>
                <button onClick={handleUpload} disabled={busy || !file} style={{ width: "100%", padding: "14px", borderRadius: "11px", border: "none", background: busy || !file ? "#3A3A38" : "#D4A017", color: busy || !file ? "#888880" : "#0E0E0C", fontSize: "15px", fontWeight: "700", cursor: busy || !file ? "not-allowed" : "pointer", fontFamily: F }}>
                  {busy ? "Uploading… keep this page open" : "Upload interview"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
