"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import {
  tokens,
  Fonts,
  t,
  useLandscape,
  parseDemoFields,
  getConsentConfig,
  ProgressBar,
  SlideView,
  ThankYou,
  WelcomeScreen,
  ConsentScreen,
  DemographicsScreen,
  StatusScreen,
  Centered,
  EMPTY_CHECKS,
  BlankOverlay,
  genPairingCode,
  getDeviceId,
  publicAnswers,
  slideIndexById,
  slideOf,
} from "../../lib/deck";
import { Recorder, store, discardRun, processPending, pendingCount, recoverStale, requestPersistentStorage, listInterrupted, finalizeRun } from "../../lib/recorder";
import { registerMediaWorker, syncDecks, getCachedDeck, connectionType, estimateStorage, regionLabel } from "../../lib/decksync";

// ============================================================
// InsightRide — Interviewee Tablet KIOSK
// File location in repo: src/app/interview/page.js
// Open on the tablet: /interview
//
// Session flow (row in interview_sessions, phone drives navigation):
//   pairing -> paired -> consent -> demographics -> live -> ended -> (paired again)
// Recording: starts when consent is completed, chunks to IndexedDB, uploads after End.
// Deck sync: definitions + media for the interviewer's region are preloaded and
// served locally through /sw.js. The phone reads session.deck_cache to gate Start.
// Resume: the full interview state is snapshotted on the device (localStorage
// "ir_snapshot"). After a crash/reload the tablet shows "One moment please"; the
// phone (or the hidden gesture) chooses Resume, Start over, Cancel or End.
// Resume records a new video PART; the slide timeline keeps one continuous clock.
// Hidden fallback: tap the very top of the screen 5 times within 3 s.
// ============================================================

const { serif, sans, accent, accentLight, warmBg, cardBg, textPrimary, textSecondary, border } = tokens;
const SESSION_KEY = "ir_session_id";
const REGION_KEY = "ir_region";
const SNAP_KEY = "ir_snapshot";
const POLL_MS = 8000;
const UPLOAD_RETRY_MS = 30000;
const SYNC_EVERY_MS = 15 * 60 * 1000;
const ACTIVE = ["consent", "demographics", "live"];
const RESET_FIELDS = {
  current_slide_id: null,
  screen_blank: false,
  media_command: null,
  live_answers: {},
  interviewee_activity: {},
  slide_timeline: [],
  slide_meta: {},
  recording_started_at: null,
  ended_at: null,
  completed_interview_id: null,
  recording_state: {},
  interviewer_demographics: {},
  end_location: null,
  resume_request: null,
};

const S = {
  cam_denied: "Camera and microphone access was blocked. Allow access for this site in the browser settings, then try again.",
  cam_missing: "No camera was found on this tablet.",
  cam_busy: "The camera is being used by another app. Close it and try again.",
  cam_generic: "The camera could not be started. Try again.",
  rec_saving: "Saving your recording...",
  rec_uploading: "Uploading your recording...",
  rec_done: "Recording saved.",
  rec_waiting: "Recording saved on this tablet. It will upload when connected.",
  pending: (n) => (n === 1 ? "1 recording waiting to upload" : n + " recordings waiting to upload"),
  upload_now: "Upload now",
  uploading: "Uploading...",
  paused_title: "One moment please",
  paused_body: "The interview was briefly interrupted. Your answers are safe. Your interviewer will continue in a moment.",
};

function isNewer(next, prev) {
  if (!prev) return true;
  if (!next) return false;
  return String(next.updated_at || "") >= String(prev.updated_at || "");
}
function cameraMessage(e) {
  const name = e && e.name;
  if (name === "NotAllowedError" || name === "SecurityError") return S.cam_denied;
  if (name === "NotFoundError" || name === "OverconstrainedError") return S.cam_missing;
  if (name === "NotReadableError" || name === "AbortError") return S.cam_busy;
  return S.cam_generic + (e && e.message ? " (" + e.message + ")" : "");
}
function newRunId() {
  try {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {}
  return "run-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}
function loadRegion() {
  try {
    const r = JSON.parse(localStorage.getItem(REGION_KEY) || "null");
    return r && (r.city || r.country) ? r : null;
  } catch (e) {
    return null;
  }
}
function saveRegion(r) {
  try {
    localStorage.setItem(REGION_KEY, JSON.stringify(r));
  } catch (e) {}
}
function loadSnapshot() {
  try {
    const s = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
    return s && s.primary_run_id ? s : null;
  } catch (e) {
    return null;
  }
}
function saveSnapshot(s) {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(s));
  } catch (e) {}
}
function clearSnapshot() {
  try {
    localStorage.removeItem(SNAP_KEY);
  } catch (e) {}
}
function snapRunIds(snap) {
  const ids = new Set();
  if (snap && snap.primary_run_id) ids.add(snap.primary_run_id);
  ((snap && snap.parts) || []).forEach((p) => p && p.run_id && ids.add(p.run_id));
  return ids;
}
function payloadFromSnapshot(snap) {
  return {
    demographics: snap.demographics || {},
    survey_responses: snap.answers || {},
    slide_meta: snap.slide_meta || {},
    slide_timeline: snap.timeline || [],
    language: snap.language || "en",
    deck_version: snap.deck_version || null,
    interviewer_name: snap.interviewer_name || null,
    interviewer_demographics: snap.interviewer_demographics || {},
    end_location: snap.end_location || null,
  };
}
function fmtMB(b) {
  return b ? (b / 1e6).toFixed(b > 1e8 ? 0 : 1) + " MB" : "0 MB";
}
function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  return Math.round(s / 3600) + " h ago";
}

// ── Tablet-only screens ──

