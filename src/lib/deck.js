"use client";
import { useState, useEffect, useRef } from "react";

// ============================================================
// InsightRide — shared deck module
// File location in repo: src/lib/deck.js
//
// Used by the interviewee tablet (/interview/[contractId]) and, from
// the presenter-mode step on, by the interviewer phone (mirror card).
// Holds: design tokens, translatable interface strings, deck helpers,
// and every component that renders a slide.
// ============================================================

// The demo contract seeded by the Step 2 migration. /interview/demo maps to it.
export const DEMO_CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
export function resolveContractId(param) {
  return !param || param === "demo" ? DEMO_CONTRACT_ID : param;
}

// ── Design tokens (same family as the interviewee prototype) ──
export const tokens = {
  serif: "'Source Serif 4', Georgia, serif",
  sans: "'Outfit', sans-serif",
  accent: "#1B6B4A",
  accentLight: "#E8F5EE",
  warmBg: "#FDFBF7",
  cardBg: "#FFFFFF",
  textPrimary: "#1A1A18",
  textSecondary: "#6B6B64",
  border: "#E8E4DC",
  amber: "#B8860B",
  amberBg: "#FFF8E8",
  amberBorder: "#E8D8A8",
  amberText: "#8B7030",
};
const { serif, sans, accent, accentLight, cardBg, textPrimary, textSecondary, border, amberBg, amberBorder, amberText } = tokens;

export const FONT_LINK =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&family=Outfit:wght@300;400;500;600;700&display=swap";

export function Fonts() {
  return (
    <>
      <link href={FONT_LINK} rel="stylesheet" />
      <style>{"@keyframes irPulse { 0%,100% { opacity:1; transform:scale(1);} 50% { opacity:.35; transform:scale(.8);} }"}</style>
    </>
  );
}

// ── Interface strings. One block per language; add "de": {...} later and
//    every screen translates. Slide content lives in the deck, not here. ──
export const UI = {
  en: {
    // slides
    other: "Other (please specify)",
    prefer_not: "Prefer not to say",
    specify: "Please specify",
    type_here: "Type your answer here...",
    voice_cue: "We are recording your answer. Just speak naturally to your interviewer.",
    voice_note: "There is nothing to tap on this screen.",
    private: "Private response. Your interviewer cannot see this answer.",
    locked: "Please watch the full video before answering.",
    play: "Play",
    replay: "Watch again",
    resume: "Resume",
    finished: "Video finished",
    slide_of: (i, n) => "Slide " + i + " of " + n,
    step_of: (i, n, label) => "Step " + i + " of " + n + " — " + label,
    continue: "Continue",
    back: "Back",

    // welcome
    welcome_title: "You are invited to share your perspective",
    welcome_body: (minutes, topic) => "A short " + minutes + "-minute interview about " + topic + ".",
    welcome_comp: "compensation for your time",
    welcome_note:
      "Your participation is completely voluntary. You can stop at any time. On the next screen, we will explain exactly how your data will be used.",

    // consent
    consent_step: "Informed consent",
    consent_title: "Your consent matters",
    consent_intro: "Please read each section carefully. You must acknowledge all items and provide your first name to proceed.",
    consent_purpose_h: "Purpose of this research",
    consent_purpose: (client) =>
      "This interview is being conducted on behalf of " +
      client +
      " for the purpose of market research. Your responses will be used to understand experiences and preferences. This is not a sales interaction.",
    consent_collect_h: "What we collect",
    consent_collect_video: "Video recording of this interview.",
    consent_collect_audio: "Audio recording and a text transcript.",
    consent_collect_location: "Approximate geographic location (neighbourhood level, not your home address).",
    consent_collect_responses: "Your on-screen responses.",
    consent_collect_demo: (fields) => "Self-reported demographic information (" + fields + ").",
    consent_collect_noid: "No personally identifying information such as your name, phone number, or address will be stored or shared.",
    consent_use_h: "How your data is used",
    consent_use_aggregate: "Your responses will be combined with other participants' responses to produce an aggregate research report.",
    consent_use_shared: (client) => "The report, recordings, and transcripts will be shared with " + client + " for internal research purposes only.",
    consent_use_not_shared: "Your responses will be anonymised and used for statistical analysis only. Individual recordings will not be shared with third parties.",
    consent_use_retention: (days) => "Data will be retained for " + days + " days and then permanently deleted. You may request deletion of your data at any time by contacting us.",
    consent_rights_h: "Your rights",
    consent_rights: (payout, days) =>
      "Your participation is entirely voluntary. You may stop the interview at any time, for any reason, without penalty, and you will still receive your full $" +
      payout +
      " compensation. You may decline to answer any specific question. You may request that your recording be deleted at any time within " +
      days +
      " days of the interview.",
    consent_ack_read: "I have read and understood the information above",
    consent_ack_recording: (what) => "I consent to being " + what + " recorded during this interview",
    video_and_audio: "video and audio",
    audio_only: "audio",
    consent_ack_data: (client) => "I consent to my responses being used for research purposes by " + client,
    consent_ack_voluntary: "I understand my participation is voluntary and I can stop at any time",
    consent_ack_withdraw: (days) => "I understand I can request deletion of my data within " + days + " days",
    consent_sig_label: "Type your first name to confirm consent",
    consent_sig_placeholder: "Your first name",
    consent_sig_note: "Your first name is used only to confirm consent and is not stored with your interview data.",
    consent_cta_ready: "I consent — continue",
    consent_cta_wait: "Please complete all items above",

    // demographics
    demo_step: "About you",
    demo_title: "A few quick details",
    demo_intro: "This helps us understand who we are hearing from. Choose \"Prefer not to say\" for any question you would rather skip.",
    demo_labels: { ageRange: "Age range", gender: "Gender", ethnicity: "Ethnicity", profession: "Profession" },

    // complete
    thanks_title: "Thank you",
    thanks_body: "Your responses have been recorded. Your perspective helps shape better products and services for everyone.",
    thanks_comp: "Your compensation",
    thanks_pay: "Your interviewer will arrange your payment now.",
    rights_h: "Your data rights:",
    rights_body: (days) =>
      "To request deletion of your interview data, contact us at privacy@insightride.com within " +
      days +
      " days. No personal identifying information has been stored.",

    // status / errors
    loading: "Loading...",
    err_not_found: "This contract could not be found. Check the link and try again.",
    err_no_deck: "This contract does not have a slide deck yet. Ask the admin to add one before running interviews.",
    err_offline: "Could not reach the server. Check the tablet's connection and try again.",
    retry: "Try again",
  },
};
export function t(lang) {
  return UI[lang] || UI.en;
}

