"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { useTheme, sans, mono, FONT_LINK } from "../../theme";
import { Fonts, SlideView, L, tokens } from "../../../../lib/deck";

// ============================================================
// InsightRide — Client portal: the slides shown to interviewees
// File location in repo: src/app/portal/[contractId]/deck/page.js
// Open at: /portal/<contractId>/deck
//
// Read-only. Each slide is rendered inside a tablet-style frame exactly as the
// interviewee saw it (answer buttons are inert, videos play). Data comes from
// GET /api/portal/deck, which strips private interviewer notes and respects
// the admin's "Client may view this deck" toggle.
// ============================================================

const TYPE_LABEL = {
  single_choice: "Multiple choice — pick one",
  multi_select: "Multiple choice — pick several",
  scale: "Rating scale",
  text: "Typed answer",
  voice: "Spoken answer",
};
const LANG_NAMES = { en: "English", fr: "Français", de: "Deutsch", es: "Español", pt: "Português", it: "Italiano", nl: "Nederlands", pl: "Polski", hi: "हिन्दी", pa: "ਪੰਜਾਬੀ", ur: "اردو", ar: "العربية", zh: "中文", ko: "한국어", ja: "日本語", tl: "Tagalog", ta: "தமிழ்", gu: "ગુજરાતી", vi: "Tiếng Việt", uk: "Українська", ru: "Русский" };

function SlidesIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 16v4M8 20h8M7 8h6M7 11h10" />
    </svg>
  );
}

function slideKind(s) {
  const q = s.interactions && s.interactions[0];
  if (q) return TYPE_LABEL[q.type] || "Question";
  if (s.media && s.media.type === "video") return "Video";
  if (s.media && s.media.type === "image") return "Image";
  return "Information";
}