function ConnectionDot({ online, u }) {
  return (
    <div style={{ position: "fixed", top: 10, right: 14, display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: textSecondary, fontFamily: sans, zIndex: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: online ? accent : "#D0433B" }} />
      {online ? u.connection_ok : u.connection_lost}
    </div>
  );
}
function RecDot() {
  return (
    <div style={{ position: "fixed", top: 10, left: 14, display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#B03A30", fontFamily: sans, fontWeight: 600, zIndex: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#D0433B", animation: "irPulse 1.4s ease-in-out infinite" }} />
      Recording
    </div>
  );
}
function UploadStatus({ pending, busy, onUploadNow }) {
  if (!pending && !busy) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, background: cardBg, border: "1.5px solid " + border, fontSize: 13, color: textSecondary, fontFamily: sans }}>
        {busy ? S.uploading : S.pending(pending)}
        {!busy && (
          <button onClick={onUploadNow} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: accent, color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: sans, cursor: "pointer" }}>
            {S.upload_now}
          </button>
        )}
      </div>
    </div>
  );
}
function SaveLine({ phase }) {
  if (!phase || phase === "idle" || phase === "recording") return null;
  const text = phase === "saving" ? S.rec_saving : phase === "done" ? S.rec_done : phase === "error" ? S.rec_waiting : S.rec_uploading;
  return <div style={{ position: "fixed", bottom: 12, left: 16, fontSize: 12, color: textSecondary, fontFamily: sans }}>{text}</div>;
}

function DeckPanel({ sync, onSync }) {
  const entries = Object.entries(sync.status || {});
  const conn = sync.connection || "unknown";
  const connLabel = conn === "wifi" ? "Wi-Fi" : conn === "cellular" ? "mobile data" : conn === "ethernet" ? "wired" : "network";
  const st = (e) => {
    if (e.error) return { label: "Missing: " + e.error, color: "#B03A30" };
    if (e.ready) return { label: "Ready", color: accent };
    if (e.deferred) return { label: "Waiting for Wi-Fi (" + e.media_cached + "/" + e.media_total + ")", color: "#8B7030" };
    return { label: "Downloading " + e.media_cached + "/" + e.media_total, color: "#8B7030" };
  };
  return (
    <div style={{ width: "100%", maxWidth: 560, margin: "28px auto 0", background: cardBg, border: "1.5px solid " + border, borderRadius: 14, padding: 16, textAlign: "left", fontFamily: sans }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: textPrimary }}>Decks on this tablet</div>
          <div style={{ fontSize: 12, color: textSecondary, marginTop: 2 }}>
            {sync.region ? regionLabel(sync.region) : "No region yet — pair with an interviewer"} · {connLabel} · synced {sync.running ? "now..." : ago(sync.last)}
          </div>
        </div>
        <button onClick={onSync} disabled={sync.running} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: sync.running ? "#C8C4BC" : accent, color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: sans, cursor: sync.running ? "default" : "pointer", whiteSpace: "nowrap" }}>
          {sync.running ? "Syncing..." : "Sync now"}
        </button>
      </div>
      {sync.error && <div style={{ fontSize: 12, color: "#B03A30", marginBottom: 8 }}>{sync.error}</div>}
      {sync.running && sync.progress && (
        <div style={{ fontSize: 12, color: textSecondary, marginBottom: 8 }}>
          Downloading {sync.progress.client}: {sync.progress.cached}/{sync.progress.total}
        </div>
      )}
      {entries.length === 0 && !sync.running && <div style={{ fontSize: 13, color: textSecondary }}>{sync.region ? "No active contracts for this region." : ""}</div>}
      {entries.map(([id, e]) => {
        const x = st(e);
        return (
          <div key={id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid " + border, fontSize: 13 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: textPrimary, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {e.client} — {e.topic}
              </div>
              <div style={{ color: textSecondary, fontSize: 12 }}>
                v{e.version} · {e.media_total} media file{e.media_total === 1 ? "" : "s"}
              </div>
            </div>
            <div style={{ color: x.color, fontWeight: 600, flexShrink: 0, fontSize: 12 }}>{x.label}</div>
          </div>
        );
      })}
      {sync.storage && sync.storage.quota > 0 && (
        <div style={{ fontSize: 11, color: textSecondary, marginTop: 10 }}>
          Tablet storage: {fmtMB(sync.storage.usage)} used of about {Math.round(sync.storage.quota / 1e9)} GB available
        </div>
      )}
    </div>
  );
}

function PairingScreen({ code, u, onNewCode, children }) {
  return (
    <Centered>
      <div style={{ fontSize: 14, color: textSecondary, marginBottom: 18, fontFamily: sans }}>InsightRide</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        {(code || "------").split("").map((ch, i) => (
          <div key={i} style={{ width: 58, height: 76, borderRadius: 14, background: cardBg, border: "2px solid " + border, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: serif, fontSize: 40, fontWeight: 700, color: accent }}>
            {ch}
          </div>
        ))}
      </div>
      <h1 style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: textPrimary, margin: "0 0 10px" }}>{u.pair_title}</h1>
      <p style={{ fontSize: 15, color: textSecondary, lineHeight: 1.6, maxWidth: 420, margin: "0 0 20px" }}>{u.pair_note}</p>
      <button onClick={onNewCode} style={{ padding: "12px 22px", borderRadius: 10, border: "1.5px solid " + border, background: cardBg, color: textSecondary, fontSize: 14, fontWeight: 500, fontFamily: sans, cursor: "pointer" }}>
        {u.pair_new}
      </button>
      {children}
    </Centered>
  );
}
function WaitingScreen({ name, u, children }) {
  return (
    <Centered>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: accentLight, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
          <path d="M7 15L12.5 20.5L23 9.5" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 700, color: textPrimary, margin: "0 0 10px" }}>{u.paired_title(name || "your interviewer")}</h1>
      <p style={{ fontSize: 16, color: textSecondary, lineHeight: 1.6, maxWidth: 380 }}>{u.paired_note}</p>
      {children}
    </Centered>
  );
}