// ── Demographics: canonical stored VALUES. These match the admin/interviewer
//    lists so matching and statistics line up across the platform. Translate
//    the displayed labels later without ever changing the stored values. ──
export const DEMO_FIELDS = ["ageRange", "gender", "ethnicity", "profession"];
export const DEMO_OPTIONS = {
  ageRange: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+", "Prefer not to say"],
  gender: ["Male", "Female", "Non-binary", "Prefer not to say"],
  ethnicity: ["White", "South Asian", "East Asian", "Southeast Asian", "Black", "Middle Eastern", "Latin American", "Indigenous", "Mixed/Other", "Prefer not to say"],
  profession: ["Healthcare", "Medical", "Technology", "Finance", "Legal", "Education", "Retail / Service", "Trades / Construction", "Executive", "Student", "Retired", "Other", "Prefer not to say"],
};

// Which demographic questions the INTERVIEWEE answers on the tablet, from contracts.interviewee_demographics
export function parseDemoFields(contract) {
  let v = contract && contract.interviewee_demographics;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch (e) {
      v = [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.filter((f) => DEMO_FIELDS.includes(f));
}

// Consent configuration: optional deck.consent overrides, sensible defaults otherwise
export function getConsentConfig(contract, deck, lang) {
  const c = (deck && deck.consent) || {};
  return {
    video_recording: c.video_recording !== false,
    audio_recording: c.audio_recording !== false,
    location_data: c.location_data !== false,
    data_retention_days: typeof c.data_retention_days === "number" ? c.data_retention_days : 365,
    third_party_sharing: c.third_party_sharing !== false,
    client_name: L(c.client_name, lang) || (contract && contract.client) || "the client",
  };
}

// ── Helpers ──

// Pick the right language from a { en: "...", de: "..." } field.
export function L(field, lang) {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field[lang] || field.en || Object.values(field)[0] || "";
}

// Has this interaction been answered? Voice counts as answered: the transcript is the answer.
export function isAnswered(q, a) {
  if (!q) return true;
  if (q.type === "voice") return true;
  if (!a) return false;
  const otherText = (a.other_text || "").trim();
  if (q.type === "single_choice") return !!a.option && (a.option !== "other" || otherText.length > 0);
  if (q.type === "multi_select") {
    const list = a.options || [];
    return list.length > 0 && (!list.includes("other") || otherText.length > 0);
  }
  if (q.type === "scale") return typeof a.value === "number";
  if (q.type === "text") return (a.text || "").trim().length > 0;
  return true;
}

export function useLandscape() {
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    const check = () => setLandscape(window.innerWidth > window.innerHeight);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return landscape;
}

// Light formatting for slide body text: **bold**, blank lines, "- " bullets.
function boldify(line) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
}
export function Rich({ text, style }) {
  if (!text) return null;
  const out = [];
  let list = [];
  const flush = () => {
    if (list.length) {
      out.push(<ul key={"ul" + out.length} style={{ margin: "4px 0 10px 22px", padding: 0 }}>{list}</ul>);
      list = [];
    }
  };
  text.split("\n").forEach((line, i) => {
    if (line.startsWith("- ")) {
      list.push(<li key={i} style={{ marginBottom: 4 }}>{boldify(line.slice(2))}</li>);
    } else {
      flush();
      if (line.trim() === "") out.push(<div key={i} style={{ height: 8 }} />);
      else out.push(<p key={i} style={{ margin: "0 0 8px" }}>{boldify(line)}</p>);
    }
  });
  flush();
  return <div style={style}>{out}</div>;
}

export const inputStyle = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 10,
  border: "1.5px solid " + border,
  background: cardBg,
  fontSize: 16,
  fontFamily: sans,
  color: textPrimary,
  boxSizing: "border-box",
  outline: "none",
};

