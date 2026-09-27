"use client";
import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";

// ============================================================
// InsightRide — Interviewee Tablet
// STEP 1: slide renderer + hardcoded sample deck
//
// File location in repo: src/app/interview/[contractId]/page.js
// Test URL:              /interview/demo
//
// What this step does: renders every slide type in the sample deck
// with temporary test buttons at the bottom. Nothing is saved yet.
// Later steps add: consent + demographics in front, presenter mode
// (the interviewer's phone replaces the test buttons), camera
// recording + slide timeline, and loading real decks from Supabase.
// ============================================================

// ── Design tokens (same family as the interviewee prototype) ──
const serif = "'Source Serif 4', Georgia, serif";
const sans = "'Outfit', sans-serif";
const accent = "#1B6B4A";
const accentLight = "#E8F5EE";
const warmBg = "#FDFBF7";
const cardBg = "#FFFFFF";
const textPrimary = "#1A1A18";
const textSecondary = "#6B6B64";
const border = "#E8E4DC";
const amber = "#B8860B";
const amberBg = "#FFF8E8";
const amberBorder = "#E8D8A8";
const amberText = "#8B7030";
const FONT_LINK =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&family=Outfit:wght@300;400;500;600;700&display=swap";

// ── Interface strings. Same language-layer idea as slide text:
//    add a "de" block later and everything below translates. ──
const UI = {
  en: {
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
    thanks_title: "Thank you",
    thanks_body:
      "Your responses have been recorded. Your perspective helps shape better products and services for everyone.",
    thanks_comp: "Your compensation",
    thanks_pay: "Your interviewer will arrange your payment now.",
  },
};

// ── Sample contract (stands in for the contracts table for now) ──
const SAMPLE_CONTRACT = {
  id: "demo",
  client: "Scotiabank",
  topic: "Newcomer reactions to a bank advertisement",
  estimated_minutes: 20,
  interviewee_incentive: 60,
};