export default function ClientDeckPage() {
  const { contractId } = useParams();
  const [T] = useTheme();
  const [state, setState] = useState("loading"); // loading | ok | none | hidden | denied | error
  const [data, setData] = useState(null);
  const [lang, setLang] = useState("en");
  const [landscape, setLandscape] = useState(true);

  useEffect(() => {
    const check = () => setLandscape(window.innerWidth >= 760);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const session = s && s.session;
      if (!session) {
        window.location.href = "/login";
        return;
      }
      try {
        const r = await fetch("/api/portal/deck?contractId=" + encodeURIComponent(contractId), { headers: { Authorization: "Bearer " + session.access_token } });
        const j = await r.json().catch(() => ({}));
        if (r.status === 403) return setState("denied");
        if (!r.ok || !j.ok) return setState("error");
        if (!j.has_deck) return setState("none");
        if (!j.visible || !j.deck) return setState("hidden");
        setData(j);
        setLang(j.default_language || "en");
        setState("ok");
      } catch (e) {
        setState("error");
      }
    })();
  }, [contractId]);

  const shell = (children) => (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: sans, paddingBottom: "60px" }}>
      <link href={FONT_LINK} rel="stylesheet" />
      <Fonts />
      <style>{".ir-preview { pointer-events: none; } .ir-preview video, .ir-preview .ir-allow { pointer-events: auto; }"}</style>
      <div style={{ background: T.ink, padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, letterSpacing: "-0.02em", fontSize: "19px", color: "#EEF1EC" }}>InsightRide</div>
        <a href={`/portal/${contractId}`} style={{ fontSize: "13px", color: "#B9C6BB", textDecoration: "none" }}>
          ← Back to contract
        </a>
      </div>
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>{children}</div>
    </div>
  );
  const message = (title, body) =>
    shell(
      <div style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "14px", padding: "34px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
          <SlidesIcon size={30} color={T.pine} />
        </div>
        <div style={{ fontSize: "17px", fontWeight: 700, color: T.text, marginBottom: "8px" }}>{title}</div>
        <div style={{ fontSize: "14px", color: T.faint, lineHeight: "1.7", maxWidth: "440px", margin: "0 auto" }}>{body}</div>
      </div>
    );

  if (state === "loading") return shell(<div style={{ color: T.faint, fontSize: "14px" }}>Loading the slides…</div>);
  if (state === "denied") return message("Contract not available", "This contract isn't assigned to your account.");
  if (state === "none") return message("No slides for this contract", "These interviews were run as a conversation without on-screen slides.");
  if (state === "hidden") return message("Slides not shared", "The slides for this contract are not available in your portal. Contact InsightRide if you need a copy.");
  if (state === "error") return message("Couldn't load the slides", "Please refresh the page. If this keeps happening, contact InsightRide support.");

  const deck = data.deck;
  const slides = deck.slides || [];
  const qCount = slides.filter((s) => s.interactions && s.interactions[0]).length;

  return shell(
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
        <SlidesIcon size={22} color={T.pine} />
        <span style={{ fontSize: "19px", fontWeight: 700, letterSpacing: "-0.01em", color: T.text }}>Slides shown to interviewees</span>
      </div>
      <p style={{ fontSize: "13px", color: T.faint, margin: "0 0 4px", fontWeight: 500 }}>{data.topic}</p>
      <p style={{ fontSize: "13px", color: T.faint, margin: "0 0 18px", lineHeight: "1.6" }}>
        Every interviewee saw these {slides.length} screens on the tablet, in this order, after the consent form and a few demographic questions. {qCount} of them ask a question. Spoken answers are taken from the recording of the moment that slide was on screen.
        {data.updated_at ? " Version " + data.deck_version + ", last updated " + new Date(data.updated_at).toLocaleDateString() + "." : ""}
      </p>

      {deck.languages && deck.languages.length > 1 && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "22px" }}>
          <span style={{ fontFamily: mono, fontSize: "10px", color: T.faint, letterSpacing: "0.1em" }}>LANGUAGE</span>
          {deck.languages.map((l) => (
            <button key={l} onClick={() => setLang(l)} style={{ padding: "7px 14px", borderRadius: "20px", border: lang === l ? `2px solid ${T.pine}` : `1.5px solid ${T.line}`, background: lang === l ? T.pineSoft : T.card, color: lang === l ? T.pine : T.faint, fontSize: "12.5px", fontWeight: lang === l ? 600 : 400, cursor: "pointer", fontFamily: sans }}>
              {LANG_NAMES[l] || l.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {slides.map((s, i) => {
        const q = s.interactions && s.interactions[0];
        const preview = { ...s, settings: { ...(s.settings || {}), require_full_playback: false } };
        const flags = [];
        if (s.settings && s.settings.require_full_playback) flags.push("Had to watch the whole video before answering");
        if (q && q.private) flags.push("Private: the interviewer could not see this answer");
        if (q && q.allow_other) flags.push("Included “Other (please specify)”");
        if (q && q.allow_prefer_not) flags.push("Included “Prefer not to say”");
        return (
          <div key={s.id} style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "14px", padding: "18px", marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: "10px", color: T.pine, letterSpacing: "0.1em", marginBottom: "4px" }}>
                  SLIDE {i + 1} OF {slides.length}
                  {s.title ? " · " + String(L(s.title, lang) || s.title).toUpperCase() : ""}
                </div>
                <div style={{ fontSize: "13px", color: T.faint }}>{slideKind(s)}</div>
              </div>
              {q && q.type !== "voice" && q.type !== "text" && (
                <a href={`/portal/${contractId}/stats?field=${encodeURIComponent(q.id)}`} style={{ fontSize: "12.5px", color: T.pine, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                  See the answers →
                </a>
              )}
              {q && (q.type === "voice" || q.type === "text") && (
                <a href={`/portal/${contractId}/chat`} style={{ fontSize: "12.5px", color: T.pine, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                  Ask the HelpBot about the answers →
                </a>
              )}
            </div>
            <div className="ir-preview" style={{ background: tokens.warmBg, border: `1px solid ${T.line}`, borderRadius: "12px", overflow: "hidden" }}>
              <SlideView slide={preview} q={q || null} lang={lang} landscape={landscape} answer={null} onAnswer={() => {}} locked={false} watched={false} onWatched={() => {}} />
            </div>
            {flags.length > 0 && <div style={{ fontSize: "12px", color: T.faint, marginTop: "10px", lineHeight: "1.6" }}>{flags.join(" · ")}</div>}
          </div>
        );
      })}
    </>
  );
}