// ── Components ──

export function ProgressBar({ current, total }) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <div style={{ height: 4, background: border, borderRadius: 2, overflow: "hidden", width: "100%" }}>
      <div style={{ height: "100%", width: pct + "%", background: accent, borderRadius: 2, transition: "width 0.4s ease" }} />
    </div>
  );
}

export function OptionButton({ label, selected, onClick, multi }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        padding: "14px 16px",
        borderRadius: 10,
        border: selected ? "2px solid " + accent : "1.5px solid " + border,
        background: selected ? accentLight : cardBg,
        color: selected ? accent : textPrimary,
        fontSize: 16,
        fontWeight: selected ? 600 : 400,
        fontFamily: sans,
        cursor: "pointer",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 12,
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: multi ? 6 : "50%",
          border: selected ? "2px solid " + accent : "2px solid #C8C4BC",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          background: selected ? accent : "transparent",
        }}
      >
        {selected && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}

export function CheckRow({ label, checked, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 10,
        border: checked ? "1.5px solid " + accent : "1.5px solid " + border,
        background: checked ? accentLight : cardBg,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: sans,
        width: "100%",
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          border: checked ? "2px solid " + accent : "2px solid #C8C4BC",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          background: checked ? accent : "transparent",
          marginTop: 1,
        }}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span style={{ fontSize: 14, color: textPrimary, lineHeight: 1.45 }}>{label}</span>
    </button>
  );
}

export function ScaleInput({ scale, lang, value, onChange }) {
  const min = typeof scale.min === "number" ? scale.min : 1;
  const max = typeof scale.max === "number" ? scale.max : 5;
  const range = [];
  for (let i = min; i <= max; i++) range.push(i);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {range.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              border: value === n ? "2px solid " + accent : "1.5px solid " + border,
              background: value === n ? accent : cardBg,
              color: value === n ? "#fff" : textPrimary,
              fontSize: 20,
              fontWeight: 600,
              fontFamily: sans,
              cursor: "pointer",
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: textSecondary, padding: "0 4px" }}>
        <span>{L(scale.min_label, lang)}</span>
        <span>{L(scale.max_label, lang)}</span>
      </div>
    </div>
  );
}

export function PrivateBadge({ text }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 10,
        background: amberBg,
        border: "1.5px solid " + amberBorder,
        marginBottom: 16,
        fontSize: 13,
        color: amberText,
        fontWeight: 500,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M12 7H4V5a4 4 0 118 0v2zm1 0V5a5 5 0 00-10 0v2a1 1 0 00-1 1v5a1 1 0 001 1h10a1 1 0 001-1V8a1 1 0 00-1-1z" fill={amberText} />
      </svg>
      {text}
    </div>
  );
}

export function LockedNote({ text }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        background: amberBg,
        border: "1.5px solid " + amberBorder,
        marginBottom: 14,
        fontSize: 14,
        color: amberText,
        fontWeight: 500,
      }}
    >
      {text}
    </div>
  );
}

export function VoiceCue({ text, note }) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 18px",
          borderRadius: 12,
          background: accentLight,
          border: "1.5px solid " + accent,
          color: accent,
          fontSize: 16,
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#D0433B",
            flexShrink: 0,
            animation: "irPulse 1.4s ease-in-out infinite",
          }}
        />
        {text}
      </div>
      <div style={{ fontSize: 13, color: textSecondary, marginTop: 10 }}>{note}</div>
    </div>
  );
}

