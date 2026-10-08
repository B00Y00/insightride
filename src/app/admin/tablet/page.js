"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

// ============================================================
// InsightRide — Admin: Interviews (voiding) & slide tagging
// File location in repo: src/app/admin/tablet/page.js
// Open at: /admin/tablet  (admin sign-in required)
//
// Every contract's interviews (tablet or uploaded):
//  - Void / Restore (POST /api/admin/void-interview): voided interviews are hidden
//    from clients, excluded from statistics/reports/HelpBot, and free a quota slot.
//  - Tablet interviews: Tag slides (POST /api/interview/tag-slides), segment and
//    field viewers, "re-tag needed" when Run AI was re-run after tagging.
//  - Resumed interviews: download links for every video part.
// Order per interview: Transcribe -> Run AI (both on /admin/upload). Run AI tags the slides
// automatically; "Tag slides" here is only needed to redo it.
// ============================================================

const F = "'DM Sans', sans-serif";
const C = { bg: "#0E0E0C", card: "#1A1A18", card2: "#222220", border: "#2A2A28", gold: "#D4A017", text: "#E8E8E4", muted: "#888880", soft: "#A8A8A4", green: "#6EC4A7", red: "#E06050", amber: "#D4A76A", blue: "#7BAED4" };
const btn = (extra) => ({ padding: "9px 13px", borderRadius: 10, border: "none", fontSize: 12.5, fontWeight: 600, fontFamily: F, cursor: "pointer", whiteSpace: "nowrap", ...extra });
const chip = (bg, color) => ({ padding: "3px 8px", borderRadius: 6, background: bg, color, fontSize: 11, fontWeight: 600 });
const IV_FIELDS =
  "id, interview_number, status, created_at, interviewer_name, language, deck_version, slide_timeline, slide_tagged_at, slide_fields, slide_segments, recording_meta, video_url, voided, void_reason, voided_at, structured_data->slide_tagging";

