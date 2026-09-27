"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import {
  tokens,
  Fonts,
  t,
  L,
  isAnswered,
  useLandscape,
  resolveContractId,
  parseDemoFields,
  getConsentConfig,
  DEMO_OPTIONS,
  ProgressBar,
  OptionButton,
  CheckRow,
  SlideView,
  ThankYou,
  inputStyle,
} from "../../../lib/deck";

// ============================================================
// InsightRide — Interviewee Tablet
// STEP 3: deck loaded from Supabase + consent + demographics + slides
//
// File location in repo: src/app/interview/[contractId]/page.js
// Test URL:              /interview/demo  (maps to the seeded demo contract)
//
// Flow: loading -> welcome -> consent -> demographics -> slides -> complete
// Answers are held in the exact survey_responses shape (keyed by question id).
// Still to come: presenter mode (interviewer phone replaces the test bar),
// camera recording + slide timeline, saving the completed interview.
// ============================================================

const { serif, sans, accent, accentLight, warmBg, cardBg, textPrimary, textSecondary, border, amber } = tokens;

// Height reserved for the temporary test bar. Becomes 0 when presenter mode replaces it.
const TEST_BAR = 72;

const EMPTY_CHECKS = { understood: false, recording: false, dataUse: false, voluntary: false, withdraw: false };

// ── Screens ──

function Centered({ children }) {
  return (
    <div style={{ minHeight: "80vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", textAlign: "center" }}>
      {children}
    </div>
  );
}

function StatusScreen({ message, onRetry, retryLabel }) {
  return (
    <Centered>
      <div style={{ fontSize: 17, color: textSecondary, lineHeight: 1.6, maxWidth: 420 }}>{message}</div>
      {onRetry && (
        <button onClick={onRetry} style={{ marginTop: 24, padding: "14px 28px", borderRadius: 10, border: "none", background: accent, color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: sans, cursor: "pointer" }}>
          {retryLabel}
        </button>
      )}
    </Centered>
  );
}

function WelcomeScreen({ contract, u, onContinue }) {
  return (
    <Centered>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: accentLight, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M16 4C9.4 4 4 9.4 4 16s5.4 12 12 12 12-5.4 12-12S22.6 4 16 4zm0 22c-5.5 0-10-4.5-10-10S10.5 6 16 6s10 4.5 10 10-4.5 10-10 10z" fill={accent} />
          <path d="M16 10a2 2 0 100 4 2 2 0 000-4zM16 16c-1.1 0-2 .9-2 2v4a2 2 0 104 0v-4c0-1.1-.9-2-2-2z" fill={accent} />
        </svg>
      </div>
      <h1 style={{ fontFamily: serif, fontSize: 28, fontWeight: 700, color: textPrimary, margin: "0 0 12px", lineHeight: 1.3, maxWidth: 480 }}>{u.welcome_title}</h1>
      <p style={{ fontSize: 16, color: textSecondary, lineHeight: 1.6, maxWidth: 380, margin: "0 0 8px" }}>
        {u.welcome_body(contract.estimated_minutes, (contract.topic || "").toLowerCase())}
      </p>
      <div style={{ background: cardBg, border: "1.5px solid " + border, borderRadius: 14, padding: 20, margin: "20px 0", width: "100%", maxWidth: 360 }}>
        <div style={{ fontSize: 32, fontWeight: 700, color: accent, marginBottom: 4 }}>${contract.interviewee_incentive}</div>
        <div style={{ fontSize: 14, color: textSecondary }}>{u.welcome_comp}</div>
      </div>
      <p style={{ fontSize: 14, color: textSecondary, lineHeight: 1.6, maxWidth: 380, margin: "0 0 32px" }}>{u.welcome_note}</p>
      <button onClick={onContinue} style={{ padding: "16px 48px", borderRadius: 12, border: "none", background: accent, color: "#fff", fontSize: 17, fontWeight: 600, cursor: "pointer", fontFamily: sans, width: "100%", maxWidth: 360 }}>
        {u.continue}
      </button>
    </Centered>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: accent, marginBottom: 6 }}>{children}</div>;
}
function SectionText({ children }) {
  return <p style={{ fontSize: 14, color: textPrimary, lineHeight: 1.6, margin: 0 }}>{children}</p>;
}

