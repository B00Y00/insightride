"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { Fonts, t, L, isAnswered, summarizeAnswer, SlideView, slideIndexById, slideOf, parseDemoFields, DEMO_FIELDS, DEMO_OPTIONS } from "../../../lib/deck";
import { contractMatchesRegion, regionLabel, normRegion } from "../../../lib/decksync";

// ============================================================
// InsightRide — Interviewer phone: Tablet pairing + Presenter remote
// File location in repo: src/app/interviewer/tablet/page.js
// Open on the phone: /interviewer/tablet
//
// Identity -> Pair (6-char code) -> Start interview -> Presenter remote -> End (wrap-up)
// Contracts are filtered by the interviewer's region. "Start interview" is
// gated on the TABLET having the deck fully cached (session.deck_cache).
// If the tablet crashes mid-interview, an "interrupted" card offers Resume,
// Start over, Cancel or End (session.recording_state.phase === "interrupted").
// ============================================================

const F = "'DM Sans', sans-serif";
const C = { bg: "#0E0E0C", card: "#1A1A18", card2: "#222220", border: "#2A2A28", gold: "#D4A017", text: "#E8E8E4", muted: "#888880", soft: "#A8A8A4", green: "#6EC4A7", red: "#E06050", amber: "#D4A76A" };
const ME_KEY = "ir_interviewer";
const SESSION_KEY = "ir_phone_session";
const POLL_MS = 8000;
const REMINDER_MIN = 45;

function isNewer(next, prev) {
  if (!prev) return true;
  if (!next) return false;
  return String(next.updated_at || "") >= String(prev.updated_at || "");
}
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
}
function fmtBytes(b) {
  if (!b) return "";
  if (b > 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
  return Math.round(b / 1e3) + " KB";
}
function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  return Math.round(s / 3600) + " h ago";
}
function getLocation() {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    navigator.geolocation.getCurrentPosition(
      (p) => finish({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, captured_at: new Date().toISOString() }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
    );
    setTimeout(() => finish(null), 7000);
  });
}
function useViewportWidth() {
  const [w, setW] = useState(390);
  useEffect(() => {
    const f = () => setW(window.innerWidth);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return w;
}

const btn = (extra) => ({ padding: "12px 16px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, fontFamily: F, cursor: "pointer", ...extra });
const input = { width: "100%", padding: "14px 16px", borderRadius: 10, border: "1.5px solid " + C.border, background: C.card, color: C.text, fontSize: 16, fontFamily: F, boxSizing: "border-box", outline: "none" };
const label = { fontSize: 12, color: C.muted, fontWeight: 500, marginBottom: 6 };

function Shell({ children, title, subtitle, right }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: F, color: C.text, paddingBottom: 40 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <Fonts />
      <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid " + C.border, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <a href="/interviewer" style={{ fontSize: 11, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, textDecoration: "none" }}>
            InsightRide
          </a>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}
function Card({ children, style }) {
  return <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 14, padding: 16, marginBottom: 12, ...style }}>{children}</div>;
}
function Chip({ label: text, selected, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: "8px 14px", borderRadius: 20, border: selected ? "2px solid " + C.gold : "1.5px solid #3A3A38", background: selected ? "#2A2520" : "#1E1E1C", color: selected ? "#F0D060" : C.soft, fontSize: 13, fontWeight: selected ? 600 : 400, fontFamily: F, cursor: "pointer", whiteSpace: "nowrap" }}>
      {text}
    </button>
  );
}

function recordingLine(rs) {
  const p = rs && rs.phase;
  if (!p) return null;
  if (p === "recording") return { color: C.green, text: "Camera recording" };
  if (p === "interrupted") return { color: C.amber, text: "The tablet restarted mid-interview. Waiting for your choice." };
  if (p === "saving") return { color: C.gold, text: "Saving recording on the tablet..." };
  if (p === "queued") return { color: C.gold, text: "Recording saved on the tablet. Upload starting..." };
  if (p === "uploading") return { color: C.gold, text: "Uploading" + (rs.bytes ? " (" + fmtBytes(rs.bytes) + ")" : "") + "..." };
  if (p === "finalizing") return { color: C.gold, text: "Finishing up..." };
  if (p === "done") return { color: C.green, text: "Uploaded and saved" + (rs.interview_number ? " as interview #" + rs.interview_number : "") + "." };
  if (p === "error") return { color: C.red, text: "Not uploaded yet: " + (rs.error || "unknown error") + " The tablet keeps retrying; make sure it gets Wi-Fi before the end of the shift." };
  return null;
}

