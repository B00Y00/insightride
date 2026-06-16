"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

const AGE_OPTIONS = ["", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
const GENDER_OPTIONS = ["", "Male", "Female", "Non-binary", "Prefer not to say"];
const ETHNICITY_OPTIONS = ["", "White", "South Asian", "East Asian", "Southeast Asian", "Black", "Middle Eastern", "Latin American", "Indigenous", "Mixed/Other", "Prefer not to say"];
const PROFESSION_OPTIONS = ["", "Healthcare", "Medical", "Technology", "Finance", "Legal", "Education", "Retail / Service", "Trades / Construction", "Executive", "Student", "Retired", "Other"];

const F = "var(--font-sans), 'DM Sans', sans-serif";
const BUCKET = "interview-videos";
const label = { fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: "6px" };
const input = { width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #3A3A38", background: "#1A1A18", color: "#E8E8E4", fontSize: "14px", fontFamily: F, boxSizing: "border-box", outline: "none" };
const STATUS_COLORS = { uploaded: "#A8A8A4", transcribing: "#D4A017", transcribed: "#7BAED4", summarized: "#6EC4A7", failed: "#E06050" };
const smallBtn = (bg, color, border) => ({ padding: "6px 12px", borderRadius: "8px", border: border || "none", background: bg, color, fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: F });

function fmtValue(v) {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export default function UploadInterviewPage() {
  const [contracts, setContracts] = useState([]);
  const [contractId, setContractId] = useState("");
  const [interviewerName, setInterviewerName] = useState("");
  const [demo, setDemo] = useState({ ageRange: "", gender: "", ethnicity: "", profession: "" });
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [panel, setPanel] = useState(null); // { id, kind: 'transcript' | 'analysis' }
  const [processingId, setProcessingId] = useState(null);

  useEffect(() => {
    supabase.from("contracts").select("id, client, topic").order("created_at", { ascending: false }).then(({ data }) => { if (data) setContracts(data); });
  }, []);

  async function loadInterviews(cid) {
    if (!cid) { setInterviews([]); return; }
    const { data } = await supabase
      .from("completed_interviews")
      .select("id, interview_number, status, transcript, structured_data, quality_score")
      .eq("contract_id", cid).order("interview_number", { ascending: true });
    if (data) setInterviews(data);
  }

  useEffect(() => {
    loadInterviews(contractId);
    if (!contractId) return;
    const timer = setInterval(() => loadInterviews(contractId), 5000);
    return () => clearInterval(timer);
  }, [contractId]);

  function useMyLocation() {
    if (!navigator.geolocation) { setMessage({ type: "error", text: "This device can't provide a location." }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(String(pos.coords.latitude)); setLng(String(pos.coords.longitude)); },
      () => setMessage({ type: "error", text: "Couldn't get location (permission denied?)." })
    );
  }

  async function handleUpload() {
    setMessage(null);
    if (!contractId) { setMessage({ type: "error", text: "Please choose a contract first." }); return; }
    if (!file) { setMessage({ type: "error", text: "Please choose a video file to upload." }); return; }
    setBusy(true);
    try {
      const { data: existing, error: countErr } = await supabase
        .from("completed_interviews").select("interview_number")
        .eq("contract_id", contractId).order("interview_number", { ascending: false }).limit(1);
      if (countErr) throw countErr;
      const nextNumber = ((existing && existing[0] && existing[0].interview_number) || 0) + 1;

      const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
      const path = `${contractId}/interview-${nextNumber}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || "video/mp4" });
      if (uploadErr) throw uploadErr;

      const row = { contract_id: contractId, interview_number: nextNumber, interviewer_name: interviewerName || null, demographics: demo, latitude: lat ? parseFloat(lat) : null, longitude: lng ? parseFloat(lng) : null, video_url: path, status: "uploaded" };
      const { error: insertErr } = await supabase.from("completed_interviews").insert([row]);
      if (insertErr) throw insertErr;

      setMessage({ type: "ok", text: `Interview #${nextNumber} uploaded (status: uploaded).` });
      setFile(null); setInterviewerName(""); setDemo({ ageRange: "", gender: "", ethnicity: "", profession: "" }); setLat(""); setLng("");
      const el = document.getElementById("video-file-input"); if (el) el.value = "";
      loadInterviews(contractId);
    } catch (e) {
      setMessage({ type: "error", text: "Something went wrong: " + (e.message || String(e)) });
    } finally { setBusy(false); }
  }

  async function transcribe(interviewId) {
    setMessage(null);
    setInterviews((list) => list.map((i) => i.id === interviewId ? { ...i, status: "transcribing" } : i));
    try {
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ interviewId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start transcription");
    } catch (e) {
      setMessage({ type: "error", text: "Couldn't start transcription: " + (e.message || String(e)) });
    } finally { loadInterviews(contractId); }
  }

  async function summarize(interviewId) {
    setMessage(null); setProcessingId(interviewId);
    try {
      const res = await fetch("/api/summarize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ interviewId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to run AI analysis");
    } catch (e) {
      setMessage({ type: "error", text: "AI analysis failed: " + (e.message || String(e)) });
    } finally { setProcessingId(null); loadInterviews(contractId); }
  }

  function toggle(id, kind) { setPanel((p) => (p && p.id === id && p.kind === kind) ? null : { id, kind }); }

  const demoFields = [["ageRange", "Age range", AGE_OPTIONS], ["gender", "Gender", GENDER_OPTIONS], ["ethnicity", "Ethnicity", ETHNICITY_OPTIONS], ["profession", "Profession", PROFESSION_OPTIONS]];

  return (
    <div style={{ minHeight: "100vh", background: "#0E0E0C", fontFamily: F, paddingBottom: "60px" }}>
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1A1A18" }}>
        <a href="/admin" style={{ fontSize: "13px", color: "#D4A017", textDecoration: "none" }}>← Back to admin</a>
        <div style={{ fontSize: "22px", fontWeight: "700", color: "#E8E8E4", marginTop: "6px" }}>Upload an interview</div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: "640px" }}>
        <div style={{ marginBottom: "20px" }}>
          <label style={label}>Contract</label>
          <select style={{ ...input, cursor: "pointer" }} value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">— Choose a contract —</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.client}: {c.topic}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label style={label}>Interviewer name</label>
          <input style={input} value={interviewerName} onChange={(e) => setInterviewerName(e.target.value)} placeholder="e.g. Alex R." />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
          {demoFields.map(([key, lbl, opts]) => (
            <div key={key}>
              <label style={label}>{lbl}</label>
              <select style={{ ...input, cursor: "pointer" }} value={demo[key]} onChange={(e) => setDemo({ ...demo, [key]: e.target.value })}>
                {opts.map((o) => <option key={o} value={o}>{o === "" ? "— not set —" : o}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label style={label}>Location (end-of-ride GPS)</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input style={input} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" />
            <input style={input} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude" />
            <button onClick={useMyLocation} style={{ padding: "0 16px", borderRadius: "10px", border: "1px solid #3A3A38", background: "#1E1E1C", color: "#A8A8A4", fontSize: "13px", cursor: "pointer", fontFamily: F, whiteSpace: "nowrap" }}>Use current</button>
          </div>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <label style={label}>Interview video</label>
          <input id="video-file-input" type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ ...input, padding: "10px 14px", cursor: "pointer" }} />
          <div style={{ fontSize: "11px", color: "#888880", marginTop: "6px" }}>While on the Supabase free plan, keep the test file under 50 MB.</div>
        </div>

        {message && (<div style={{ padding: "12px 14px", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", background: message.type === "error" ? "#3A2020" : "#1A2A20", color: message.type === "error" ? "#E06050" : "#6EC4A7" }}>{message.text}</div>)}

        <button onClick={handleUpload} disabled={busy} style={{ width: "100%", padding: "16px", borderRadius: "12px", border: "none", background: busy ? "#3A3A38" : "#D4A017", color: busy ? "#888880" : "#0E0E0C", fontSize: "16px", fontWeight: "700", cursor: busy ? "not-allowed" : "pointer", fontFamily: F }}>
          {busy ? "Uploading…" : "Upload interview"}
        </button>

        {contractId && (
          <div style={{ marginTop: "32px" }}>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "12px" }}>Interviews in this contract</div>
            {interviews.length === 0 ? (<div style={{ fontSize: "13px", color: "#888880" }}>No interviews uploaded yet.</div>) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {interviews.map((iv) => {
                  const sd = iv.structured_data || null;
                  const isProcessing = processingId === iv.id;
                  return (
                    <div key={iv.id} style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "10px", padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                        <div style={{ fontSize: "14px", color: "#E8E8E4", fontWeight: "500" }}>Interview #{iv.interview_number}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "12px", fontWeight: "600", color: STATUS_COLORS[iv.status] || "#A8A8A4", textTransform: "capitalize" }}>{isProcessing ? "analysing…" : (iv.status || "uploaded")}</span>
                          {(iv.status === "uploaded" || iv.status === "failed") && (<button onClick={() => transcribe(iv.id)} style={smallBtn("#D4A017", "#0E0E0C")}>{iv.status === "failed" ? "Retry" : "Transcribe"}</button>)}
                          {iv.status === "transcribed" && (<button onClick={() => summarize(iv.id)} disabled={isProcessing} style={smallBtn("#6EC4A7", "#0E0E0C")}>{isProcessing ? "Running…" : "Run AI"}</button>)}
                          {(iv.status === "transcribed" || iv.status === "summarized") && iv.transcript && (<button onClick={() => toggle(iv.id, "transcript")} style={smallBtn("#1E1E1C", "#A8A8A4", "1px solid #3A3A38")}>{panel && panel.id === iv.id && panel.kind === "transcript" ? "Hide" : "Transcript"}</button>)}
                          {iv.status === "summarized" && sd && (<button onClick={() => toggle(iv.id, "analysis")} style={smallBtn("#1E1E1C", "#6EC4A7", "1px solid #2A3A2E")}>{panel && panel.id === iv.id && panel.kind === "analysis" ? "Hide" : "Analysis"}</button>)}
                        </div>
                      </div>

                      {panel && panel.id === iv.id && panel.kind === "transcript" && iv.transcript && (
                        <div style={{ marginTop: "10px", padding: "12px", background: "#0E0E0C", border: "1px solid #2A2A28", borderRadius: "8px", fontSize: "13px", color: "#C8C8C4", lineHeight: "1.6", maxHeight: "260px", overflowY: "auto", whiteSpace: "pre-wrap" }}>{iv.transcript}</div>
                      )}

                      {panel && panel.id === iv.id && panel.kind === "analysis" && sd && (
                        <div style={{ marginTop: "10px", padding: "14px", background: "#0E0E0C", border: "1px solid #2A2A28", borderRadius: "8px", fontSize: "13px", color: "#C8C8C4", lineHeight: "1.6" }}>
                          <div style={{ marginBottom: "10px" }}><span style={{ color: "#888880" }}>Summary:</span> {sd.summary}</div>
                          <div style={{ marginBottom: "10px" }}><span style={{ color: "#888880" }}>Quality:</span> {sd.quality?.score}/10{sd.quality?.flagged_for_exclusion ? " — flagged: " + (sd.quality.flag_reason || "low quality") : ""}</div>
                          <div style={{ marginBottom: "10px" }}><span style={{ color: "#888880" }}>Sentiment:</span> {sd.sentiment?.overall}</div>
                          {Array.isArray(sd.themes) && sd.themes.length > 0 && (<div style={{ marginBottom: "10px" }}><span style={{ color: "#888880" }}>Themes:</span> {sd.themes.join(", ")}</div>)}
                          {sd.extracted_fields && Object.keys(sd.extracted_fields).length > 0 && (
                            <div style={{ marginTop: "12px", borderTop: "1px solid #2A2A28", paddingTop: "10px" }}>
                              <div style={{ color: "#888880", textTransform: "uppercase", fontSize: "11px", letterSpacing: "0.05em", marginBottom: "6px" }}>Extracted fields</div>
                              {Object.entries(sd.extracted_fields).map(([k, f]) => (
                                <div key={k} style={{ marginBottom: "4px" }}>
                                  <span style={{ color: "#6EC4A7" }}>{k}:</span> {f && f.mentioned ? fmtValue(f.value) : "not mentioned"}{f && f.mentioned && f.confidence ? ` (${f.confidence})` : ""}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