function ConsentScreen({ contract, u, cfg, demoFields, checks, setChecks, signature, setSignature, onContinue, current, total }) {
  const allConsented = Object.values(checks).every(Boolean) && signature.trim().length > 1;
  const collect = [
    cfg.video_recording ? u.consent_collect_video : null,
    cfg.audio_recording ? u.consent_collect_audio : null,
    cfg.location_data ? u.consent_collect_location : null,
    u.consent_collect_responses,
    demoFields.length > 0 ? u.consent_collect_demo(demoFields.map((f) => u.demo_labels[f].toLowerCase()).join(", ")) : null,
    u.consent_collect_noid,
  ]
    .filter(Boolean)
    .join(" ");
  const items = [
    ["understood", u.consent_ack_read],
    ["recording", u.consent_ack_recording(cfg.video_recording ? u.video_and_audio : u.audio_only)],
    ["dataUse", u.consent_ack_data(cfg.client_name)],
    ["voluntary", u.consent_ack_voluntary],
    ["withdraw", u.consent_ack_withdraw(cfg.data_retention_days)],
  ];

  return (
    <div style={{ paddingBottom: 120 }}>
      <div style={{ padding: "16px 24px 0", maxWidth: 720, margin: "0 auto" }}>
        <ProgressBar current={current} total={total} />
        <div style={{ fontSize: 12, color: textSecondary, marginTop: 8, fontWeight: 500 }}>{u.step_of(current, total, u.consent_step)}</div>
      </div>
      <div style={{ padding: "20px 24px", maxWidth: 720, margin: "0 auto" }}>
        <h2 style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: textPrimary, margin: "0 0 6px" }}>{u.consent_title}</h2>
        <p style={{ fontSize: 14, color: textSecondary, lineHeight: 1.6, margin: "0 0 20px" }}>{u.consent_intro}</p>

        <div style={{ background: cardBg, border: "1.5px solid " + border, borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: 16, borderBottom: "1px solid " + border }}>
            <SectionTitle>{u.consent_purpose_h}</SectionTitle>
            <SectionText>{u.consent_purpose(cfg.client_name)}</SectionText>
          </div>
          <div style={{ padding: 16, borderBottom: "1px solid " + border }}>
            <SectionTitle>{u.consent_collect_h}</SectionTitle>
            <SectionText>{collect}</SectionText>
          </div>
          <div style={{ padding: 16, borderBottom: "1px solid " + border }}>
            <SectionTitle>{u.consent_use_h}</SectionTitle>
            <SectionText>
              {u.consent_use_aggregate} {cfg.third_party_sharing ? u.consent_use_shared(cfg.client_name) : u.consent_use_not_shared}{" "}
              {u.consent_use_retention(cfg.data_retention_days)}
            </SectionText>
          </div>
          <div style={{ padding: 16 }}>
            <SectionTitle>{u.consent_rights_h}</SectionTitle>
            <SectionText>{u.consent_rights(contract.interviewee_incentive, cfg.data_retention_days)}</SectionText>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {items.map(([key, label]) => (
            <CheckRow key={key} label={label} checked={checks[key]} onClick={() => setChecks((c) => ({ ...c, [key]: !c[key] }))} />
          ))}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: textSecondary, display: "block", marginBottom: 8 }}>{u.consent_sig_label}</label>
          <input type="text" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={u.consent_sig_placeholder} style={inputStyle} />
          <div style={{ fontSize: 12, color: textSecondary, marginTop: 6, lineHeight: 1.5 }}>{u.consent_sig_note}</div>
        </div>
      </div>

      <div style={{ position: "fixed", bottom: TEST_BAR, left: 0, right: 0, padding: "16px 24px", background: "linear-gradient(transparent, " + warmBg + " 30%)", paddingTop: 40 }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <button
            onClick={onContinue}
            disabled={!allConsented}
            style={{ width: "100%", padding: 16, borderRadius: 12, border: "none", background: allConsented ? accent : "#C8C4BC", color: allConsented ? "#fff" : "#888", fontSize: 16, fontWeight: 600, cursor: allConsented ? "pointer" : "not-allowed", fontFamily: sans }}
          >
            {allConsented ? u.consent_cta_ready : u.consent_cta_wait}
          </button>
        </div>
      </div>
    </div>
  );
}