export function VideoBlock({ media, lang, landscape, requireFull, allowReplay, watched, onWatched }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const u = t(lang);

  function safePlay() {
    const v = ref.current;
    if (!v) return;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }
  function playFromStart() {
    const v = ref.current;
    if (!v) return;
    v.currentTime = 0;
    safePlay();
  }

  const showOverlay = requireFull && !playing;
  let overlayButton = null;
  if (showOverlay) {
    if (!started) overlayButton = { label: u.play, action: playFromStart };
    else if (watched) overlayButton = allowReplay ? { label: u.replay, action: playFromStart } : null;
    else overlayButton = { label: u.resume, action: safePlay };
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ position: "relative", background: "#000", borderRadius: 14, overflow: "hidden" }}>
        <video
          ref={ref}
          src={media.url}
          playsInline
          preload="auto"
          controls={!requireFull}
          style={{ width: "100%", maxHeight: landscape ? "62vh" : "42vh", display: "block", background: "#000" }}
          onPlay={() => {
            setPlaying(true);
            setStarted(true);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            onWatched();
          }}
        />
        {showOverlay && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              background: "rgba(0,0,0,0.45)",
            }}
          >
            {overlayButton && (
              <button
                onClick={overlayButton.action}
                style={{
                  padding: "16px 40px",
                  borderRadius: 12,
                  border: "none",
                  background: accent,
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: 600,
                  fontFamily: sans,
                  cursor: "pointer",
                }}
              >
                {overlayButton.label}
              </button>
            )}
            {watched && <div style={{ color: "#fff", fontSize: 14, fontFamily: sans, opacity: 0.9 }}>{u.finished}</div>}
          </div>
        )}
      </div>
      {!requireFull && watched && <div style={{ fontSize: 13, color: accent, marginTop: 8, fontWeight: 500 }}>{u.finished}</div>}
    </div>
  );
}