// Shown after a crash/reload until the interviewer chooses what to do
function InterruptedScreen({ showControls, busy, error, onResume, onRestart }) {
  const b = (extra) => ({ padding: "14px 22px", borderRadius: 10, border: "none", fontSize: 15, fontWeight: 600, fontFamily: sans, cursor: "pointer", ...extra });
  return (
    <Centered>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: accentLight, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect x="7" y="6" width="4.5" height="16" rx="1.5" fill={accent} />
          <rect x="16.5" y="6" width="4.5" height="16" rx="1.5" fill={accent} />
        </svg>
      </div>
      <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 700, color: textPrimary, margin: "0 0 10px" }}>{S.paused_title}</h1>
      <p style={{ fontSize: 16, color: textSecondary, lineHeight: 1.6, maxWidth: 420 }}>{S.paused_body}</p>
      {error && <div style={{ marginTop: 16, fontSize: 14, color: "#B03A30", maxWidth: 420, lineHeight: 1.5 }}>{error}</div>}
      {showControls && (
        <div style={{ marginTop: 28, padding: 16, borderRadius: 14, background: "#1A1A18", display: "flex", flexDirection: "column", gap: 10, minWidth: 280 }}>
          <div style={{ color: "#D4A017", fontSize: 12, fontWeight: 600, fontFamily: sans }}>Interviewer controls</div>
          <button onClick={onResume} disabled={busy} style={b({ background: busy ? "#3A3A38" : accent, color: "#fff" })}>
            {busy ? "Resuming..." : "Resume interview"}
          </button>
          <button onClick={onRestart} disabled={busy} style={b({ background: "#3A3A38", color: "#E8E8E4" })}>
            Start this interviewee over
          </button>
        </div>
      )}
    </Centered>
  );
}