function fmtDate(s) {
  if (!s) return "";
  try {
    return new Date(s).toLocaleString();
  } catch (e) {
    return String(s);
  }
}
function fmtMs(ms) {
  if (ms == null) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
}
function statusColor(st) {
  if (st === "summarized") return C.green;
  if (st === "transcribed") return C.blue;
  if (st === "transcribing") return C.amber;
  if (st === "failed") return C.red;
  return C.muted;
}
function valueText(v) {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
function isTablet(iv) {
  return Array.isArray(iv.slide_timeline) && iv.slide_timeline.length > 0;
}
function needsRetag(iv) {
  return isTablet(iv) && iv.status === "summarized" && !!iv.slide_tagged_at && !iv.slide_tagging;
}
function canTag(iv) {
  return isTablet(iv) && !iv.voided && (iv.status === "transcribed" || iv.status === "summarized");
}

export default function AdminInterviewsPage() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState({});
  const [results, setResults] = useState({});
  const [open, setOpen] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showVoided, setShowVoided] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data && data.session;
      if (!session) {
        window.location.href = "/login";
        return;
      }
      const { data: p } = await supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle();
      if (!p || p.role !== "admin") {
        window.location.href = "/login";
        return;
      }
      if (cancelled) return;
      setToken(session.access_token);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts").select("id, client, topic, deck_version, deck, extraction_schema, interviews_total, interviews_remaining").order("created_at", { ascending: false });
    setContracts(data || []);
    if (data && data.length && !selected) setSelected(data[0].id);
  }
  useEffect(() => {
    if (ready) loadContracts();
  }, [ready]);

  async function loadInterviews(cid) {
    if (!cid) return;
    setLoading(true);
    const { data, error: e } = await supabase.from("completed_interviews").select(IV_FIELDS).eq("contract_id", cid).order("interview_number", { ascending: true });
    if (e) setError("Could not load interviews: " + e.message);
    setInterviews(data || []);
    setLoading(false);
  }
  useEffect(() => {
    if (ready && selected) {
      setError("");
      setNotice("");
      loadInterviews(selected);
    }
  }, [ready, selected]);

  async function tag(iv) {
    setBusy((b) => ({ ...b, [iv.id]: "tag" }));
    setError("");
    try {
      const r = await fetch("/api/interview/tag-slides", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ interview_id: iv.id }) });
      const j = await r.json().catch(() => ({}));
      setResults((x) => ({ ...x, [iv.id]: j }));
      if (!r.ok || !j.ok) setError((j && j.error) || "Tagging failed (" + r.status + ")");
      else setOpen(iv.id);
    } catch (e) {
      setError(String(e.message || e));
    }
    setBusy((b) => ({ ...b, [iv.id]: null }));
  }
  async function tagAllThatNeedIt() {
    const todo = interviews.filter((iv) => canTag(iv) && (!iv.slide_tagged_at || needsRetag(iv)));
    if (!todo.length) {
      setNotice("Nothing to tag: every processed tablet interview is already tagged.");
      return;
    }
    for (const iv of todo) await tag(iv);
    loadInterviews(selected);
  }
  async function setVoided(iv, voided) {
    let reason = "";
    if (voided) {
      const r = window.prompt("Void interview #" + iv.interview_number + "?\n\nIt will be hidden from the client, excluded from statistics, reports and the HelpBot, and its slot goes back to the contract quota.\n\nReason (optional, for your records):", "");
      if (r === null) return;
      reason = r;
    } else if (!window.confirm("Restore interview #" + iv.interview_number + "? It becomes visible to the client again and counts towards the quota.")) {
      return;
    }
    setBusy((b) => ({ ...b, [iv.id]: "void" }));
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin/void-interview", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ interview_id: iv.id, voided, reason }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) setError((j && j.error) || "Could not update (" + r.status + ")");
      else
        setNotice(
          "Interview #" + j.interview_number + (voided ? " voided." : " restored.") + (j.interviews_remaining != null ? " Contract now has " + j.interviews_remaining + " of " + j.interviews_total + " interviews remaining (" + j.counted + " counted)." : "") + " If a report was already approved for this contract, regenerate it so it reflects the change."
        );
    } catch (e) {
      setError(String(e.message || e));
    }
    setBusy((b) => ({ ...b, [iv.id]: null }));
    loadInterviews(selected);
    loadContracts();
  }
  async function downloadPart(path, label) {
    const { data, error: e } = await supabase.storage.from("interview-videos").createSignedUrl(path, 3600, { download: label });
    if (e || !data || !data.signedUrl) {
      setError("Could not prepare that file: " + ((e && e.message) || "unknown error"));
      return;
    }
    window.location.href = data.signedUrl;
  }

  const contract = contracts.find((c) => c.id === selected) || null;
  const hasDeck = !!(contract && contract.deck && Array.isArray(contract.deck.slides) && contract.deck.slides.length);
  const deckQuestions = hasDeck ? contract.deck.slides.filter((s) => s.interactions && s.interactions[0]).map((s) => ({ slide: s, q: s.interactions[0] })) : [];
  const registered = new Set(((contract && contract.extraction_schema) || []).filter((f) => f && f.source === "deck").map((f) => f.key));
  const voidedCount = interviews.filter((iv) => iv.voided).length;
  const visible = showVoided ? interviews : interviews.filter((iv) => !iv.voided);

  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.muted, fontFamily: F, padding: 24 }}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
        Checking sign-in...
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: F, paddingBottom: 60 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid " + C.border, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <a href="/admin" style={{ fontSize: 11, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, textDecoration: "none" }}>
            InsightRide · Admin
          </a>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>Interviews: voiding & slide tagging</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Tablet interviews: Transcribe, then Run AI on the Upload page — Run AI now tags the slides automatically. Use Tag slides here only to redo it.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/admin/decks" style={{ ...btn({ background: C.card2, color: C.soft }), textDecoration: "none" }}>
            Slide decks
          </a>
          <a href="/admin/upload" style={{ ...btn({ background: C.card2, color: C.soft }), textDecoration: "none" }}>
            Upload & process
          </a>
        </div>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {contracts.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>No contracts yet.</div>}
          {contracts.map((c) => (
            <button key={c.id} onClick={() => setSelected(c.id)} style={{ padding: "10px 14px", borderRadius: 10, border: selected === c.id ? "2px solid " + C.gold : "1px solid " + C.border, background: selected === c.id ? "#2A2520" : C.card, color: selected === c.id ? C.gold : C.soft, fontFamily: F, fontSize: 13, cursor: "pointer", textAlign: "left" }}>
              <div style={{ fontWeight: 600 }}>
                {c.client} {c.deck_version > 0 && <span style={{ fontSize: 10, color: C.green, marginLeft: 4 }}>DECK</span>}
              </div>
              <div style={{ fontSize: 11, opacity: 0.8, maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.topic}</div>
            </button>
          ))}
        </div>

        {contract && (
          <>
            <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 14, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: C.soft }}>
              <span>
                Quota: <strong style={{ color: C.text }}>{contract.interviews_remaining}</strong> of {contract.interviews_total} remaining
              </span>
              <span>
                Interviews: <strong style={{ color: C.text }}>{interviews.length}</strong>
                {voidedCount > 0 ? " (" + voidedCount + " voided)" : ""}
              </span>
              {voidedCount > 0 && (
                <button onClick={() => setShowVoided(!showVoided)} style={btn({ background: C.card2, color: C.soft, padding: "4px 10px", fontSize: 11 })}>
                  {showVoided ? "Hide voided" : "Show voided"}
                </button>
              )}
            </div>

            {hasDeck && (
              <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 14, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>Deck questions (v{contract.deck_version})</div>
                {deckQuestions.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>This deck has no questions.</div>}
                {deckQuestions.map(({ slide, q }) => (
                  <div key={q.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: "1px solid " + C.border, fontSize: 13 }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ color: C.muted, marginRight: 8 }}>{slide.title || slide.id}</span>
                      <span>{(q.prompt && (q.prompt[contract.deck.default_language || "en"] || Object.values(q.prompt)[0])) || q.id}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <span style={chip(C.card2, C.soft)}>{q.type}</span>
                      <span style={chip(registered.has(q.id) ? "#1A2A20" : C.card2, registered.has(q.id) ? C.green : C.muted)}>{registered.has(q.id) ? "in statistics" : "not registered yet"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>{loading ? "Loading..." : visible.length + " shown"}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => loadInterviews(selected)} style={btn({ background: C.card2, color: C.soft })}>
                  Refresh
                </button>
                {hasDeck && (
                  <button onClick={tagAllThatNeedIt} style={btn({ background: C.gold, color: "#0E0E0C" })}>
                    Tag all that need it
                  </button>
                )}
              </div>
            </div>
            {error && <div style={{ background: "#3A2020", border: "1px solid " + C.red, borderRadius: 10, padding: "10px 14px", color: "#F0B0A8", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            {notice && <div style={{ background: "#1A2A20", border: "1px solid #2A4A36", borderRadius: 10, padding: "10px 14px", color: C.green, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>{notice}</div>}

            {visible.map((iv) => {
              const tablet = isTablet(iv);
              const res = results[iv.id];
              const fields = iv.slide_fields && typeof iv.slide_fields === "object" ? iv.slide_fields : null;
              const segments = Array.isArray(iv.slide_segments) ? iv.slide_segments : null;
              const rm = iv.recording_meta || {};
              const parts = Array.isArray(rm.parts) ? rm.parts : [];
              const retag = needsRetag(iv);
              return (
                <div key={iv.id} style={{ background: C.card, border: "1px solid " + (iv.voided ? "#4A2A2A" : C.border), borderRadius: 14, padding: 16, marginBottom: 10, opacity: iv.voided ? 0.75 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>Interview #{iv.interview_number}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                        {fmtDate(iv.created_at)} · {iv.interviewer_name || "unknown interviewer"}
                        {rm.duration_ms ? " · " + fmtMs(rm.duration_ms) + " recorded" : ""}
                        {tablet ? " · tablet, " + iv.slide_timeline.length + " slide changes" : " · uploaded"}
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        <span style={chip(C.card2, statusColor(iv.status))}>{iv.status}</span>
                        {iv.voided && <span style={chip("#3A2020", C.red)}>VOIDED{iv.voided_at ? " " + new Date(iv.voided_at).toLocaleDateString() : ""}</span>}
                        {tablet && !iv.voided && (retag ? <span style={chip("#3A2E14", C.amber)}>re-tag needed (Run AI was re-run)</span> : <span style={chip(iv.slide_tagged_at ? "#1A2A20" : C.card2, iv.slide_tagged_at ? C.green : C.muted)}>{iv.slide_tagged_at ? "tagged" : "not tagged"}</span>)}
                        {parts.length > 1 && <span style={chip("#1A1F2A", C.blue)}>{parts.length} video files (resumed)</span>}
                        {rm.partial && <span style={chip("#3A2E14", C.amber)}>ended early / recovered</span>}
                      </div>
                      {iv.voided && iv.void_reason && <div style={{ fontSize: 12, color: C.soft, marginTop: 6 }}>Reason: {iv.void_reason}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(fields || segments) && (
                        <button onClick={() => setOpen(open === iv.id ? null : iv.id)} style={btn({ background: C.card2, color: C.soft })}>
                          {open === iv.id ? "Hide" : "View"}
                        </button>
                      )}
                      {tablet && (
                        <button onClick={() => tag(iv)} disabled={!canTag(iv) || !!busy[iv.id]} style={btn({ background: canTag(iv) && !busy[iv.id] ? C.gold : "#3A3A38", color: canTag(iv) && !busy[iv.id] ? "#0E0E0C" : "#666" })}>
                          {busy[iv.id] === "tag" ? "Tagging..." : iv.slide_tagged_at ? "Re-tag slides" : "Tag slides"}
                        </button>
                      )}
                      <button onClick={() => setVoided(iv, !iv.voided)} disabled={!!busy[iv.id]} style={btn({ background: iv.voided ? "#1A2A20" : "#3A2020", color: iv.voided ? C.green : C.red })}>
                        {busy[iv.id] === "void" ? "Saving..." : iv.voided ? "Restore" : "Void"}
                      </button>
                    </div>
                  </div>
                  {tablet && !iv.voided && !canTag(iv) && <div style={{ fontSize: 12, color: C.amber, marginTop: 10 }}>Transcribe this interview on the Upload page first.</div>}

                  {parts.length > 1 && (
                    <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: C.muted }}>Video files:</span>
                      {parts.map((p, k) => (
                        <button key={k} onClick={() => downloadPart(p.path, "interview-" + iv.interview_number + "-part" + (p.part || k + 1) + "." + String(p.path || "").split(".").pop())} style={btn({ background: C.card2, color: C.text, padding: "6px 10px", fontSize: 11.5 })}>
                          Part {p.part || k + 1}
                          {p.offset_ms ? " (from " + fmtMs(p.offset_ms) + ")" : ""}
                        </button>
                      ))}
                      <span style={{ fontSize: 11, color: C.muted }}>All parts are transcribed together onto one timeline.</span>
                    </div>
                  )}

                  {res && (
                    <div style={{ marginTop: 12, fontSize: 12, color: res.ok ? C.soft : C.red, lineHeight: 1.6 }}>
                      {res.ok ? (
                        <>
                          Tagged {res.utterances} utterances into {res.segments} segments; {res.fields} question fields ({res.voice_answers} voice). Interviewee = speaker {res.interviewee_speaker} ({res.method}). {res.merged_into_stats ? "Merged into statistics." : "Not merged into statistics yet."} AI cost ≈ ${res.cost_estimate}.
                          {res.warnings && res.warnings.length > 0 && <div style={{ color: C.amber, marginTop: 4 }}>{res.warnings.join(" ")}</div>}
                        </>
                      ) : (
                        res.error
                      )}
                    </div>
                  )}

                  {open === iv.id && (fields || segments) && (
                    <div style={{ marginTop: 14, borderTop: "1px solid " + C.border, paddingTop: 14 }}>
                      {fields && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>Question fields</div>
                          {Object.entries(fields).map(([key, f]) => (
                            <div key={key} style={{ padding: "8px 0", borderTop: "1px solid " + C.border, fontSize: 13 }}>
                              <div style={{ color: C.muted, fontSize: 12 }}>
                                {f.label || key} <span style={{ color: C.soft }}>· {f.question_type} · {f.source}</span>
                              </div>
                              <div style={{ color: f.mentioned ? C.text : C.muted, marginTop: 3 }}>{f.mentioned ? valueText(f.value) : "not answered / not mentioned"}</div>
                              {f.evidence_quote && f.question_type === "voice" && (
                                <div style={{ color: C.green, fontSize: 12, marginTop: 3, fontStyle: "italic" }}>
                                  “{f.evidence_quote}” {f.approx_timestamp_seconds != null ? "@ " + fmtMs(f.approx_timestamp_seconds * 1000) : ""} {f.sentiment ? "· " + f.sentiment : ""}
                                </div>
                              )}
                              {f.incidental_speech && (
                                <div style={{ color: C.amber, fontSize: 12, marginTop: 3 }}>
                                  Said while on this slide: {f.incidental_speech.slice(0, 240)}
                                  {f.incidental_speech.length > 240 ? "…" : ""}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {segments && (
                        <div>
                          <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>Transcript by slide</div>
                          {segments.map((s, i) => (
                            <div key={i} style={{ padding: "8px 0", borderTop: "1px solid " + C.border, fontSize: 13 }}>
                              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 600 }}>{s.title || s.slide_id || "—"}</span>
                                <span style={chip(C.card2, s.kind === "formal" ? C.green : s.kind === "incidental" ? C.amber : C.soft)}>{s.kind}</span>
                                {s.start_ms != null && (
                                  <span style={{ color: C.muted, fontSize: 12 }}>
                                    {fmtMs(s.start_ms)} – {fmtMs(s.end_ms)}
                                  </span>
                                )}
                                {s.shown === false && <span style={{ color: C.muted, fontSize: 12 }}>(never shown)</span>}
                              </div>
                              {(s.utterances || []).length === 0 ? (
                                <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>No speech on this slide.</div>
                              ) : (
                                (s.utterances || []).map((u, j) => (
                                  <div key={j} style={{ marginTop: 4, color: u.role === "interviewee" ? C.text : C.soft }}>
                                    <span style={{ color: u.role === "interviewee" ? C.green : C.blue, fontSize: 11, fontWeight: 600, marginRight: 6 }}>{u.role === "interviewee" ? "INTERVIEWEE" : "INTERVIEWER"}</span>
                                    <span style={{ color: C.muted, fontSize: 11, marginRight: 6 }}>{fmtMs(u.start_ms)}</span>
                                    {u.text}
                                  </div>
                                ))
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