export function MediaBlock({ media, lang, landscape, requireFull, allowReplay, watched, onWatched }) {
  if (media.type === "image") {
    return (
      <div
        style={{
          marginBottom: 20,
          background: cardBg,
          border: "1.5px solid " + border,
          borderRadius: 14,
          overflow: "hidden",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <img
          src={media.url}
          alt={L(media.alt, lang)}
          style={{ maxWidth: "100%", maxHeight: landscape ? "62vh" : "42vh", objectFit: "contain", display: "block" }}
        />
      </div>
    );
  }
  if (media.type === "video") {
    return (
      <VideoBlock
        media={media}
        lang={lang}
        landscape={landscape}
        requireFull={requireFull}
        allowReplay={allowReplay}
        watched={watched}
        onWatched={onWatched}
      />
    );
  }
  return null;
}

export function TextBlock({ text, lang, big }) {
  const heading = L(text.heading, lang);
  const body = L(text.body, lang);
  return (
    <div style={big ? { maxWidth: 680, margin: "36px auto 20px" } : { marginBottom: 20 }}>
      {heading && (
        <h2 style={{ fontFamily: serif, fontSize: big ? 32 : 22, fontWeight: 700, lineHeight: 1.3, margin: "0 0 14px", color: textPrimary }}>
          {heading}
        </h2>
      )}
      {body && <Rich text={body} style={{ fontSize: big ? 19 : 16, lineHeight: 1.65, color: big ? textPrimary : textSecondary }} />}
    </div>
  );
}

export function ChoiceList({ q, lang, value, multi, onChange }) {
  const u = t(lang);
  const opts = [...(q.options || [])];
  if (q.allow_other) opts.push({ id: "other", label: { en: u.other } });
  if (q.allow_prefer_not) opts.push({ id: "prefer_not", label: { en: u.prefer_not } });

  const selected = (id) => (multi ? (value.options || []).includes(id) : value.option === id);

  function tap(id) {
    if (multi) {
      let list = value.options || [];
      if (id === "prefer_not") {
        list = list.includes("prefer_not") ? [] : ["prefer_not"];
      } else {
        list = list.filter((x) => x !== "prefer_not");
        list = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      }
      onChange({ options: list, other_text: list.includes("other") ? value.other_text || "" : "" });
    } else {
      onChange({ option: id, other_text: id === "other" ? value.other_text || "" : "" });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {opts.map((o) => (
        <OptionButton key={o.id} label={L(o.label, lang)} selected={selected(o.id)} multi={multi} onClick={() => tap(o.id)} />
      ))}
      {selected("other") && (
        <input
          type="text"
          value={value.other_text || ""}
          onChange={(e) => onChange({ ...value, other_text: e.target.value })}
          placeholder={u.specify}
          style={inputStyle}
        />
      )}
    </div>
  );
}

export function InteractionBlock({ q, lang, answer, onAnswer, locked }) {
  const u = t(lang);
  const a = answer || {};
  const helper = L(q.helper, lang);
  return (
    <div>
      {q.private && <PrivateBadge text={u.private} />}
      <h2 style={{ fontFamily: serif, fontSize: 23, fontWeight: 600, lineHeight: 1.4, margin: "0 0 8px", color: textPrimary }}>
        {L(q.prompt, lang)}
      </h2>
      {helper ? (
        <div style={{ fontSize: 14, color: textSecondary, marginBottom: 16, lineHeight: 1.5 }}>{helper}</div>
      ) : (
        <div style={{ height: 12 }} />
      )}
      {locked && <LockedNote text={u.locked} />}
      <div style={{ opacity: locked ? 0.45 : 1, pointerEvents: locked ? "none" : "auto" }}>
        {q.type === "single_choice" && <ChoiceList q={q} lang={lang} value={a} multi={false} onChange={(v) => onAnswer(q.id, v)} />}
        {q.type === "multi_select" && <ChoiceList q={q} lang={lang} value={a} multi onChange={(v) => onAnswer(q.id, v)} />}
        {q.type === "scale" && (
          <ScaleInput scale={q.scale || {}} lang={lang} value={a.value} onChange={(v) => onAnswer(q.id, { value: v })} />
        )}
        {q.type === "text" && (
          <textarea
            value={a.text || ""}
            onChange={(e) => onAnswer(q.id, { text: e.target.value })}
            placeholder={L(q.placeholder, lang) || u.type_here}
            rows={5}
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
          />
        )}
        {q.type === "voice" && <VoiceCue text={u.voice_cue} note={u.voice_note} />}
      </div>
    </div>
  );
}

export function SlideView({ slide, q, lang, landscape, answer, onAnswer, locked, watched, onWatched }) {
  const st = slide.settings || {};
  const split = slide.layout === "split" && landscape && slide.media;
  const mediaEl = slide.media ? (
    <MediaBlock
      media={slide.media}
      lang={lang}
      landscape={landscape}
      requireFull={!!st.require_full_playback}
      allowReplay={st.allow_replay !== false}
      watched={watched}
      onWatched={onWatched}
    />
  ) : null;
  const textEl = slide.text ? <TextBlock text={slide.text} lang={lang} big={!slide.media && !q} /> : null;
  const qEl = q ? <InteractionBlock q={q} lang={lang} answer={answer} onAnswer={onAnswer} locked={locked} /> : null;

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1100, margin: "0 auto" }}>
      {split ? (
        <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
          <div style={{ flex: "1.15 1 0", minWidth: 0 }}>{mediaEl}</div>
          <div style={{ flex: "1 1 0", minWidth: 0 }}>
            {textEl}
            {qEl}
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {mediaEl}
          {textEl}
          {qEl}
        </div>
      )}
    </div>
  );
}

export function ThankYou({ contract, lang, retentionDays }) {
  const u = t(lang);
  return (
    <div style={{ minHeight: "80vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", textAlign: "center" }}>
      <div style={{ width: 72, height: 72, borderRadius: "50%", background: accentLight, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <path d="M10 18L16 24L26 12" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 style={{ fontFamily: serif, fontSize: 28, fontWeight: 700, margin: "0 0 8px", color: textPrimary }}>{u.thanks_title}</h1>
      <p style={{ fontSize: 16, color: textSecondary, lineHeight: 1.6, maxWidth: 360, margin: "0 0 24px" }}>{u.thanks_body}</p>
      <div style={{ background: cardBg, border: "1.5px solid " + border, borderRadius: 14, padding: 20, width: "100%", maxWidth: 340, marginBottom: 24 }}>
        <div style={{ fontSize: 14, color: textSecondary, marginBottom: 4 }}>{u.thanks_comp}</div>
        <div style={{ fontSize: 36, fontWeight: 700, color: accent }}>${contract.interviewee_incentive}</div>
        <div style={{ fontSize: 13, color: textSecondary, marginTop: 8, lineHeight: 1.5 }}>{u.thanks_pay}</div>
      </div>
      <div
        style={{
          background: amberBg,
          border: "1.5px solid " + amberBorder,
          borderRadius: 10,
          padding: "14px 16px",
          width: "100%",
          maxWidth: 340,
          fontSize: 13,
          color: "#6B5820",
          lineHeight: 1.5,
          textAlign: "left",
        }}
      >
        <strong>{u.rights_h}</strong> {u.rights_body(retentionDays)}
      </div>
    </div>
  );
}