function DemographicsScreen({ u, demoFields, demographics, setDemographics, onBack, onContinue, current, total }) {
  const allFilled = demoFields.every((f) => demographics[f]);
  return (
    <div style={{ paddingBottom: 120 }}>
      <div style={{ padding: "16px 24px 0", maxWidth: 720, margin: "0 auto" }}>
        <ProgressBar current={current} total={total} />
        <div style={{ fontSize: 12, color: textSecondary, marginTop: 8, fontWeight: 500 }}>{u.step_of(current, total, u.demo_step)}</div>
      </div>
      <div style={{ padding: "20px 24px", maxWidth: 720, margin: "0 auto" }}>
        <h2 style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: textPrimary, margin: "0 0 6px" }}>{u.demo_title}</h2>
        <p style={{ fontSize: 14, color: textSecondary, lineHeight: 1.6, margin: "0 0 24px" }}>{u.demo_intro}</p>
        {demoFields.map((field) => (
          <div key={field} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: textPrimary, marginBottom: 10 }}>{u.demo_labels[field]}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {DEMO_OPTIONS[field].map((option) => (
                <OptionButton key={option} label={option} selected={demographics[field] === option} onClick={() => setDemographics((d) => ({ ...d, [field]: option }))} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: "fixed", bottom: TEST_BAR, left: 0, right: 0, padding: "16px 24px", background: "linear-gradient(transparent, " + warmBg + " 30%)", paddingTop: 40 }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", gap: 12 }}>
          <button onClick={onBack} style={{ padding: "16px 24px", borderRadius: 12, border: "1.5px solid " + border, background: cardBg, color: textPrimary, fontSize: 15, fontWeight: 500, cursor: "pointer", fontFamily: sans }}>
            {u.back}
          </button>
          <button
            onClick={onContinue}
            disabled={!allFilled}
            style={{ flex: 1, padding: 16, borderRadius: 12, border: "none", background: allFilled ? accent : "#C8C4BC", color: allFilled ? "#fff" : "#888", fontSize: 16, fontWeight: 600, cursor: allFilled ? "pointer" : "not-allowed", fontFamily: sans }}
          >
            {u.continue}
          </button>
        </div>
      </div>
    </div>
  );
}

// Temporary bottom bar. Dark/gold on purpose so it is obviously NOT interviewee UI.
function TestBar({ stage, contractId, canPrev, showNav, nextLabel, nextWarn, onPrev, onNext, onRestart, showData, setShowData }) {
  const btn = (extra) => ({ padding: "12px 16px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, fontFamily: sans, cursor: "pointer", whiteSpace: "nowrap", ...extra });
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: TEST_BAR, boxSizing: "border-box", padding: "0 16px", background: "#1A1A18", borderTop: "1px solid #3A3A38", display: "flex", alignItems: "center", gap: 10, zIndex: 20 }}>
      <div style={{ color: "#888880", fontSize: 11, fontFamily: sans, lineHeight: 1.35, flex: 1, minWidth: 0 }}>
        <div style={{ color: "#D4A017", fontWeight: 600 }}>Step 3 test controls</div>
        <div>
          Contract: {contractId.slice(0, 8)} · Stage: {stage}
        </div>
      </div>
      <button onClick={() => setShowData(!showData)} style={btn({ background: showData ? "#D4A017" : "#2A2A28", color: showData ? "#0E0E0C" : "#A8A8A4" })}>
        Data
      </button>
      <button onClick={onRestart} style={btn({ background: "#2A2A28", color: "#A8A8A4" })}>
        Restart
      </button>
      {showNav && (
        <>
          <button onClick={onPrev} disabled={!canPrev} style={btn({ background: canPrev ? "#3A3A38" : "#222220", color: canPrev ? "#E8E8E4" : "#555" })}>
            Back
          </button>
          <button onClick={onNext} style={btn({ background: nextWarn ? amber : accent, color: "#fff" })}>
            {nextLabel}
          </button>
        </>
      )}
    </div>
  );
}