// ── Sample deck ──
// DECK SCHEMA (this is the data model every later step builds on):
//   deck.slides[]            ordered list of slides
//   slide.id / slide.title   stable id (never changes) + short label for admin, HelpBot, stats
//   slide.layout             "stack" (media above) | "split" (media left, question right in landscape)
//   slide.media              null | { type: "image"|"video", url, alt: {lang} }
//   slide.text               null | { heading: {lang}, body: {lang} }   body supports **bold**, blank lines, "- " bullets
//   slide.interactions[]     0 or 1 interaction today (array so multiple can be added later)
//   interaction.id           the question id -> key in survey_responses / extraction_schema
//   interaction.type         "single_choice" | "multi_select" | "scale" | "text" | "voice"
//   interaction.options[]    { id (stable, used for stats), label: {lang} }
//   interaction.allow_other / allow_prefer_not / private / required / scale / placeholder / helper
//   slide.settings           { require_full_playback, allow_replay, auto_blank }
//   slide.notes[]            PRIVATE interviewer probes ({lang}) — shown ONLY on the interviewer phone, never here
//   slide.rules[]            branching hook (empty for now)
//   slide.variants           randomization hook (null for now)
// Every text field is a language object { en: "..." } so translation is a new key, not a new deck.
const SAMPLE_DECK = {
  id: "demo-deck",
  version: 1,
  default_language: "en",
  show_progress: true,
  show_thank_you: true,
  client_can_view: true,
  slides: [
    {
      id: "s_intro",
      title: "Intro",
      layout: "stack",
      media: null,
      text: {
        heading: { en: "A short ad test" },
        body: {
          en:
            "We are going to show you a short advertisement and ask what you think.\n\nThere are **no right or wrong answers**. We want your honest reaction.\n\n- Some questions have buttons to tap\n- Some just ask you to speak\n- Your interviewer can move on whenever you are ready",
        },
      },
      interactions: [],
      settings: {},
      notes: [{ en: "Keep this brief. Check the tablet is angled so they can see it comfortably before playing the ad." }],
      rules: [],
      variants: null,
    },
    {
      id: "s_ad",
      title: "The ad",
      layout: "stack",
      media: {
        type: "video",
        url: "https://www.w3schools.com/html/mov_bbb.mp4",
        alt: { en: "Bank advertisement (placeholder test clip)" },
      },
      text: {
        heading: { en: "Please watch this ad" },
        body: { en: "It is short. The tablet will tell you when it has finished." },
      },
      interactions: [],
      settings: { require_full_playback: true, allow_replay: true },
      notes: [{ en: "Do not talk during the ad. Watch their face and note any visible reaction and when it happened." }],
      rules: [],
      variants: null,
    },
    {
      id: "s_recall",
      title: "Ad recall",
      layout: "stack",
      media: null,
      text: null,
      interactions: [
        {
          id: "q_recall",
          type: "voice",
          prompt: { en: "In your own words, what was that ad about?" },
          required: true,
        },
      ],
      settings: { auto_blank: true },
      notes: [{ en: "Let them finish before probing. Probes: What stood out most? Who do you think it was made for?" }],
      rules: [],
      variants: null,
    },
    {
      id: "s_trust",
      title: "Trust",
      layout: "stack",
      media: null,
      text: null,
      interactions: [
        {
          id: "q_trust",
          type: "scale",
          prompt: { en: "How much did this ad make you trust the bank?" },
          scale: { min: 1, max: 5, min_label: { en: "Not at all" }, max_label: { en: "A great deal" } },
          required: true,
        },
      ],
      settings: {},
      notes: [{ en: "If they pick 1 or 2, ask what specifically lowered their trust." }],
      rules: [],
      variants: null,
    },
    {
      id: "s_feel",
      title: "Feeling",
      layout: "split",
      media: {
        type: "image",
        url: "https://picsum.photos/seed/insightride-ad/1200/800",
        alt: { en: "A still image from the ad (placeholder)" },
      },
      text: null,
      interactions: [
        {
          id: "q_feel",
          type: "single_choice",
          prompt: { en: "Which of these words best describes how the ad made you feel?" },
          options: [
            { id: "reassured", label: { en: "Reassured" } },
            { id: "curious", label: { en: "Curious" } },
            { id: "skeptical", label: { en: "Skeptical" } },
            { id: "indifferent", label: { en: "Indifferent" } },
          ],
          allow_other: true,
          allow_prefer_not: true,
          required: true,
        },
      ],
      settings: {},
      notes: [{ en: "Ask what in the ad produced that feeling: a face, a line, the music?" }],
      rules: [],
      variants: null,
    },
    {
      id: "s_barriers",
      title: "Barriers",
      layout: "stack",
      media: null,
      text: null,
      interactions: [
        {
          id: "q_barriers",
          type: "multi_select",
          prompt: { en: "What, if anything, would stop you from opening an account with this bank?" },
          helper: { en: "Select all that apply." },
          options: [
            { id: "fees", label: { en: "Monthly fees" } },
            { id: "credit_history", label: { en: "Needing a Canadian credit history" } },
            { id: "language", label: { en: "Language barriers" } },
            { id: "trust", label: { en: "I do not trust banks yet" } },
            { id: "nothing", label: { en: "Nothing would stop me" } },
          ],
          allow_other: true,
          allow_prefer_not: false,
          required: true,
        },
      ],
      settings: {},
      notes: [{ en: "For each barrier they tap, ask for a real example from their own experience." }],
      rules: [],
      variants: null,
    },
    {
      id: "s_appscreen",
      title: "App screen",
      layout: "split",
      media: {
        type: "image",
        url: "https://picsum.photos/seed/insightride-app/900/1200",
        alt: { en: "A screen from the mobile banking app (placeholder)" },
      },
      text: null,
      interactions: [
        {
          id: "q_appscreen",
          type: "voice",
          prompt: { en: "Talk me through what you notice on this screen." },
          required: true,
        },
      ],
      settings: { auto_blank: false },
      notes: [{ en: "Silence is fine. Let them look. Probes: What would you tap first? Is anything confusing?" }],
      rules: [],
      variants: null,
    },
    {
      id: "s_private",
      title: "Private message",
      layout: "stack",
      media: null,
      text: null,
      interactions: [
        {
          id: "q_private",
          type: "text",
          prompt: { en: "Is there anything you would say to the bank that you would rather not say out loud?" },
          placeholder: { en: "Type here. Your interviewer cannot see this." },
          private: true,
          required: true,
        },
      ],
      settings: {},
      notes: [{ en: "Turn away while they type. You will not see this answer." }],
      rules: [],
      variants: null,
    },
  ],
};

