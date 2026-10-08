"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import {
  tokens,
  Fonts,
  t,
  isAnswered,
  useLandscape,
  resolveContractId,
  parseDemoFields,
  getConsentConfig,
  ProgressBar,
  SlideView,
  ThankYou,
  WelcomeScreen,
  ConsentScreen,
  DemographicsScreen,
  StatusScreen,
  EMPTY_CHECKS,
  slideOf,
} from "../../../lib/deck";

// ============================================================
// InsightRide — Interviewee Tablet PREVIEW (standalone, no phone needed)
// File location in repo: src/app/interview/[contractId]/page.js
// Test URL:              /interview/demo
//
// Runs a contract's deck end to end with a local test bar and a data
// inspector. This is the admin "preview mode" and the quickest way to
// check a deck. The real kiosk (paired with the interviewer phone) is /interview.
// ============================================================

const { sans, warmBg, textPrimary, textSecondary, accent, amber } = tokens;
const TEST_BAR = 72;

function TestBar({ stage, contractId, showNav, nextLabel, nextWarn, onPrev, onNext, onRestart, showData, setShowData }) {
  const btn = (extra) => ({ padding: "12px 16px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, fontFamily: sans, cursor: "pointer", whiteSpace: "nowrap", ...extra });
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: TEST_BAR, boxSizing: "border-box", padding: "0 16px", background: "#1A1A18", borderTop: "1px solid #3A3A38", display: "flex", alignItems: "center", gap: 10, zIndex: 20 }}>
      <div style={{ color: "#888880", fontSize: 11, fontFamily: sans, lineHeight: 1.35, flex: 1, minWidth: 0 }}>
        <div style={{ color: "#D4A017", fontWeight: 600 }}>Preview mode</div>
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
          <button onClick={onPrev} style={btn({ background: "#3A3A38", color: "#E8E8E4" })}>
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

export default function IntervieweePreview() {
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
  const [answers, setAnswers] = useState({});
  const [slideMeta, setSlideMeta] = useState({});
  const [watched, setWatched] = useState({});
  const [index, setIndex] = useState(0);
  const [showData, setShowData] = useState(false);

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

  if (stage === "loading" || stage === "error") {
    return (
      <div style={{ minHeight: "100vh", background: warmBg, fontFamily: sans, color: textPrimary, paddingBottom: TEST_BAR + 20 }}>
        <Fonts />
        {stage === "loading" ? <StatusScreen message={u.loading} /> : <StatusScreen message={u[loadError] || u.err_offline} onRetry={loadError === "err_offline" ? () => setReloadKey((k) => k + 1) : null} retryLabel={u.retry} />}
        <TestBar stage={stage} contractId={contractId} showNav={false} onRestart={restart} showData={false} setShowData={() => {}} />
      </div>
    );
  }

  const slides = deck.slides;
  const demoFields = parseDemoFields(contract);
  const cfg = getConsentConfig(contract, deck, lang);
  const hasDemo = demoFields.length > 0;
  const totalSteps = 1 + (hasDemo ? 1 : 0) + slides.length;

  const slide = slides[Math.min(index, slides.length - 1)];
  const q = slideOf(slide);
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
  const nextLabel = needsWatch ? "Advance anyway (video not finished)" : !answered ? "Advance anyway (unanswered)" : index === slides.length - 1 ? "Finish" : "Next";

  const dataPreview = { contract_id: contractId, deck_version: contract.deck_version, language: lang, demographics, survey_responses: answers, slide_meta: slideMeta };

  return (
    <div style={{ minHeight: "100vh", background: warmBg, fontFamily: sans, color: textPrimary, paddingBottom: TEST_BAR + 20 }}>
      <Fonts />

      {stage === "welcome" && <WelcomeScreen contract={contract} u={u} onContinue={() => setStage("consent")} />}

      {stage === "consent" && (
        <ConsentScreen contract={contract} u={u} cfg={cfg} demoFields={demoFields} checks={checks} setChecks={setChecks} signature={signature} setSignature={setSignature} onContinue={() => setStage(hasDemo ? "demographics" : "slides")} current={1} total={totalSteps} bottomOffset={TEST_BAR} />
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
          bottomOffset={TEST_BAR}
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

      {stage === "complete" && (deck.show_thank_you !== false ? <ThankYou contract={contract} lang={lang} retentionDays={cfg.data_retention_days} /> : <StatusScreen message={u.thanks_title} />)}

      {showData && <DataPanel data={dataPreview} />}

      <TestBar stage={stage} contractId={contractId} showNav={stage === "slides"} nextLabel={nextLabel} nextWarn={nextWarn} onPrev={prev} onNext={next} onRestart={restart} showData={showData} setShowData={setShowData} />
    </div>
  );
}