function DataPanel({ data }) {
  return (
    <div style={{ position: "fixed", right: 12, bottom: TEST_BAR + 12, width: "min(440px, calc(100vw - 24px))", maxHeight: "60vh", overflow: "auto", background: "#0E0E0C", color: "#C8E6D0", border: "1px solid #3A3A38", borderRadius: 12, padding: 14, fontSize: 12, fontFamily: "Menlo, Consolas, monospace", zIndex: 30, boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}>
      <div style={{ color: "#D4A017", fontWeight: 600, marginBottom: 8, fontFamily: sans }}>What will be saved (live)</div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

// ── Main page ──
export default function IntervieweeTablet() {
  const params = useParams();
  const contractId = resolveContractId(params && params.contractId);
  const landscape = useLandscape();

  const [contract, setContract] = useState(null);
  const [deck, setDeck] = useState(null);
  const [stage, setStage] = useState("loading"); // loading | error | welcome | consent | demographics | slides | complete
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [checks, setChecks] = useState(EMPTY_CHECKS);
  const [signature, setSignature] = useState("");
  const [demographics, setDemographics] = useState({});
  const [answers, setAnswers] = useState({}); // survey_responses shape, keyed by question id
  const [slideMeta, setSlideMeta] = useState({}); // per-slide flags (full_playback, advanced_unanswered, ...)
  const [watched, setWatched] = useState({});
  const [index, setIndex] = useState(0);
  const [showData, setShowData] = useState(false);

  // Load the contract + deck from Supabase
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStage("loading");
      const { data, error } = await supabase.from("contracts").select("*").eq("id", contractId).maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError("err_offline");
        setStage("error");
        return;
      }
      if (!data) {
        setLoadError("err_not_found");
        setStage("error");
        return;
      }
      setContract(data);
      if (!data.deck || !Array.isArray(data.deck.slides) || data.deck.slides.length === 0) {
        setLoadError("err_no_deck");
        setStage("error");
        return;
      }
      setDeck(data.deck);
      setStage("welcome");
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [contractId, reloadKey]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage, index]);

  const lang = (deck && deck.default_language) || "en";
  const u = t(lang);

  function restart() {
    setChecks(EMPTY_CHECKS);
    setSignature("");
    setDemographics({});
    setAnswers({});
    setSlideMeta({});
    setWatched({});
    setIndex(0);
    setStage(deck ? "welcome" : "loading");
    if (!deck) setReloadKey((k) => k + 1);
  }

  // ── Loading / error ──
  if (stage === "loading" || stage === "error") {
    return (
      <div style={{ minHeight: "100vh", background: warmBg, fontFamily: sans, color: textPrimary, paddingBottom: TEST_BAR + 20 }}>
        <Fonts />
        {stage === "loading" ? (
          <StatusScreen message={u.loading} />
        ) : (
          <StatusScreen message={u[loadError] || u.err_offline} onRetry={loadError === "err_offline" ? () => setReloadKey((k) => k + 1) : null} retryLabel={u.retry} />
        )}
        <TestBar stage={stage} contractId={contractId} showNav={false} onRestart={restart} showData={false} setShowData={() => {}} />
      </div>
    );
  }

  // ── Loaded ──
  const slides = deck.slides;
  const demoFields = parseDemoFields(contract);
  const cfg = getConsentConfig(contract, deck, lang);
  const hasDemo = demoFields.length > 0;
  const totalSteps = 1 + (hasDemo ? 1 : 0) + slides.length;

  const slide = slides[Math.min(index, slides.length - 1)];
  const q = (slide.interactions && slide.interactions[0]) || null;
  const st = slide.settings || {};
  const needsWatch = !!slide.media && slide.media.type === "video" && !!st.require_full_playback && !watched[slide.id];
  const answered = q ? isAnswered(q, answers[q.id]) : true;
  const locked = !!q && needsWatch;

  function setAnswer(qid, value) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }
  function markMeta(slideId, patch) {
    setSlideMeta((prev) => ({ ...prev, [slideId]: { ...(prev[slideId] || {}), ...patch } }));
  }
  function next() {
    if (needsWatch) markMeta(slide.id, { full_playback: false, advanced_video_unfinished: true });
    if (q && !answered) markMeta(slide.id, { advanced_unanswered: true });
    if (index < slides.length - 1) setIndex(index + 1);
    else setStage("complete");
  }
  function prev() {
    if (index > 0) setIndex(index - 1);
    else setStage(hasDemo ? "demographics" : "consent");
  }

  const nextWarn = needsWatch || !answered;
  const nextLabel = needsWatch
    ? "Advance anyway (video not finished)"
    : !answered
      ? "Advance anyway (unanswered)"
      : index === slides.length - 1
        ? "Finish"
        : "Next";

  // Exactly what the completed-interview write will contain (private answers included here
  // because this is the FINAL record; the live session feed in step 4 strips them).
  const dataPreview = {
    contract_id: contractId,
    deck_version: contract.deck_version,
    language: lang,
    demographics,
    survey_responses: answers,
    slide_meta: slideMeta,
  };

  return (
    <div style={{ minHeight: "100vh", background: warmBg, fontFamily: sans, color: textPrimary, paddingBottom: TEST_BAR + 20 }}>
      <Fonts />

      {stage === "welcome" && <WelcomeScreen contract={contract} u={u} onContinue={() => setStage("consent")} />}

      {stage === "consent" && (
        <ConsentScreen
          contract={contract}
          u={u}
          cfg={cfg}
          demoFields={demoFields}
          checks={checks}
          setChecks={setChecks}
          signature={signature}
          setSignature={setSignature}
          onContinue={() => setStage(hasDemo ? "demographics" : "slides")}
          current={1}
          total={totalSteps}
        />
      )}

      {stage === "demographics" && (
        <DemographicsScreen
          u={u}
          demoFields={demoFields}
          demographics={demographics}
          setDemographics={setDemographics}
          onBack={() => setStage("consent")}
          onContinue={() => {
            setIndex(0);
            setStage("slides");
          }}
          current={2}
          total={totalSteps}
        />
      )}

      {stage === "slides" && (
        <>
          {deck.show_progress !== false && (
            <div style={{ padding: "16px 24px 0", maxWidth: 1100, margin: "0 auto" }}>
              <ProgressBar current={(hasDemo ? 2 : 1) + index + 1} total={totalSteps} />
              <div style={{ fontSize: 12, color: textSecondary, marginTop: 8, fontWeight: 500 }}>{u.slide_of(index + 1, slides.length)}</div>
            </div>
          )}
          <SlideView
            key={slide.id}
            slide={slide}
            q={q}
            lang={lang}
            landscape={landscape}
            answer={q ? answers[q.id] : null}
            onAnswer={setAnswer}
            locked={locked}
            watched={!!watched[slide.id]}
            onWatched={() => {
              setWatched((w) => ({ ...w, [slide.id]: true }));
              markMeta(slide.id, { full_playback: true });
            }}
          />
        </>
      )}

      {stage === "complete" &&
        (deck.show_thank_you !== false ? (
          <ThankYou contract={contract} lang={lang} retentionDays={cfg.data_retention_days} />
        ) : (
          <StatusScreen message={u.thanks_title} />
        ))}

      {showData && <DataPanel data={dataPreview} />}

      <TestBar
        stage={stage}
        contractId={contractId}
        showNav={stage === "slides"}
        canPrev={true}
        nextLabel={nextLabel}
        nextWarn={nextWarn}
        onPrev={prev}
        onNext={next}
        onRestart={restart}
        showData={showData}
        setShowData={setShowData}
      />
    </div>
  );
}