// ── Helpers ──

// Pick the right language from a { en: "...", de: "..." } field.
function L(field, lang) {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field[lang] || field.en || Object.values(field)[0] || "";
}

// Has this interaction been answered? (voice counts as answered: the transcript is the answer)
function isAnswered(q, a) {
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

function useLandscape() {
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
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p
  );
}
function Rich({ text, style }) {
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

const inputStyle = {
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

// ── Small components ──

function Fonts() {
  return (
    <>
      <link href={FONT_LINK} rel="stylesheet" />
      <style>{"@keyframes irPulse { 0%,100% { opacity:1; transform:scale(1);} 50% { opacity:.35; transform:scale(.8);} }"}</style>
    </>
  );
}

function ProgressBar({ current, total }) {
  const pct = (current / total) * 100;
  return (
    <div style={{ height: 4, background: border, borderRadius: 2, overflow: "hidden", width: "100%" }}>
      <div style={{ height: "100%", width: pct + "%", background: accent, borderRadius: 2, transition: "width 0.4s ease" }} />
    </div>
  );
}

function OptionButton({ label, selected, onClick, multi }) {
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

function ScaleInput({ scale, lang, value, onChange }) {
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

function PrivateBadge({ text }) {
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

function LockedNote({ text }) {
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

function VoiceCue({ text, note }) {
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

function VideoBlock({ media, lang, landscape, requireFull, allowReplay, watched, onWatched }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const u = UI[lang] || UI.en;

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
      {!requireFull && watched && (
        <div style={{ fontSize: 13, color: accent, marginTop: 8, fontWeight: 500 }}>{u.finished}</div>
      )}
    </div>
  );
}

function MediaBlock({ media, lang, landscape, requireFull, allowReplay, watched, onWatched }) {
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

function TextBlock({ text, lang, big }) {
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

function ChoiceList({ q, lang, value, multi, onChange }) {
  const u = UI[lang] || UI.en;
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

function InteractionBlock({ q, lang, answer, onAnswer, locked }) {
  const u = UI[lang] || UI.en;
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

function SlideView({ slide, q, lang, landscape, answer, onAnswer, locked, watched, onWatched }) {
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

function ThankYou({ contract, lang }) {
  const u = UI[lang] || UI.en;
  return (
    <div style={{ minHeight: "80vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", textAlign: "center" }}>
      <div style={{ width: 72, height: 72, borderRadius: "50%", background: accentLight, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <path d="M10 18L16 24L26 12" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 style={{ fontFamily: serif, fontSize: 28, fontWeight: 700, margin: "0 0 8px", color: textPrimary }}>{u.thanks_title}</h1>
      <p style={{ fontSize: 16, color: textSecondary, lineHeight: 1.6, maxWidth: 360, margin: "0 0 24px" }}>{u.thanks_body}</p>
      <div style={{ background: cardBg, border: "1.5px solid " + border, borderRadius: 14, padding: 20, width: "100%", maxWidth: 340 }}>
        <div style={{ fontSize: 14, color: textSecondary, marginBottom: 4 }}>{u.thanks_comp}</div>
        <div style={{ fontSize: 36, fontWeight: 700, color: accent }}>${contract.interviewee_incentive}</div>
        <div style={{ fontSize: 13, color: textSecondary, marginTop: 8, lineHeight: 1.5 }}>{u.thanks_pay}</div>
      </div>
    </div>
  );
}

// Temporary bottom bar. Dark/gold on purpose so it is obviously NOT interviewee UI.
// Replaced by the interviewer phone in the presenter-mode step.
function TestBar({ contractId, canPrev, done, nextLabel, nextWarn, onPrev, onNext, onRestart }) {
  const btn = (extra) => ({
    padding: "12px 18px",
    borderRadius: 10,
    border: "none",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: sans,
    cursor: "pointer",
    whiteSpace: "nowrap",
    ...extra,
  });
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        padding: "10px 16px 14px",
        background: "#1A1A18",
        borderTop: "1px solid #3A3A38",
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex: 20,
      }}
    >
      <div style={{ color: "#888880", fontSize: 11, fontFamily: sans, lineHeight: 1.35, flex: 1, minWidth: 0 }}>
        <div style={{ color: "#D4A017", fontWeight: 600 }}>Step 1 test controls</div>
        <div>Contract: {contractId}. These buttons will be replaced by the interviewer phone.</div>
      </div>
      <button onClick={onRestart} style={btn({ background: "#2A2A28", color: "#A8A8A4" })}>
        Restart
      </button>
      <button onClick={onPrev} disabled={!canPrev} style={btn({ background: canPrev ? "#3A3A38" : "#222220", color: canPrev ? "#E8E8E4" : "#555" })}>
        Back
      </button>
      {!done && (
        <button onClick={onNext} style={btn({ background: nextWarn ? amber : accent, color: "#fff" })}>
          {nextLabel}
        </button>
      )}
    </div>
  );
}

// ── Main page ──
export default function IntervieweeTablet() {
  const params = useParams();
  const contractId = (params && params.contractId) || "demo";
  const contract = SAMPLE_CONTRACT; // later: loaded from Supabase by contractId
  const deck = SAMPLE_DECK; // later: contract.deck from Supabase
  const lang = deck.default_language || "en";
  const u = UI[lang] || UI.en;
  const slides = deck.slides;
  const landscape = useLandscape();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({}); // questionId -> answer object (survey_responses shape)
  const [watched, setWatched] = useState({}); // slideId -> true once a video played to the end
  const [done, setDone] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [index, done]);

  const slide = slides[index];
  const q = (slide.interactions && slide.interactions[0]) || null;
  const st = slide.settings || {};
  const needsWatch = slide.media && slide.media.type === "video" && !!st.require_full_playback && !watched[slide.id];
  const answered = q ? isAnswered(q, answers[q.id]) : true;
  const locked = !!q && needsWatch;

  function setAnswer(qid, value) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }
  function next() {
    if (index < slides.length - 1) setIndex(index + 1);
    else setDone(true);
  }
  function prev() {
    if (done) setDone(false);
    else if (index > 0) setIndex(index - 1);
  }
  function restart() {
    setIndex(0);
    setAnswers({});
    setWatched({});
    setDone(false);
  }

  const nextWarn = needsWatch || !answered;
  const nextLabel = needsWatch
    ? "Advance anyway (video not finished)"
    : !answered
      ? "Advance anyway (unanswered)"
      : index === slides.length - 1
        ? "Finish"
        : "Next";

  return (
    <div style={{ minHeight: "100vh", background: warmBg, fontFamily: sans, color: textPrimary, paddingBottom: 110 }}>
      <Fonts />
      {done ? (
        deck.show_thank_you ? (
          <ThankYou contract={contract} lang={lang} />
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: textSecondary }}>End of deck</div>
        )
      ) : (
        <>
          {deck.show_progress && (
            <div style={{ padding: "16px 24px 0", maxWidth: 1100, margin: "0 auto" }}>
              <ProgressBar current={index + 1} total={slides.length} />
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
            onWatched={() => setWatched((w) => ({ ...w, [slide.id]: true }))}
          />
        </>
      )}
      <TestBar
        contractId={contractId}
        canPrev={done || index > 0}
        done={done}
        nextLabel={nextLabel}
        nextWarn={nextWarn}
        onPrev={prev}
        onNext={next}
        onRestart={restart}
      />
    </div>
  );
}