// Shown when the tablet restarted in the middle of an interview
function InterruptedCard({ rs, where, onResume, onStartOver, onCancel, onEnd, busy }) {
  return (
    <div style={{ background: "#3A2E14", border: "1px solid " + C.gold, borderRadius: 12, padding: "14px", marginBottom: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.gold, marginBottom: 6 }}>The tablet restarted mid-interview</div>
      <div style={{ fontSize: 13, color: C.amber, lineHeight: 1.5, marginBottom: 10 }}>
        Answers and progress up to {where} are saved on the tablet. The tablet is showing the interviewee a "one moment please" screen.
      </div>
      {rs && rs.error && <div style={{ fontSize: 13, color: "#F0B0A8", lineHeight: 1.5, marginBottom: 10 }}>Last attempt failed: {rs.error}</div>}
      <button onClick={onResume} disabled={busy} style={btn({ width: "100%", padding: 14, background: busy ? "#3A3A38" : C.gold, color: busy ? "#666" : "#0E0E0C", marginBottom: 8 })}>
        {busy ? "Asking the tablet..." : "Resume interview"}
      </button>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onStartOver} style={btn({ flex: 1, background: C.card2, color: C.text })}>
          Start over
        </button>
        {onEnd && (
          <button onClick={onEnd} style={btn({ flex: 1, background: C.card2, color: C.text })}>
            End and save
          </button>
        )}
        <button onClick={onCancel} style={btn({ flex: 1, background: C.card2, color: C.red })}>
          Cancel
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginTop: 10 }}>
        Resume continues recording in a second video file; both files are transcribed together onto one timeline. Start over discards this attempt. End and save keeps what was recorded and answered so far.
      </div>
    </div>
  );
}

// What the TABLET has cached for this contract (from session.deck_cache)
function tabletStatus(c, deckCache) {
  const e = deckCache && deckCache.contracts ? deckCache.contracts[c.id] : null;
  if (!deckCache || !deckCache.synced_at) return { ready: false, label: "Tablet has not synced yet", color: C.amber };
  if (!e) return { ready: false, label: "Not on the tablet yet — tap Sync now on the tablet", color: C.amber };
  if (e.version !== c.deck_version) return { ready: false, label: "Tablet has v" + e.version + ", current is v" + c.deck_version + " — sync the tablet", color: C.amber };
  if (e.ready) return { ready: true, label: "Ready on tablet", color: C.green };
  if (e.error) return { ready: false, label: "Download problem on tablet: " + e.error, color: C.red };
  return { ready: false, label: (e.deferred ? "Tablet waiting for Wi-Fi " : "Tablet downloading ") + e.media_cached + "/" + e.media_total, color: C.amber };
}

// Choose the deck language for this interviewer's region (falls back to the deck default)
function pickLanguage(deck, region) {
  const langs = deck && deck.languages && typeof deck.languages === "object" ? deck.languages : {};
  const mine = [region && region.city, region && region.country].map(normRegion).filter(Boolean);
  for (const [code, regs] of Object.entries(langs)) {
    if (Array.isArray(regs) && regs.map(normRegion).some((r) => mine.includes(r))) return code;
  }
  return (deck && deck.default_language) || "en";
}