function ManualControls({ onPrev, onNext, onHide, onUnblank, index, total }) {
  const btn = (extra) => ({ padding: "12px 18px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, fontFamily: sans, cursor: "pointer", ...extra });
  return (
    <div style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#1A1A18", borderRadius: 14, zIndex: 60, boxShadow: "0 8px 30px rgba(0,0,0,0.35)" }}>
      <span style={{ color: "#D4A017", fontSize: 12, fontFamily: sans, fontWeight: 600, marginRight: 6 }}>
        Manual {index + 1}/{total}
      </span>
      <button onClick={onPrev} style={btn({ background: "#3A3A38", color: "#E8E8E4" })}>
        Back
      </button>
      <button onClick={onNext} style={btn({ background: accent, color: "#fff" })}>
        Next
      </button>
      {onUnblank && (
        <button onClick={onUnblank} style={btn({ background: "#D4A017", color: "#0E0E0C" })}>
          Unblank
        </button>
      )}
      <button onClick={onHide} style={btn({ background: "#2A2A28", color: "#A8A8A4" })}>
        Hide
      </button>
    </div>
  );
}

// ── Main kiosk ──
export default function TabletKiosk() {
  const landscape = useLandscape();
  const u = t("en");

  const [boot, setBoot] = useState("booting");
  const [bootKey, setBootKey] = useState(0);
  const [session, setSession] = useState(null);
  const [online, setOnline] = useState(true);
  const [contract, setContract] = useState(null);
  const [deck, setDeck] = useState(null);

  const [localStage, setLocalStage] = useState("welcome");
  const [checks, setChecks] = useState(EMPTY_CHECKS);
  const [signature, setSignature] = useState("");
  const [demographics, setDemographics] = useState({});
  const [answers, setAnswers] = useState({});
  const [slideMeta, setSlideMeta] = useState({});
  const [watched, setWatched] = useState({});
  const [manualUntil, setManualUntil] = useState(0);

  const [rec, setRec] = useState({ phase: "idle" });
  const [camError, setCamError] = useState(null);
  const [pending, setPending] = useState(0);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [sync, setSync] = useState({ running: false, last: null, status: {}, error: null, region: null, connection: "unknown", progress: null, storage: null });

  const [recovered, setRecovered] = useState(false);
  const [interrupted, setInterrupted] = useState(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState(null);

  const sessionRef = useRef(null);
  const contractRef = useRef(null);
  const deckRef = useRef(null);
  const answersRef = useRef({});
  const metaRef = useRef({});
  const demoRef = useRef({});
  const watchedRef = useRef({});
  const timelineRef = useRef([]);
  const prevStatusRef = useRef(null);
  const prevSlideRef = useRef(null);
  const tapsRef = useRef([]);
  const syncTimerRef = useRef(null);
  const typingSentRef = useRef(false);
  const recorderRef = useRef(null);
  const runIdRef = useRef(null);
  const recStartRef = useRef(null);
  const partsRef = useRef([]);
  const stageRef = useRef(null);
  const endedRef = useRef(false);
  const wakeRef = useRef(null);
  const uploadingRef = useRef(false);
  const finishingRef = useRef(false);
  const regionRef = useRef(null);
  const syncingRef = useRef(false);
  const interruptedRef = useRef(null);
  const resumingRef = useRef(false);
  const checkedRef = useRef(false);
  const lastResumeRef = useRef(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    contractRef.current = contract;
  }, [contract]);
  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  useEffect(() => {
    metaRef.current = slideMeta;
  }, [slideMeta]);
  useEffect(() => {
    demoRef.current = demographics;
  }, [demographics]);
  useEffect(() => {
    watchedRef.current = watched;
  }, [watched]);

  // ── Snapshot: everything needed to resume, saved on the device ──
  function writeSnapshot(extra) {
    if (!runIdRef.current || interruptedRef.current) return;
    const s = sessionRef.current;
    const c = contractRef.current;
    const d = deckRef.current;
    saveSnapshot({
      v: 1,
      session_id: s ? s.id : null,
      contract_id: c ? c.id : s ? s.contract_id : null,
      deck_version: c ? c.deck_version : null,
      language: (s && s.language) || (d && d.default_language) || "en",
      primary_run_id: runIdRef.current,
      primary_started_at: recStartRef.current,
      parts: partsRef.current,
      stage: stageRef.current,
      ended: !!endedRef.current,
      demographics: demoRef.current,
      answers: answersRef.current,
      slide_meta: metaRef.current,
      watched: watchedRef.current,
      timeline: timelineRef.current,
      interviewer_name: s ? s.interviewer_name : null,
      interviewer_demographics: (s && s.interviewer_demographics) || {},
      end_location: (s && s.end_location) || null,
      saved_at: Date.now(),
      ...(extra || {}),
    });
  }
  useEffect(() => {
    writeSnapshot();
  }, [answers, demographics, slideMeta, watched]);

  // ── Boot: adopt the stored session or create a fresh one with a new code ──
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setBoot("booting");
      const deviceId = getDeviceId();
      let row = null;
      try {
        const stored = localStorage.getItem(SESSION_KEY);
        if (stored) {
          const { data } = await supabase.from("interview_sessions").select("*").eq("id", stored).maybeSingle();
          if (data && data.status !== "abandoned") row = data;
        }
        if (!row) {
          const { data, error } = await supabase
            .from("interview_sessions")
            .insert([{ pairing_code: genPairingCode(), device_id: deviceId, status: "pairing" }])
            .select()
            .single();
          if (error || !data) throw error || new Error("no row");
          row = data;
          localStorage.setItem(SESSION_KEY, row.id);
        }
      } catch (e) {
        if (!cancelled) setBoot("error");
        return;
      }
      if (cancelled) return;
      lastResumeRef.current = row.resume_request ? row.resume_request.nonce : null;
      if (row.status === "live") {
        timelineRef.current = Array.isArray(row.slide_timeline) ? row.slide_timeline : [];
        prevSlideRef.current = row.current_slide_id;
        prevStatusRef.current = "live";
      }
      setSession(row);
      setBoot("ready");
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [bootKey]);

  // ── Upload queue ──
  async function refreshPending() {
    try {
      setPending(await pendingCount());
    } catch (e) {}
  }
  async function runUploads() {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploadBusy(true);
    try {
      await processPending(supabase, onUploadEvent);
    } catch (e) {}
    uploadingRef.current = false;
    setUploadBusy(false);
    refreshPending();
  }
  function onUploadEvent(evt) {
    if (!evt || evt.run_id !== runIdRef.current) return;
    setRec({ phase: evt.phase, error: evt.error || null, bytes: evt.bytes, interview_number: evt.interview_number });
    const patch = { run_id: evt.run_id, phase: evt.phase };
    if (evt.error) patch.error = evt.error;
    if (evt.bytes) patch.bytes = evt.bytes;
    if (evt.interview_number) patch.interview_number = evt.interview_number;
    writeRecState(patch);
    if (evt.phase === "done" && evt.interview_id) {
      const s = sessionRef.current;
      if (s && s.recording_state && s.recording_state.run_id === evt.run_id) patchSession({ completed_interview_id: evt.interview_id });
    }
  }

  // ── Deck sync ──
  async function runSync(opts) {
    const o = opts || {};
    if (syncingRef.current) return;
    const s = sessionRef.current;
    const st = s ? s.status : null;
    if (!o.manual && ACTIVE.includes(st)) return;
    const region = regionRef.current;
    if (!region) {
      setSync((x) => ({ ...x, error: "Pair with an interviewer so the tablet knows which region to load decks for.", region: null }));
      return;
    }
    syncingRef.current = true;
    const conn = connectionType();
    const allowMedia = !!o.manual || conn !== "cellular";
    setSync((x) => ({ ...x, running: true, error: null, connection: conn, progress: null, region }));
    try {
      const result = await syncDecks({ supabase, region, allowMedia, onProgress: (p) => setSync((x) => ({ ...x, progress: p })) });
      const storage = await estimateStorage();
      setSync({ running: false, last: result.synced_at, status: result.status, error: null, region, connection: conn, progress: null, storage });
      const s2 = sessionRef.current;
      if (s2) {
        supabase
          .from("interview_sessions")
          .update({ deck_cache: { synced_at: result.synced_at, region, connection: conn, contracts: result.status } })
          .eq("id", s2.id)
          .then(() => {});
      }
    } catch (e) {
      setSync((x) => ({ ...x, running: false, error: String((e && e.message) || e), progress: null }));
    }
    syncingRef.current = false;
  }

  // Boot-time services: persistent storage, media worker, crash recovery, uploads, sync
  useEffect(() => {
    requestPersistentStorage();
    registerMediaWorker();
    regionRef.current = loadRegion();
    setSync((x) => ({ ...x, region: regionRef.current, connection: connectionType() }));
    recoverStale()
      .catch(() => {})
      .then(() => {
        setRecovered(true);
        refreshPending();
        runUploads();
      });
    runSync();
    const onOnline = () => {
      runUploads();
      runSync();
    };
    window.addEventListener("online", onOnline);
    const iv = setInterval(runUploads, UPLOAD_RETRY_MS);
    const sv = setInterval(() => runSync(), SYNC_EVERY_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(iv);
      clearInterval(sv);
    };
  }, []);

  // ── Follow the session row: realtime + polling fallback ──
  const sessionId = session ? session.id : null;
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel("kiosk-" + sessionId)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "interview_sessions", filter: "id=eq." + sessionId }, (payload) => {
        if (payload.new) setSession((prev) => (isNewer(payload.new, prev) ? payload.new : prev));
      })
      .subscribe((status) => setOnline(status === "SUBSCRIBED"));
    const poll = setInterval(async () => {
      const { data, error } = await supabase.from("interview_sessions").select("*").eq("id", sessionId).maybeSingle();
      if (error) {
        setOnline(false);
        return;
      }
      setOnline(true);
      if (data) setSession((prev) => (prev && String(data.updated_at) > String(prev.updated_at || "") ? data : prev));
    }, POLL_MS);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [sessionId]);

  const status = session ? session.status : null;
  useEffect(() => {
    if (status === "abandoned") {
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch (e) {}
      setSession(null);
      setContract(null);
      setDeck(null);
      setBootKey((k) => k + 1);
    }
  }, [status]);

  // ── Region from the paired interviewer -> remember it and sync ──
  const pairedCity = session ? session.interviewer_city : null;
  const pairedCountry = session ? session.interviewer_country : null;
  useEffect(() => {
    if (!pairedCity && !pairedCountry) return;
    const r = { city: pairedCity || "", country: pairedCountry || "" };
    const cur = regionRef.current;
    const changed = !cur || cur.city !== r.city || cur.country !== r.country;
    if (changed) {
      regionRef.current = r;
      saveRegion(r);
      setSync((x) => ({ ...x, region: r }));
    }
    if (changed || status === "paired") runSync();
  }, [pairedCity, pairedCountry, status]);

  // ── Load the contract + deck (cache first, network if not cached) ──
  const contractId = session ? session.contract_id : null;
  useEffect(() => {
    if (!contractId) {
      setContract(null);
      setDeck(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const want = sessionRef.current ? sessionRef.current.deck_version : null;
      const cached = await getCachedDeck(contractId);
      if (cached && cached.deck && Array.isArray(cached.deck.slides) && cached.deck.slides.length > 0 && (!want || cached.version >= want)) {
        if (!cancelled) {
          setContract({ ...(cached.contract || {}), id: contractId, deck: cached.deck, deck_version: cached.version });
          setDeck(cached.deck);
        }
        return;
      }
      const { data } = await supabase.from("contracts").select("*").eq("id", contractId).maybeSingle();
      if (cancelled) return;
      if (data && data.deck && Array.isArray(data.deck.slides) && data.deck.slides.length > 0) {
        setContract(data);
        setDeck(data.deck);
      } else {
        setContract(data || null);
        setDeck(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  // ── Crash recovery: once per boot, after stale recordings are marked "interrupted" ──
  useEffect(() => {
    if (boot !== "ready" || !recovered || !session || checkedRef.current) return;
    checkedRef.current = true;
    checkInterrupted();
  }, [boot, recovered, sessionId]);

  async function checkInterrupted() {
    const s = sessionRef.current;
    const snap = loadSnapshot();
    let stale = [];
    try {
      stale = await listInterrupted();
    } catch (e) {}
    const mine = snapRunIds(snap);
    // Interrupted runs that this snapshot does not describe cannot be resumed: keep the video as a partial interview
    for (const m of stale) {
      if (mine.has(m.run_id)) continue;
      if (m.part_of) await discardRun(m.run_id);
      else await finalizeRun(m.run_id, { partial: true });
    }
    if (!snap) {
      refreshPending();
      runUploads();
      return;
    }
    if (snap.ended) {
      await finalizeFromSnapshot(snap, false);
      clearSnapshot();
      refreshPending();
      runUploads();
      return;
    }
    const rs = (s && s.recording_state) || {};
    const resumable = s && s.id === snap.session_id && ACTIVE.includes(s.status) && rs.run_id === snap.primary_run_id;
    if (!resumable) {
      // The phone cancelled or started over while the tablet was down: nothing is saved
      for (const id of mine) await discardRun(id);
      clearSnapshot();
      return;
    }
    interruptedRef.current = snap;
    runIdRef.current = snap.primary_run_id;
    recStartRef.current = snap.primary_started_at || null;
    partsRef.current = Array.isArray(snap.parts) && snap.parts.length ? snap.parts : [{ run_id: snap.primary_run_id, index: 0, offset_ms: 0 }];
    setInterrupted(snap);
    setRec({ phase: "interrupted" });
    await patchSession({ recording_state: { ...rs, run_id: snap.primary_run_id, phase: "interrupted", stage: snap.stage || null, error: null, at: new Date().toISOString() } });
  }

  async function finalizeFromSnapshot(snap, partial) {
    const meta = (await store.getRecording(snap.primary_run_id)) || { run_id: snap.primary_run_id, mime: "video/webm", ext: "webm", created_at: new Date().toISOString() };
    const started = snap.primary_started_at || null;
    await store.putRecording({
      ...meta,
      session_id: meta.session_id || snap.session_id,
      device_id: meta.device_id || getDeviceId(),
      contract_id: meta.contract_id || snap.contract_id,
      status: "pending",
      partial: !!partial,
      parts: Array.isArray(snap.parts) && snap.parts.length ? snap.parts : [{ run_id: snap.primary_run_id, index: 0, offset_ms: 0 }],
      payload: payloadFromSnapshot(snap),
      recording: {
        duration_ms: started ? Math.max(0, (snap.saved_at || Date.now()) - started) : null,
        started_at: started ? new Date(started).toISOString() : null,
        ended_at: new Date(snap.saved_at || Date.now()).toISOString(),
        recovered_after_crash: true,
      },
    });
  }

  function resetLocal() {
    setChecks(EMPTY_CHECKS);
    setSignature("");
    setDemographics({});
    setAnswers({});
    setSlideMeta({});
    setWatched({});
    timelineRef.current = [];
    prevSlideRef.current = null;
    typingSentRef.current = false;
    recStartRef.current = null;
    runIdRef.current = null;
    partsRef.current = [];
    stageRef.current = null;
    endedRef.current = false;
    setCamError(null);
    setRec({ phase: "idle" });
    setLocalStage("welcome");
  }

  // While interrupted, react to the phone's choice
  const rsRunId = session && session.recording_state ? session.recording_state.run_id : undefined;
  useEffect(() => {
    const snap = interruptedRef.current;
    if (!snap || !session) return;
    if (status === "ended" && rsRunId === snap.primary_run_id) {
      finalizeInterrupted();
      return;
    }
    if (rsRunId !== snap.primary_run_id || !ACTIVE.includes(status)) abandonInterrupted();
  }, [rsRunId, status]);

  const resumeNonce = session && session.resume_request ? session.resume_request.nonce : null;
  useEffect(() => {
    if (!resumeNonce || resumeNonce === lastResumeRef.current) return;
    lastResumeRef.current = resumeNonce;
    if (interruptedRef.current) resumeInterview();
  }, [resumeNonce]);

  async function abandonInterrupted() {
    const snap = interruptedRef.current;
    if (!snap) return;
    interruptedRef.current = null;
    setInterrupted(null);
    for (const id of snapRunIds(snap)) await discardRun(id);
    clearSnapshot();
    resetLocal();
  }

  async function finalizeInterrupted() {
    const snap = interruptedRef.current;
    if (!snap) return;
    interruptedRef.current = null;
    setInterrupted(null);
    const s = sessionRef.current;
    await finalizeFromSnapshot({ ...snap, interviewer_demographics: (s && s.interviewer_demographics) || snap.interviewer_demographics, end_location: (s && s.end_location) || snap.end_location }, true);
    clearSnapshot();
    setRec({ phase: "queued" });
    await writeRecState({ run_id: snap.primary_run_id, phase: "queued" });
    refreshPending();
    runUploads();
  }

  async function resumeInterview() {
    const snap = interruptedRef.current;
    if (!snap || resumingRef.current) return;
    const s = sessionRef.current;
    const c = contractRef.current;
    const d = deckRef.current;
    if (!s || !c || !d) {
      setResumeError("The interview is still loading. Try again in a moment.");
      return;
    }
    resumingRef.current = true;
    setResumeBusy(true);
    setResumeError(null);

    // Restore everything the interviewee had done
    answersRef.current = snap.answers || {};
    demoRef.current = snap.demographics || {};
    metaRef.current = snap.slide_meta || {};
    watchedRef.current = snap.watched || {};
    setAnswers(answersRef.current);
    setDemographics(demoRef.current);
    setSlideMeta(metaRef.current);
    setWatched(watchedRef.current);
    timelineRef.current = Array.isArray(snap.timeline) && snap.timeline.length ? snap.timeline : Array.isArray(s.slide_timeline) ? s.slide_timeline : [];
    stageRef.current = snap.stage || (s.status === "live" ? "live" : "demographics");

    // Start the camera again as a new part of the same interview
    try {
      const partRun = newRunId();
      const index = partsRef.current.length;
      if (!recorderRef.current) recorderRef.current = new Recorder();
      const info = await recorderRef.current.start(partRun, { session_id: s.id, device_id: getDeviceId(), contract_id: c.id, part_of: snap.primary_run_id, part_index: index });
      const base = snap.primary_started_at || info.startedAt;
      partsRef.current = [...partsRef.current, { run_id: partRun, index, offset_ms: Math.max(0, info.startedAt - base) }];
      recStartRef.current = base;
    } catch (e) {
      const msg = cameraMessage(e);
      resumingRef.current = false;
      setResumeBusy(false);
      setResumeError(msg);
      await patchSession({ recording_state: { ...(s.recording_state || {}), run_id: snap.primary_run_id, phase: "interrupted", error: msg } });
      return;
    }

    runIdRef.current = snap.primary_run_id;
    interruptedRef.current = null;
    setInterrupted(null);
    setRec({ phase: "recording" });
    const patch = { recording_state: { run_id: snap.primary_run_id, phase: "recording", parts: partsRef.current.length, resumed_at: new Date().toISOString() } };

    if (s.status === "live") {
      const last = timelineRef.current.length ? timelineRef.current[timelineRef.current.length - 1].slide_id : d.slides[0].id;
      const cur = s.current_slide_id || last;
      timelineRef.current = [...timelineRef.current, { slide_id: cur, at_ms: elapsedMs(), resumed: true }];
      prevSlideRef.current = cur;
      prevStatusRef.current = "live";
      patch.slide_timeline = timelineRef.current;
      writeSnapshot();
      await patchSession(patch);
    } else if (parseDemoFields(c).length > 0) {
      setLocalStage("demographics");
      stageRef.current = "demographics";
      prevStatusRef.current = "demographics";
      if (s.status !== "demographics") patch.status = "demographics";
      writeSnapshot();
      await patchSession(patch);
    } else {
      writeSnapshot();
      await patchSession(patch);
      await goLive();
    }
    resumingRef.current = false;
    setResumeBusy(false);
  }

  async function restartInterviewee() {
    const s = sessionRef.current;
    if (!s) return;
    if (!window.confirm("Start this interviewee over? The interrupted recording is discarded.")) return;
    await patchSession({ ...RESET_FIELDS, status: "consent", contract_id: s.contract_id, language: s.language, deck_version: s.deck_version });
  }

  // ── Status transitions ──
  useEffect(() => {
    if (!status) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    const r = recorderRef.current;
    if (status === "consent" && prev !== "consent" && prev !== "demographics") {
      if (r && r.active) discardActiveRun();
      resetLocal();
    }
    if ((status === "paired" || status === "pairing" || status === "abandoned") && r && r.active) discardActiveRun();
    if (status === "ended" && r && r.active && !finishingRef.current) finishRun();
  }, [status]);

  // ── Wake lock during an interview ──
  useEffect(() => {
    const want = ACTIVE.includes(status);
    async function acquire() {
      try {
        if (want && navigator.wakeLock && !wakeRef.current) {
          wakeRef.current = await navigator.wakeLock.request("screen");
          wakeRef.current.addEventListener("release", () => {
            wakeRef.current = null;
          });
        }
      } catch (e) {}
    }
    function onVis() {
      if (document.visibilityState === "visible") acquire();
    }
    if (want) {
      acquire();
      document.addEventListener("visibilitychange", onVis);
    } else if (wakeRef.current) {
      try {
        wakeRef.current.release();
      } catch (e) {}
      wakeRef.current = null;
    }
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [status]);

  // ── Timeline stamping (paused while interrupted) ──
  const currentSlideId = session ? session.current_slide_id : null;
  useEffect(() => {
    if (status !== "live" || !currentSlideId || !sessionId || interruptedRef.current) return;
    if (prevSlideRef.current === currentSlideId) return;
    prevSlideRef.current = currentSlideId;
    const entry = { slide_id: currentSlideId, at_ms: elapsedMs() };
    timelineRef.current = [...timelineRef.current, entry];
    writeSnapshot();
    supabase
      .from("interview_sessions")
      .update({ slide_timeline: timelineRef.current })
      .eq("id", sessionId)
      .then(() => {});
  }, [status, currentSlideId, sessionId]);

  // ── Live feed (paused while interrupted) ──
  useEffect(() => {
    if (status !== "live" || !sessionId || interruptedRef.current) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      const s = sessionRef.current;
      const d = deckRef.current;
      if (!s || s.status !== "live" || !d || interruptedRef.current) return;
      typingSentRef.current = false;
      supabase
        .from("interview_sessions")
        .update({ live_answers: publicAnswers(d, answersRef.current), slide_meta: metaRef.current, interviewee_activity: { typing: false, slide_id: s.current_slide_id } })
        .eq("id", s.id)
        .then(() => {});
    }, 700);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [answers, slideMeta, status, sessionId, interrupted]);

  useEffect(() => {
    if (!manualUntil) return;
    const timer = setTimeout(() => setManualUntil(0), Math.max(0, manualUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [manualUntil]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [status, localStage, currentSlideId, interrupted]);

  // ── Helpers ──
  function elapsedMs() {
    const s = sessionRef.current;
    const start = recStartRef.current || (s && s.recording_started_at ? new Date(s.recording_started_at).getTime() : Date.now());
    return Math.max(0, Date.now() - start);
  }
  async function patchSession(patch) {
    const s = sessionRef.current;
    if (!s) return;
    setSession((prev) => (prev ? { ...prev, ...patch } : prev));
    await supabase.from("interview_sessions").update(patch).eq("id", s.id);
  }
  async function writeRecState(state) {
    const s = sessionRef.current;
    if (!s) return;
    const current = s.recording_state || {};
    if (current.run_id && state.run_id && current.run_id !== state.run_id) return;
    await patchSession({ recording_state: { ...current, ...state } });
  }

  // ── Actions ──
  async function newCode() {
    const s = sessionRef.current;
    if (s) await supabase.from("interview_sessions").update({ status: "abandoned" }).eq("id", s.id);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
    setSession(null);
    setBootKey((k) => k + 1);
  }
  async function startRecording() {
    const s = sessionRef.current;
    const c = contractRef.current;
    const d = deckRef.current;
    if (!s || !c || !d) throw new Error("not ready");
    const runId = newRunId();
    if (!recorderRef.current) recorderRef.current = new Recorder();
    const lang = s.language || d.default_language || "en";
    const info = await recorderRef.current.start(runId, { session_id: s.id, device_id: getDeviceId(), contract_id: c.id, language: lang, deck_version: c.deck_version, client: c.client, topic: c.topic });
    runIdRef.current = runId;
    recStartRef.current = info.startedAt;
    partsRef.current = [{ run_id: runId, index: 0, offset_ms: 0 }];
    endedRef.current = false;
    setRec({ phase: "recording" });
    await patchSession({ recording_started_at: new Date(info.startedAt).toISOString(), recording_state: { run_id: runId, phase: "recording", mime: info.mime } });
  }
  async function consentDone() {
    setCamError(null);
    const r = recorderRef.current;
    if (!r || !r.active) {
      setRec({ phase: "starting" });
      try {
        await startRecording();
      } catch (e) {
        const msg = cameraMessage(e);
        setCamError(msg);
        setRec({ phase: "error", error: msg });
        await patchSession({ recording_state: { phase: "error", error: msg } });
        return;
      }
    }
    const demoFields = parseDemoFields(contractRef.current);
    if (demoFields.length > 0) {
      stageRef.current = "demographics";
      writeSnapshot();
      setLocalStage("demographics");
      await patchSession({ status: "demographics" });
    } else {
      await goLive();
    }
  }
  async function goLive() {
    const d = deckRef.current;
    if (!d) return;
    const first = d.slides[0];
    const timeline = [{ slide_id: first.id, at_ms: elapsedMs() }];
    timelineRef.current = timeline;
    prevSlideRef.current = first.id;
    stageRef.current = "live";
    writeSnapshot();
    const patch = {
      status: "live",
      current_slide_id: first.id,
      screen_blank: !!(first.settings && first.settings.auto_blank),
      media_command: null,
      slide_timeline: timeline,
      live_answers: {},
      slide_meta: {},
      interviewee_activity: {},
    };
    const s = sessionRef.current;
    if (!s || !s.recording_started_at) patch.recording_started_at = new Date(recStartRef.current || Date.now()).toISOString();
    await patchSession(patch);
  }
  async function finishRun() {
    finishingRef.current = true;
    endedRef.current = true;
    writeSnapshot();
    const s = sessionRef.current;
    const c = contractRef.current;
    const d = deckRef.current;
    const runId = runIdRef.current;
    const r = recorderRef.current;
    setRec({ phase: "saving" });
    await writeRecState({ run_id: runId, phase: "saving" });
    let info = null;
    try {
      info = await r.stop();
    } catch (e) {}
    const payload = {
      demographics: demoRef.current,
      survey_responses: answersRef.current,
      slide_meta: metaRef.current,
      slide_timeline: timelineRef.current,
      language: (s && s.language) || (d && d.default_language) || "en",
      deck_version: c ? c.deck_version : null,
      interviewer_name: s ? s.interviewer_name : null,
      interviewer_demographics: (s && s.interviewer_demographics) || {},
      end_location: (s && s.end_location) || null,
    };
    try {
      const meta = (await store.getRecording(runId)) || { run_id: runId, session_id: s ? s.id : null, device_id: getDeviceId(), contract_id: c ? c.id : null };
      const start = recStartRef.current || (info && info.startedAt) || null;
      const parts = partsRef.current && partsRef.current.length ? partsRef.current : [{ run_id: runId, index: 0, offset_ms: 0 }];
      await store.putRecording({
        ...meta,
        status: "pending",
        payload,
        parts,
        recording: info
          ? { duration_ms: info.endedAt - (start || info.startedAt), chunks: info.chunks, started_at: new Date(start || info.startedAt).toISOString(), ended_at: new Date(info.endedAt).toISOString(), parts_count: parts.length }
          : {},
      });
      clearSnapshot();
    } catch (e) {}
    setRec({ phase: "queued" });
    await writeRecState({ run_id: runId, phase: "queued" });
    finishingRef.current = false;
    refreshPending();
    runUploads();
  }
  async function discardActiveRun() {
    const r = recorderRef.current;
    const ids = new Set([runIdRef.current, ...(partsRef.current || []).map((p) => p.run_id)]);
    try {
      if (r && r.active) await r.stop();
    } catch (e) {}
    for (const id of ids) if (id) await discardRun(id);
    clearSnapshot();
    runIdRef.current = null;
    recStartRef.current = null;
    partsRef.current = [];
    stageRef.current = null;
    endedRef.current = false;
    setRec({ phase: "idle" });
  }
  function setAnswer(qid, value, qType) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
    if (qType === "text" && !typingSentRef.current) {
      typingSentRef.current = true;
      const s = sessionRef.current;
      if (s && s.status === "live") {
        supabase
          .from("interview_sessions")
          .update({ interviewee_activity: { typing: true, slide_id: s.current_slide_id } })
          .eq("id", s.id)
          .then(() => {});
      }
    }
  }
  function markMeta(slideId, patch) {
    setSlideMeta((prev) => ({ ...prev, [slideId]: { ...(prev[slideId] || {}), ...patch } }));
  }
  function topTap() {
    const now = Date.now();
    tapsRef.current = tapsRef.current.filter((x) => now - x < 3000).concat(now);
    if (tapsRef.current.length >= 5) {
      tapsRef.current = [];
      setManualUntil(now + 15000);
    }
  }
  function manualGo(delta) {
    const d = deckRef.current;
    const s = sessionRef.current;
    if (!d || !s) return;
    const i = slideIndexById(d, s.current_slide_id);
    const next = Math.max(0, Math.min(d.slides.length - 1, i + delta));
    patchSession({ current_slide_id: d.slides[next].id });
  }

  // ── Render ──
  const recording = rec.phase === "recording";
  const showManual = manualUntil > Date.now();
  const shell = (children, extras) => (
    <div style={{ minHeight: "100vh", background: warmBg, fontFamily: sans, color: textPrimary }}>
      <Fonts />
      <ConnectionDot online={online} u={u} />
      {recording && <RecDot />}
      {children}
      {extras}
    </div>
  );
  const idlePanels = (
    <>
      <DeckPanel sync={sync} onSync={() => runSync({ manual: true })} />
      <UploadStatus pending={pending} busy={uploadBusy} onUploadNow={runUploads} />
    </>
  );
  const tapZone = <div onClick={topTap} style={{ position: "fixed", top: 0, left: 0, right: 0, height: 44, zIndex: 55 }} />;

  if (boot === "booting") return shell(<StatusScreen message={u.loading} />);
  if (boot === "error" || !session) return shell(<StatusScreen message={u.err_session} onRetry={() => setBootKey((k) => k + 1)} retryLabel={u.retry} />);

  if (interrupted && ACTIVE.includes(status))
    return shell(<InterruptedScreen showControls={showManual} busy={resumeBusy} error={resumeError} onResume={resumeInterview} onRestart={restartInterviewee} />, tapZone);

  if (status === "pairing")
    return shell(
      <PairingScreen code={session.pairing_code} u={u} onNewCode={newCode}>
        {idlePanels}
      </PairingScreen>
    );
  if (status === "paired" || status === "abandoned" || !status)
    return shell(
      <WaitingScreen name={session.interviewer_name} u={u}>
        {idlePanels}
      </WaitingScreen>
    );

  if (!deck || !contract) return shell(<StatusScreen message={u.loading_deck} />);

  const lang = session.language || deck.default_language || "en";
  const ul = t(lang);
  const demoFields = parseDemoFields(contract);
  const cfg = getConsentConfig(contract, deck, lang);
  const hasDemo = demoFields.length > 0;
  const totalSteps = 1 + (hasDemo ? 1 : 0) + deck.slides.length;

  if (status === "consent" || status === "demographics") {
    if (camError) return shell(<StatusScreen message={camError} onRetry={consentDone} retryLabel={u.retry} />);
    if (rec.phase === "starting") return shell(<StatusScreen message={u.loading} />);
    if (localStage === "welcome") return shell(<WelcomeScreen contract={contract} u={ul} onContinue={() => setLocalStage("consent")} />);
    if (localStage === "consent")
      return shell(
        <ConsentScreen contract={contract} u={ul} cfg={cfg} demoFields={demoFields} checks={checks} setChecks={setChecks} signature={signature} setSignature={setSignature} onContinue={consentDone} current={1} total={totalSteps} bottomOffset={0} />
      );
    return shell(
      <DemographicsScreen u={ul} demoFields={demoFields} demographics={demographics} setDemographics={setDemographics} onBack={() => setLocalStage("consent")} onContinue={goLive} current={2} total={totalSteps} bottomOffset={0} />
    );
  }

  if (status === "ended") return shell(<ThankYou contract={contract} lang={lang} retentionDays={cfg.data_retention_days} />, <SaveLine phase={rec.phase} />);

  // live
  const index = slideIndexById(deck, session.current_slide_id);
  const slide = deck.slides[index];
  const q = slideOf(slide);
  const st = slide.settings || {};
  const needsWatch = !!slide.media && slide.media.type === "video" && !!st.require_full_playback && !watched[slide.id];
  const locked = !!q && needsWatch;

  return shell(
    <>
      {tapZone}
      <div style={{ paddingBottom: 60 }}>
        {deck.show_progress !== false && (
          <div style={{ padding: "28px 24px 0", maxWidth: 1100, margin: "0 auto" }}>
            <ProgressBar current={(hasDemo ? 2 : 1) + index + 1} total={totalSteps} />
            <div style={{ fontSize: 12, color: textSecondary, marginTop: 8, fontWeight: 500 }}>{ul.slide_of(index + 1, deck.slides.length)}</div>
          </div>
        )}
        <SlideView
          key={slide.id}
          slide={slide}
          q={q}
          lang={lang}
          landscape={landscape}
          answer={q ? answers[q.id] : null}
          onAnswer={(qid, v) => setAnswer(qid, v, q ? q.type : null)}
          locked={locked}
          watched={!!watched[slide.id]}
          onWatched={() => {
            setWatched((w) => ({ ...w, [slide.id]: true }));
            markMeta(slide.id, { full_playback: true });
          }}
          mediaCommand={session.media_command}
        />
      </div>
      {session.screen_blank && <BlankOverlay />}
      {showManual && (
        <ManualControls index={index} total={deck.slides.length} onPrev={() => manualGo(-1)} onNext={() => manualGo(1)} onHide={() => setManualUntil(0)} onUnblank={session.screen_blank ? () => patchSession({ screen_blank: false }) : null} />
      )}
    </>
  );
}