// ── Main ──
export default function InterviewerTabletPage() {
  const vw = useViewportWidth();
  const [phase, setPhase] = useState("boot");
  const [me, setMe] = useState({ name: "", city: "", country: "" });
  const [session, setSession] = useState(null);
  const [online, setOnline] = useState(true);
  const [contract, setContract] = useState(null);
  const [deck, setDeck] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [code, setCode] = useState("");
  const [pairError, setPairError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [wrapUp, setWrapUp] = useState(false);
  const [interviewerDemo, setInterviewerDemo] = useState({});
  const [ending, setEnding] = useState(false);
  const [resumeAsked, setResumeAsked] = useState(0);
  const sessionRef = useRef(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      let stored = null;
      try {
        const raw = localStorage.getItem(ME_KEY);
        if (raw) stored = JSON.parse(raw);
      } catch (e) {}
      if (stored && stored.name) setMe(stored);
      let row = null;
      try {
        const sid = localStorage.getItem(SESSION_KEY);
        if (sid) {
          const { data } = await supabase.from("interview_sessions").select("*").eq("id", sid).maybeSingle();
          if (data && data.status !== "abandoned" && data.status !== "pairing") row = data;
          else localStorage.removeItem(SESSION_KEY);
        }
      } catch (e) {}
      if (cancelled) return;
      if (row) setSession(row);
      setPhase(!stored || !stored.name ? "identity" : row ? "ready" : "pair");
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const sessionId = session ? session.id : null;
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel("phone-" + sessionId)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "interview_sessions", filter: "id=eq." + sessionId }, (payload) => {
        if (payload.new) setSession((prev) => (isNewer(payload.new, prev) ? payload.new : prev));
      })
      .subscribe((s) => setOnline(s === "SUBSCRIBED"));
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
    if (status === "abandoned" || status === "pairing") {
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch (e) {}
      setSession(null);
      setContract(null);
      setDeck(null);
      setPhase("pair");
    }
    if (status !== "live") setWrapUp(false);
  }, [status]);

  const contractId = session ? session.contract_id : null;
  useEffect(() => {
    if (!contractId) {
      setContract(null);
      setDeck(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("contracts")
      .select("*")
      .eq("id", contractId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setContract(data || null);
        setDeck(data && data.deck && Array.isArray(data.deck.slides) ? data.deck : null);
      });
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  useEffect(() => {
    if (phase !== "ready" || (status !== "paired" && status !== "ended")) return;
    let cancelled = false;
    supabase
      .from("contracts")
      .select("id, client, topic, type, estimated_minutes, interviewer_payout, interviewee_incentive, interviews_remaining, interviews_total, deck_version, regions, deck")
      .gt("deck_version", 0)
      .gt("interviews_remaining", 0)
      .order("interviewer_payout", { ascending: false })
      .then(({ data }) => {
        if (!cancelled && data) setContracts(data);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, status]);

  useEffect(() => {
    setReminderDismissed(false);
    setInterviewerDemo({});
  }, [session && session.recording_started_at]);

  // ── Actions ──
  async function update(patch) {
    const s = sessionRef.current;
    if (!s) return;
    setSession((prev) => (prev ? { ...prev, ...patch } : prev));
    await supabase.from("interview_sessions").update(patch).eq("id", s.id);
  }
  function saveIdentity() {
    const clean = { name: me.name.trim(), city: me.city.trim(), country: me.country.trim() };
    if (!clean.name) return;
    try {
      localStorage.setItem(ME_KEY, JSON.stringify(clean));
    } catch (e) {}
    setMe(clean);
    setPhase(session ? "ready" : "pair");
  }
  async function pair() {
    const c = code.trim().toUpperCase();
    if (c.length !== 6) {
      setPairError("The code is 6 characters.");
      return;
    }
    setBusy(true);
    setPairError("");
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data } = await supabase.from("interview_sessions").select("*").eq("pairing_code", c).eq("status", "pairing").gte("created_at", since).order("created_at", { ascending: false }).limit(1);
    const row = data && data[0];
    if (!row) {
      setBusy(false);
      setPairError("Code not found. Check the tablet screen and try again.");
      return;
    }
    const patch = { status: "paired", interviewer_name: me.name, interviewer_city: me.city, interviewer_country: me.country };
    const { data: updated } = await supabase.from("interview_sessions").update(patch).eq("id", row.id).select().single();
    try {
      localStorage.setItem(SESSION_KEY, row.id);
    } catch (e) {}
    setSession(updated || { ...row, ...patch });
    setCode("");
    setBusy(false);
    setPhase("ready");
  }
  async function unpair() {
    if (!window.confirm("Unpair this tablet? It will show a new code.")) return;
    await update({ status: "abandoned" });
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
    setSession(null);
    setContract(null);
    setDeck(null);
    setPhase("pair");
  }
  const RESET = {
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
  async function startInterview(c) {
    setBusy(true);
    await update({ ...RESET, contract_id: c.id, status: "consent", language: pickLanguage(c.deck, { city: me.city, country: me.country }), deck_version: c.deck_version });
    setBusy(false);
  }
  async function cancelInterview() {
    if (!window.confirm("Cancel this interview? The recording will be discarded and nothing will be saved.")) return;
    await update({ ...RESET, status: "paired", contract_id: null });
  }
  async function requestResume() {
    setResumeAsked(Date.now());
    await update({ resume_request: { action: "resume", nonce: Date.now() } });
  }
  async function startOver() {
    if (!window.confirm("Start this interviewee over? The interrupted recording is discarded and the tablet shows the welcome screen again.")) return;
    await update({ ...RESET, status: "consent", contract_id: contract ? contract.id : session.contract_id, language: session.language, deck_version: contract ? contract.deck_version : session.deck_version });
  }
  async function endAndSave() {
    if (!window.confirm("End this interview and save what was recorded and answered so far?")) return;
    const loc = await getLocation();
    await update({ status: "ended", ended_at: new Date().toISOString(), screen_blank: false, media_command: null, end_location: loc });
  }
  function goTo(i) {
    if (!deck) return;
    const s = deck.slides[Math.max(0, Math.min(deck.slides.length - 1, i))];
    update({ current_slide_id: s.id, screen_blank: !!(s.settings && s.settings.auto_blank), media_command: null });
  }
  function media(action) {
    if (!deck || !session) return;
    update({ media_command: { action, slide_id: session.current_slide_id, nonce: Date.now() } });
  }
  async function confirmEnd() {
    setEnding(true);
    const loc = await getLocation();
    await update({ status: "ended", ended_at: new Date().toISOString(), screen_blank: false, media_command: null, interviewer_demographics: interviewerDemo, end_location: loc });
    setEnding(false);
    setWrapUp(false);
  }
  async function nextInterviewee(sameContract) {
    if (sameContract && contract) await update({ ...RESET, status: "consent", contract_id: contract.id, language: pickLanguage(deck, { city: me.city, country: me.country }), deck_version: contract.deck_version });
    else await update({ ...RESET, status: "paired", contract_id: null });
  }

  // ── Screens ──
  const onlineDot = <span title={online ? "Connected" : "Reconnecting"} style={{ width: 10, height: 10, borderRadius: "50%", background: online ? C.green : C.red, flexShrink: 0 }} />;

  if (phase === "boot") {
    return (
      <Shell title="Tablet">
        <div style={{ padding: 20, color: C.muted }}>Loading...</div>
      </Shell>
    );
  }

  if (phase === "identity") {
    return (
      <Shell title="Set up your interviewer profile" subtitle="Stored on this phone only">
        <div style={{ padding: 20 }}>
          <Card>
            <div style={label}>Your name (shown on the tablet)</div>
            <input value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} placeholder="e.g. Priya" style={{ ...input, marginBottom: 14 }} />
            <div style={label}>Home city</div>
            <input value={me.city} onChange={(e) => setMe({ ...me, city: e.target.value })} placeholder="e.g. Brampton" style={{ ...input, marginBottom: 14 }} />
            <div style={label}>Country</div>
            <input value={me.country} onChange={(e) => setMe({ ...me, country: e.target.value })} placeholder="e.g. Canada" style={{ ...input, marginBottom: 18 }} />
            <button onClick={saveIdentity} disabled={!me.name.trim()} style={btn({ width: "100%", padding: 14, background: me.name.trim() ? C.gold : "#3A3A38", color: me.name.trim() ? "#0E0E0C" : "#666" })}>
              Save and continue
            </button>
          </Card>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>Your city and country decide which contracts you see and which decks the tablet preloads. Interviewer sign-in will replace this form before launch.</div>
        </div>
      </Shell>
    );
  }

  if (phase === "pair" || !session) {
    return (
      <Shell title="Pair a tablet" subtitle={"Interviewer: " + me.name} right={<button onClick={() => setPhase("identity")} style={btn({ background: C.card2, color: C.soft, padding: "8px 12px", fontSize: 12 })}>Edit profile</button>}>
        <div style={{ padding: 20 }}>
          <Card>
            <div style={{ fontSize: 14, color: C.soft, lineHeight: 1.5, marginBottom: 14 }}>Open the InsightRide kiosk on the tablet. It shows a 6-character code. Type it here.</div>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="ABC123" autoCapitalize="characters" autoCorrect="off" style={{ ...input, fontSize: 28, letterSpacing: "0.3em", textAlign: "center", fontWeight: 700, marginBottom: 12 }} />
            {pairError && <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{pairError}</div>}
            <button onClick={pair} disabled={busy || code.length !== 6} style={btn({ width: "100%", padding: 14, background: code.length === 6 && !busy ? C.gold : "#3A3A38", color: code.length === 6 && !busy ? "#0E0E0C" : "#666" })}>
              {busy ? "Pairing..." : "Pair tablet"}
            </button>
          </Card>
        </div>
      </Shell>
    );
  }

  const lang = session.language || (deck && deck.default_language) || "en";
  const u = t(lang);
  const rs = session.recording_state || {};
  const recLine = recordingLine(rs);
  const isInterrupted = rs.phase === "interrupted";
  const resumeBusy = isInterrupted && !rs.error && resumeAsked && Date.now() - resumeAsked < 20000;
  const deckCache = session.deck_cache || {};
  const region = { city: me.city, country: me.country };
  const visibleContracts = contracts.filter((c) => contractMatchesRegion(c, region));
  const headerRight = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {onlineDot}
      <button onClick={unpair} style={btn({ background: C.card2, color: C.soft, padding: "8px 12px", fontSize: 12 })}>
        Unpair
      </button>
    </div>
  );

  if (status === "paired") {
    return (
      <Shell title="Tablet paired" subtitle={"Code " + (session.pairing_code || "") + " · " + me.name} right={headerRight}>
        <div style={{ padding: 20 }}>
          <Card style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
              Showing contracts for <span style={{ color: C.text }}>{regionLabel(region) || "no region set"}</span>. Tablet decks synced {deckCache.synced_at ? ago(deckCache.synced_at) : "never"}
              {deckCache.connection ? " on " + (deckCache.connection === "wifi" ? "Wi-Fi" : deckCache.connection === "cellular" ? "mobile data" : deckCache.connection) : ""}.
            </div>
          </Card>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>Start an interview</div>
          {visibleContracts.length === 0 && <div style={{ color: C.muted, fontSize: 14, padding: "30px 0", textAlign: "center" }}>No contracts with a slide deck are available for your region right now.</div>}
          {visibleContracts.map((c) => {
            const ts = tabletStatus(c, deckCache);
            return (
              <Card key={c.id}>
                <div style={{ fontSize: 11, color: C.muted, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 3 }}>{c.client}</div>
                <div style={{ fontSize: 15, fontWeight: 500, color: C.text, lineHeight: 1.4, marginBottom: 10 }}>{c.topic}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, fontSize: 11, color: C.soft }}>
                  <span style={{ padding: "3px 8px", borderRadius: 6, background: C.card2 }}>{(c.deck && c.deck.slides && c.deck.slides.length) || 0} slides</span>
                  <span style={{ padding: "3px 8px", borderRadius: 6, background: C.card2 }}>~{c.estimated_minutes} min</span>
                  <span style={{ padding: "3px 8px", borderRadius: 6, background: C.card2 }}>{c.interviews_remaining} remaining</span>
                  <span style={{ padding: "3px 8px", borderRadius: 6, background: C.card2, color: C.gold }}>You earn ${c.interviewer_payout}</span>
                </div>
                <div style={{ fontSize: 12, color: ts.color, marginBottom: 10, lineHeight: 1.4 }}>{ts.label}</div>
                <button onClick={() => startInterview(c)} disabled={busy || !ts.ready} style={btn({ width: "100%", padding: 14, background: ts.ready && !busy ? C.gold : "#3A3A38", color: ts.ready && !busy ? "#0E0E0C" : "#666" })}>
                  {ts.ready ? "Start interview on tablet" : "Deck not ready on tablet"}
                </button>
              </Card>
            );
          })}
        </div>
      </Shell>
    );
  }

  if (status === "consent" || status === "demographics") {
    return (
      <Shell title={contract ? contract.client : "Starting..."} subtitle={contract ? contract.topic : ""} right={headerRight}>
        <div style={{ padding: 20 }}>
          {isInterrupted && <InterruptedCard rs={rs} where="the demographic questions" busy={resumeBusy} onResume={requestResume} onStartOver={startOver} onCancel={cancelInterview} onEnd={null} />}
          <Card style={{ textAlign: "center", padding: 28 }}>
            <div style={{ width: 14, height: 14, borderRadius: "50%", background: C.gold, margin: "0 auto 14px", animation: "irPulse 1.4s ease-in-out infinite" }} />
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>{status === "consent" ? "Interviewee is reading the consent form" : "Interviewee is answering the demographic questions"}</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>The tablet is theirs for this part. Presenter controls appear here the moment they finish.</div>
            {rs.phase === "recording" && <div style={{ fontSize: 13, color: C.green, marginTop: 12 }}>Camera recording since consent was given.</div>}
            {rs.phase === "error" && <div style={{ fontSize: 13, color: C.red, marginTop: 12, lineHeight: 1.5 }}>Camera problem on the tablet: {rs.error} The tablet shows a Try again button.</div>}
          </Card>
          <button onClick={cancelInterview} style={btn({ width: "100%", padding: 14, background: C.card2, color: C.red })}>
            Cancel interview
          </button>
        </div>
      </Shell>
    );
  }

  if (status === "ended") {
    return (
      <Shell title="Interview ended" subtitle={contract ? contract.client + " · " + contract.topic : ""} right={headerRight}>
        <div style={{ padding: 20 }}>
          {recLine && (
            <Card style={{ padding: "12px 14px" }}>
              <div style={{ fontSize: 13, color: recLine.color, lineHeight: 1.5 }}>{recLine.text}</div>
            </Card>
          )}
          <Card>
            <div style={{ fontSize: 14, color: C.soft, lineHeight: 1.5, marginBottom: 14 }}>The tablet is showing the thank-you screen. Arrange the interviewee payment, then choose what to do next. Uploads continue on the tablet in the background.</div>
            <button onClick={() => nextInterviewee(true)} style={btn({ width: "100%", padding: 14, background: C.gold, color: "#0E0E0C", marginBottom: 10 })}>
              Next interviewee, same contract
            </button>
            <button onClick={() => nextInterviewee(false)} style={btn({ width: "100%", padding: 14, background: C.card2, color: C.text })}>
              Choose a different contract
            </button>
          </Card>
        </div>
      </Shell>
    );
  }

  // ── LIVE ──
  if (!deck || !contract) {
    return (
      <Shell title="Loading deck..." right={headerRight}>
        <div style={{ padding: 20, color: C.muted }}>Loading...</div>
      </Shell>
    );
  }
  const slides = deck.slides;
  const index = slideIndexById(deck, session.current_slide_id);
  const cur = slides[index];
  const q = slideOf(cur);
  const nextSlide = slides[index + 1] || null;
  const live = session.live_answers || {};
  const act = session.interviewee_activity || {};
  const typingHere = !!act.typing && act.slide_id === cur.id;
  const liveAnswer = q && !q.private ? live[q.id] : null;
  const answeredHere = q ? (q.private ? null : isAnswered(q, live[q.id])) : true;
  const summary = q && !q.private ? summarizeAnswer(q, live[q.id], lang) : null;
  const startedAt = session.recording_started_at ? new Date(session.recording_started_at).getTime() : now;
  const elapsed = now - startedAt;
  const overtime = elapsed > REMINDER_MIN * 60 * 1000 && !reminderDismissed;
  const notes = (cur.notes || []).map((n) => L(n, lang)).filter(Boolean);
  const scale = Math.min(1, (vw - 40) / 720);
  const hasVideo = !!cur.media && cur.media.type === "video";
  const blank = !!session.screen_blank;
  const intervieweeFields = parseDemoFields(contract);
  const interviewerFields = DEMO_FIELDS.filter((f) => !intervieweeFields.includes(f));
  const cameraOk = rs.phase === "recording";

  if (wrapUp) {
    return (
      <Shell title="Before you end" subtitle={contract.client + " · " + fmtElapsed(elapsed)} right={onlineDot}>
        <div style={{ padding: 20 }}>
          {interviewerFields.length > 0 && (
            <Card>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Interviewee details you observed</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>These were not asked on the tablet for this contract. Leave blank if unsure.</div>
              {interviewerFields.map((f) => (
                <div key={f} style={{ marginBottom: 14 }}>
                  <div style={label}>{f === "ageRange" ? "Age range" : f.charAt(0).toUpperCase() + f.slice(1)}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {DEMO_OPTIONS[f].map((o) => (
                      <Chip key={o} label={o} selected={interviewerDemo[f] === o} onClick={() => setInterviewerDemo((d) => ({ ...d, [f]: d[f] === o ? undefined : o }))} />
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}
          <Card style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 13, color: C.soft, lineHeight: 1.5 }}>Ending stops the recording, saves every answer, and captures this location as the end point. The tablet then shows the thank-you screen.</div>
          </Card>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setWrapUp(false)} disabled={ending} style={btn({ flex: 1, padding: 14, background: C.card2, color: C.text })}>
              Back
            </button>
            <button onClick={confirmEnd} disabled={ending} style={btn({ flex: 2, padding: 14, background: ending ? "#3A3A38" : C.red, color: "#fff" })}>
              {ending ? "Ending..." : "Confirm: end interview"}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      title={contract.client}
      subtitle={contract.topic}
      right={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {onlineDot}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: cameraOk ? C.red : C.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: cameraOk ? C.red : "#555", animation: cameraOk ? "irPulse 1.4s ease-in-out infinite" : "none" }} />
            {fmtElapsed(elapsed)}
          </div>
        </div>
      }
    >
      <div style={{ padding: "14px 16px 0" }}>
        {isInterrupted && <InterruptedCard rs={rs} where={"slide " + (index + 1) + " of " + slides.length} busy={resumeBusy} onResume={requestResume} onStartOver={startOver} onCancel={cancelInterview} onEnd={endAndSave} />}
        {rs.phase === "error" && (
          <div style={{ background: "#3A2020", border: "1px solid " + C.red, borderRadius: 12, padding: "12px 14px", marginBottom: 12, fontSize: 13, color: "#F0B0A8", lineHeight: 1.5 }}>
            <strong style={{ color: C.red }}>Camera is not recording.</strong> {rs.error}
          </div>
        )}
        {overtime && (
          <div style={{ background: "#3A2E14", border: "1px solid " + C.gold, borderRadius: 12, padding: "12px 14px", marginBottom: 12, fontSize: 13, color: C.amber, lineHeight: 1.5 }}>
            <strong style={{ color: C.gold }}>Over {REMINDER_MIN} minutes.</strong> Did you forget to end the interview?
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => setWrapUp(true)} style={btn({ background: C.gold, color: "#0E0E0C", padding: "8px 12px", fontSize: 12 })}>
                End interview
              </button>
              <button onClick={() => setReminderDismissed(true)} style={btn({ background: C.card2, color: C.soft, padding: "8px 12px", fontSize: 12 })}>
                Still going
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Slide {index + 1} of {slides.length} · {cur.title || cur.id}
          </div>
          {blank && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#000", color: C.gold, fontWeight: 600 }}>SCREEN BLANK</span>}
        </div>
        <div style={{ position: "relative", height: Math.round(360 * scale) + 20, borderRadius: 12, overflow: "hidden", background: "#FDFBF7", border: "1px solid " + C.border, marginBottom: 10 }}>
          <div style={{ width: 720, transform: "scale(" + scale + ")", transformOrigin: "top left", pointerEvents: "none" }}>
            <SlideView slide={cur} q={q} lang={lang} landscape={false} answer={liveAnswer} onAnswer={() => {}} locked={false} watched={false} onWatched={() => {}} mirror />
          </div>
          {blank && <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.82)" }} />}
        </div>

        {q && (
          <Card style={{ padding: "12px 14px" }}>
            {q.private ? (
              <div style={{ fontSize: 13, color: C.amber }}>Private question. The answer is hidden from you.{typingHere ? " Interviewee is typing." : ""}</div>
            ) : q.type === "voice" ? (
              <div style={{ fontSize: 13, color: C.green }}>Voice answer. The transcript for this slide becomes the answer.</div>
            ) : typingHere ? (
              <div style={{ fontSize: 13, color: C.gold }}>Interviewee is typing...</div>
            ) : answeredHere ? (
              <div style={{ fontSize: 13, color: C.green }}>
                <span style={{ color: C.muted }}>Answered: </span>
                {summary}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.muted }}>Waiting for an answer.</div>
            )}
          </Card>
        )}

        {notes.length > 0 && (
          <Card style={{ padding: "12px 14px", background: "#1A1F1C", borderColor: "#2A3A2E" }}>
            <div style={{ fontSize: 11, color: C.green, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Your notes</div>
            {notes.map((n, i) => (
              <div key={i} style={{ fontSize: 13, color: "#C8C8C4", lineHeight: 1.5, marginBottom: 4 }}>
                {n}
              </div>
            ))}
          </Card>
        )}

        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>Next: </span>
          {nextSlide ? (nextSlide.title || nextSlide.id) + (slideOf(nextSlide) ? " — " + L(slideOf(nextSlide).prompt, lang) : nextSlide.text ? " — " + L(nextSlide.text.heading, lang) : "") : "End of deck"}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {hasVideo && (
            <>
              <button onClick={() => media("play")} style={btn({ flex: 1, background: C.card2, color: C.text })}>
                Play
              </button>
              <button onClick={() => media("pause")} style={btn({ flex: 1, background: C.card2, color: C.text })}>
                Pause
              </button>
              <button onClick={() => media("replay")} style={btn({ flex: 1, background: C.card2, color: C.text })}>
                Replay
              </button>
            </>
          )}
          <button onClick={() => update({ screen_blank: !blank })} style={btn({ flex: 1, background: blank ? C.gold : C.card2, color: blank ? "#0E0E0C" : C.text })}>
            {blank ? "Unblank screen" : "Blank screen"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <button onClick={() => goTo(index - 1)} disabled={index === 0} style={btn({ flex: 1, padding: 16, fontSize: 16, background: index === 0 ? "#222220" : "#3A3A38", color: index === 0 ? "#555" : C.text })}>
            Back
          </button>
          <button onClick={() => goTo(index + 1)} disabled={!nextSlide} style={btn({ flex: 2, padding: 16, fontSize: 16, background: nextSlide ? C.gold : "#222220", color: nextSlide ? "#0E0E0C" : "#555" })}>
            {nextSlide ? "Next slide" : "Last slide"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 14 }}>
          {slides.map((s, i) => {
            const sq = slideOf(s);
            const done = sq ? (sq.private ? null : isAnswered(sq, live[sq.id])) : null;
            const isCur = i === index;
            return (
              <button key={s.id} onClick={() => goTo(i)} style={{ flexShrink: 0, minWidth: 64, padding: "8px 10px", borderRadius: 10, border: isCur ? "2px solid " + C.gold : "1px solid " + C.border, background: isCur ? "#2A2520" : C.card, color: isCur ? C.gold : C.soft, fontSize: 11, fontFamily: F, cursor: "pointer", textAlign: "left" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{i + 1}</div>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90 }}>{s.title || s.id}</div>
                {sq && <div style={{ color: done === null ? C.amber : done ? C.green : C.muted, fontSize: 10, marginTop: 2 }}>{done === null ? "private" : done ? "answered" : "open"}</div>}
              </button>
            );
          })}
        </div>

        <button onClick={() => setWrapUp(true)} style={btn({ width: "100%", padding: 14, background: "#3A2020", color: C.red })}>
          End interview
        </button>
      </div>
    </Shell>
  );
}
