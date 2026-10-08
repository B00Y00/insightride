"use client";
import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

// ============================================================
// InsightRide — Admin: Deck builder
// File location in repo: src/app/admin/decks/[contractId]/page.js
// Open at: /admin/decks/<contractId>  (admin sign-in required)
//
// Edits contracts.deck (the JSON the tablet runs). Save bumps deck_version and
// writes contracts.regions = union of every language's regions.
// Media uploads go to the public "deck-media" bucket: images are compressed in
// the browser (max 1600 px, JPEG); videos must be under 2 min and 50 MB.
// Translate adds a language layer via /api/deck/translate (IDs never change).
// Preview = the standalone tablet page /interview/<contractId> (shows the SAVED deck).
// ============================================================

const F = "'DM Sans', sans-serif";
const C = { bg: "#0E0E0C", card: "#1A1A18", card2: "#222220", border: "#2A2A28", gold: "#D4A017", text: "#E8E8E4", muted: "#888880", soft: "#A8A8A4", green: "#6EC4A7", red: "#E06050", amber: "#D4A76A", blue: "#7BAED4" };
const CHOICE = ["single_choice", "multi_select"];
const Q_TYPES = [
  ["", "No question (passive slide)"],
  ["single_choice", "Multiple choice (pick one)"],
  ["multi_select", "Multiple choice (pick many)"],
  ["scale", "Scale (1 to 5, 0 to 10...)"],
  ["text", "Typed answer"],
  ["voice", "Voice prompt (spoken answer)"],
];
const MAX_VIDEO_SECONDS = 120;
const MAX_BYTES = 50 * 1024 * 1024;

// ── helpers ──
function isLangObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}
function nextId(prefix, ids) {
  let n = 0;
  (ids || []).forEach((id) => {
    const m = new RegExp("^" + prefix + "_(\\d+)$").exec(String(id || ""));
    if (m) n = Math.max(n, parseInt(m[1], 10));
  });
  return prefix + "_" + (n + 1);
}
function defaultConsent() {
  return { video_recording: true, audio_recording: true, location_data: true, data_retention_days: 365, third_party_sharing: true, client_name: {} };
}
function emptyDeck() {
  return {
    default_language: "en",
    languages: { en: [] },
    show_progress: true,
    show_thank_you: true,
    client_can_view: true,
    consent: defaultConsent(),
    slides: [{ id: "s_1", title: "Welcome", layout: "stack", media: null, text: { heading: { en: "Welcome" }, body: { en: "" } }, interactions: [], settings: {}, notes: [], rules: [], variants: null }],
  };
}
function normalizeDeck(d) {
  const deck = JSON.parse(JSON.stringify(d || emptyDeck()));
  deck.default_language = deck.default_language || "en";
  deck.languages = isLangObj(deck.languages) ? deck.languages : {};
  if (!Array.isArray(deck.languages[deck.default_language])) deck.languages = { [deck.default_language]: [], ...deck.languages };
  if (deck.show_progress === undefined) deck.show_progress = true;
  if (deck.show_thank_you === undefined) deck.show_thank_you = true;
  if (deck.client_can_view === undefined) deck.client_can_view = true;
  deck.consent = { ...defaultConsent(), ...(deck.consent || {}) };
  deck.slides = (deck.slides || []).map((s) => ({ settings: {}, notes: [], rules: [], variants: null, interactions: [], layout: "stack", ...s }));
  return deck;
}
function unionRegions(deck) {
  const seen = new Map();
  Object.values(deck.languages || {}).forEach((list) => (Array.isArray(list) ? list : []).forEach((r) => {
    const t = String(r || "").trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }));
  return Array.from(seen.values());
}
function parseList(s) {
  return String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
}
function validate(deck) {
  const errs = [];
  const dl = deck.default_language;
  const G = (f) => (isLangObj(f) ? String(f[dl] || "").trim() : String(f || "").trim());
  if (!deck.slides.length) errs.push("Add at least one slide.");
  const sids = new Set();
  const qids = new Set();
  deck.slides.forEach((s, i) => {
    const n = "Slide " + (i + 1) + (s.title ? " (" + s.title + ")" : "");
    if (!s.id) errs.push(n + ": missing id.");
    if (sids.has(s.id)) errs.push(n + ": duplicate slide id " + s.id + ".");
    sids.add(s.id);
    if (s.media && !String(s.media.url || "").trim()) errs.push(n + ": " + s.media.type + " has no file. Upload one or remove the media.");
    if ((s.interactions || []).length > 1) errs.push(n + ": only one question per slide is supported right now.");
    const q = s.interactions && s.interactions[0];
    if (q) {
      if (!q.id) errs.push(n + ": question has no id.");
      if (qids.has(q.id)) errs.push(n + ": duplicate question id " + q.id + ".");
      qids.add(q.id);
      if (!G(q.prompt)) errs.push(n + ": the question text is empty in " + dl.toUpperCase() + ".");
      if (CHOICE.includes(q.type)) {
        const opts = q.options || [];
        if (opts.length < 2) errs.push(n + ": add at least two answer options.");
        const oids = new Set();
        opts.forEach((o, k) => {
          if (!G(o.label)) errs.push(n + ": option " + (k + 1) + " has no text in " + dl.toUpperCase() + ".");
          if (oids.has(o.id)) errs.push(n + ": duplicate option id " + o.id + ".");
          oids.add(o.id);
        });
      }
      if (q.type === "scale") {
        const sc = q.scale || {};
        if (!(Number(sc.max) > Number(sc.min))) errs.push(n + ": scale maximum must be greater than the minimum.");
        if (Number(sc.max) - Number(sc.min) > 11) errs.push(n + ": scale has too many points (max 12).");
      }
    }
    if (!s.media && !s.text && !q) errs.push(n + ": this slide is empty.");
  });
  return errs;
}
function compressImage(file, maxW, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, (maxW || 1600) / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob(
        (b) => {
          URL.revokeObjectURL(url);
          if (b && b.size < file.size) resolve({ blob: b, ext: "jpg", type: "image/jpeg" });
          else resolve({ blob: file, ext: (file.name.split(".").pop() || "jpg").toLowerCase(), type: file.type });
        },
        "image/jpeg",
        quality || 0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ blob: file, ext: (file.name.split(".").pop() || "jpg").toLowerCase(), type: file.type });
    };
    img.src = url;
  });
}
function videoDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => {
      const d = v.duration;
      URL.revokeObjectURL(url);
      resolve(isFinite(d) ? d : 0);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    v.src = url;
  });
}

// ── tiny UI kit ──
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid " + C.border, background: "#141412", color: C.text, fontSize: 13, fontFamily: F, boxSizing: "border-box", outline: "none" };
function Label({ children, hint }) {
  return (
    <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", margin: "12px 0 5px" }}>
      {children}
      {hint && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 8, color: "#6A6A64" }}>{hint}</span>}
    </div>
  );
}
function Input({ value, onChange, placeholder, type, style }) {
  return <input type={type || "text"} value={value == null ? "" : value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...inputStyle, ...(style || {}) }} />;
}
function TextArea({ value, onChange, placeholder, rows }) {
  return <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows || 4} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />;
}
function Select({ value, onChange, options }) {
  return (
    <select value={value == null ? "" : value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
function Toggle({ on, onChange, label }) {
  return (
    <button onClick={() => onChange(!on)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid " + C.border, background: on ? "#1A2A20" : "#141412", color: on ? C.green : C.soft, fontSize: 13, fontFamily: F, cursor: "pointer", marginRight: 8, marginBottom: 8 }}>
      <span style={{ width: 30, height: 16, borderRadius: 8, background: on ? C.green : "#3A3A38", position: "relative", flexShrink: 0 }}>
        <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 12, height: 12, borderRadius: "50%", background: "#0E0E0C", transition: "left 0.15s" }} />
      </span>
      {label}
    </button>
  );
}
const btn = (extra) => ({ padding: "9px 13px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, fontFamily: F, cursor: "pointer", whiteSpace: "nowrap", ...extra });
function Section({ title, children, right }) {
  return (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

// ── main ──
export default function DeckBuilder() {
  const params = useParams();
  const contractId = params && params.contractId;
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState(null);
  const [contract, setContract] = useState(null);
  const [deck, setDeck] = useState(null);
  const [lang, setLang] = useState("en");
  const [sel, setSel] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState("");
  const [translating, setTranslating] = useState(false);
  const [newLang, setNewLang] = useState({ code: "", name: "", regions: "" });
  const [showSettings, setShowSettings] = useState(false);
  const fileRef = useRef(null);

  // Admin gate + load
  useEffect(() => {
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
      setToken(session.access_token);
      const { data: c } = await supabase.from("contracts").select("*").eq("id", contractId).maybeSingle();
      if (!c) {
        setMsg("Contract not found.");
        setReady(true);
        return;
      }
      const d = normalizeDeck(c.deck && Array.isArray(c.deck.slides) && c.deck.slides.length ? c.deck : emptyDeck());
      setContract(c);
      setDeck(d);
      setLang(d.default_language);
      setReady(true);
    })();
  }, [contractId]);

  useEffect(() => {
    const h = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ── mutation helpers ──
  function mutate(fn) {
    setDeck((d) => fn(JSON.parse(JSON.stringify(d))));
    setDirty(true);
    setMsg("");
  }
  const slides = deck ? deck.slides : [];
  const safeSel = Math.min(sel, Math.max(0, slides.length - 1));
  const slide = slides[safeSel] || null;
  const q = (slide && slide.interactions && slide.interactions[0]) || null;
  const G = (f) => (isLangObj(f) ? f[lang] || "" : f || "");
  const setLangField = (f, v) => ({ ...(isLangObj(f) ? f : {}), [lang]: v });

  function patchSlide(patch) {
    mutate((d) => {
      d.slides[safeSel] = { ...d.slides[safeSel], ...patch };
      return d;
    });
  }
  function patchQ(patch) {
    mutate((d) => {
      const s = d.slides[safeSel];
      s.interactions = [{ ...(s.interactions[0] || {}), ...patch }];
      return d;
    });
  }
  function newQuestion(d, type) {
    const ids = [];
    d.slides.forEach((s) => (s.interactions || []).forEach((x) => ids.push(x.id)));
    const base = { id: nextId("q", ids), type, prompt: { [lang]: "" }, helper: {}, required: true, private: false };
    if (CHOICE.includes(type)) {
      base.options = [
        { id: "o_1", label: { [lang]: "" } },
        { id: "o_2", label: { [lang]: "" } },
      ];
      base.allow_other = false;
      base.allow_prefer_not = false;
    }
    if (type === "scale") base.scale = { min: 1, max: 5, min_label: {}, max_label: {} };
    if (type === "text") base.placeholder = {};
    return base;
  }
  function setQType(type) {
    mutate((d) => {
      const s = d.slides[safeSel];
      if (!type) {
        s.interactions = [];
        return d;
      }
      const cur = s.interactions[0];
      if (!cur) {
        s.interactions = [newQuestion(d, type)];
        return d;
      }
      const nq = { ...cur, type };
      if (CHOICE.includes(type) && !Array.isArray(nq.options)) {
        nq.options = [
          { id: "o_1", label: { [lang]: "" } },
          { id: "o_2", label: { [lang]: "" } },
        ];
        nq.allow_other = false;
        nq.allow_prefer_not = false;
      }
      if (type === "scale" && !nq.scale) nq.scale = { min: 1, max: 5, min_label: {}, max_label: {} };
      s.interactions = [nq];
      return d;
    });
  }
  function addSlide(kind) {
    let at = 0;
    mutate((d) => {
      const s = { id: nextId("s", d.slides.map((x) => x.id)), title: "New slide", layout: "stack", media: null, text: null, interactions: [], settings: {}, notes: [], rules: [], variants: null };
      if (kind === "text") s.text = { heading: { [lang]: "" }, body: { [lang]: "" } };
      if (kind === "image") {
        s.media = { type: "image", url: "", alt: {} };
        s.text = { heading: { [lang]: "" }, body: {} };
      }
      if (kind === "video") {
        s.media = { type: "video", url: "", alt: {} };
        s.text = { heading: { [lang]: "" }, body: {} };
        s.settings = { require_full_playback: true, allow_replay: true };
      }
      if (kind === "question") s.interactions = [newQuestion(d, "single_choice")];
      at = d.slides.length ? safeSel + 1 : 0;
      d.slides.splice(at, 0, s);
      return d;
    });
    setSel(at);
  }
  function moveSlide(dir) {
    const to = safeSel + dir;
    if (to < 0 || to >= slides.length) return;
    mutate((d) => {
      const [s] = d.slides.splice(safeSel, 1);
      d.slides.splice(to, 0, s);
      return d;
    });
    setSel(to);
  }
  function dupSlide() {
    mutate((d) => {
      const src = d.slides[safeSel];
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = nextId("s", d.slides.map((x) => x.id));
      copy.title = (src.title || "Slide") + " (copy)";
      if (copy.interactions && copy.interactions[0]) {
        const ids = [];
        d.slides.forEach((s) => (s.interactions || []).forEach((x) => ids.push(x.id)));
        copy.interactions[0].id = nextId("q", ids);
      }
      d.slides.splice(safeSel + 1, 0, copy);
      return d;
    });
    setSel(safeSel + 1);
  }
  function delSlide() {
    if (!window.confirm("Delete this slide?")) return;
    mutate((d) => {
      d.slides.splice(safeSel, 1);
      return d;
    });
    setSel(Math.max(0, safeSel - 1));
  }
  function setMediaType(type) {
    if (!type) patchSlide({ media: null, layout: "stack" });
    else patchSlide({ media: { type, url: (slide.media && slide.media.url) || "", alt: (slide.media && slide.media.alt) || {} }, settings: type === "video" ? { require_full_playback: true, allow_replay: true, ...(slide.settings || {}) } : slide.settings || {} });
  }
  async function onFile(file) {
    if (!file || !slide || !slide.media) return;
    setMsg("");
    try {
      const kind = slide.media.type;
      let blob = file;
      let ext = (file.name.split(".").pop() || "").toLowerCase();
      let type = file.type;
      if (kind === "image") {
        if (!/^image\//.test(file.type)) throw new Error("Please choose an image file.");
        setUploading("Compressing image...");
        const r = await compressImage(file, 1600, 0.85);
        blob = r.blob;
        ext = r.ext;
        type = r.type;
      } else {
        if (!/^video\//.test(file.type)) throw new Error("Please choose a video file.");
        if (file.size > MAX_BYTES) throw new Error("This video is " + (file.size / 1e6).toFixed(0) + " MB. The limit is 50 MB — export it at 720p with a lower bitrate.");
        setUploading("Checking video length...");
        const dur = await videoDuration(file);
        if (dur > MAX_VIDEO_SECONDS) throw new Error("This video is " + Math.round(dur) + " seconds long. The limit is 2 minutes.");
      }
      if (blob.size > MAX_BYTES) throw new Error("File is larger than 50 MB.");
      setUploading("Uploading " + (blob.size / 1e6).toFixed(1) + " MB...");
      const safe = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "media";
      const path = contractId + "/" + Date.now() + "-" + safe + "." + ext;
      const { error } = await supabase.storage.from("deck-media").upload(path, blob, { contentType: type || undefined, upsert: false });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from("deck-media").getPublicUrl(path);
      patchSlide({ media: { ...slide.media, url: data.publicUrl } });
      setUploading("");
      setMsg("Uploaded. Remember to Save the deck.");
    } catch (e) {
      setUploading("");
      setMsg("Upload failed: " + String((e && e.message) || e));
    }
    if (fileRef.current) fileRef.current.value = "";
  }
  async function save() {
    const errs = validate(deck);
    setErrors(errs);
    if (errs.length) return;
    setSaving(true);
    const regions = unionRegions(deck);
    const version = (contract.deck_version || 0) + 1;
    const { error } = await supabase.from("contracts").update({ deck, deck_version: version, deck_updated_at: new Date().toISOString(), regions }).eq("id", contractId);
    setSaving(false);
    if (error) {
      setMsg("Save failed: " + error.message);
      return;
    }
    setContract((c) => ({ ...c, deck, deck_version: version, regions }));
    setDirty(false);
    setMsg("Saved as version " + version + ". Tablets pick it up on their next sync; the phone will ask for a re-sync until they do.");
  }
  async function addLanguage(translate) {
    const code = newLang.code.trim().toLowerCase();
    if (!/^[a-z]{2,5}(-[a-z]{2})?$/.test(code)) {
      setMsg("Language code should look like de, fr, es or pt-br.");
      return;
    }
    if (deck.languages[code]) {
      setMsg("That language already exists on this deck.");
      return;
    }
    const regions = parseList(newLang.regions);
    if (!translate) {
      mutate((d) => {
        d.languages[code] = regions;
        return d;
      });
      setLang(code);
      setNewLang({ code: "", name: "", regions: "" });
      return;
    }
    setTranslating(true);
    setMsg("");
    try {
      const r = await fetch("/api/deck/translate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ deck, source: deck.default_language, target: code, target_name: newLang.name.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "translation failed (" + r.status + ")");
      const nd = normalizeDeck(j.deck);
      nd.languages[code] = regions;
      setDeck(nd);
      setDirty(true);
      setLang(code);
      setNewLang({ code: "", name: "", regions: "" });
      setMsg("Translated " + j.translated + " of " + j.total + " texts into " + code.toUpperCase() + " (AI cost ≈ $" + j.cost_estimate + "). Review every screen in " + code.toUpperCase() + ", then Save." + (j.warnings && j.warnings.length ? " " + j.warnings.join(" ") : ""));
    } catch (e) {
      mutate((d) => {
        d.languages[code] = regions;
        return d;
      });
      setLang(code);
      setMsg("Could not translate (" + String((e && e.message) || e) + "). The language was added empty so you can type the texts yourself.");
    }
    setTranslating(false);
  }
  function removeLanguage(code) {
    if (code === deck.default_language) return;
    if (!window.confirm("Remove the " + code.toUpperCase() + " layer from this deck?")) return;
    mutate((d) => {
      delete d.languages[code];
      return d;
    });
    setLang(deck.default_language);
  }

  // ── render ──
  if (!ready || !deck) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.muted, fontFamily: F, padding: 24 }}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {msg || "Loading..."}
      </div>
    );
  }
  const langs = Object.keys(deck.languages);
  const mediaUrl = slide && slide.media ? slide.media.url : "";
  const st = (slide && slide.settings) || {};

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: F, paddingBottom: 80 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* header */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: C.bg, padding: "14px 20px", borderBottom: "1px solid " + C.border, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <a href="/admin/decks" style={{ fontSize: 11, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, textDecoration: "none" }}>
            InsightRide · Admin · Decks
          </a>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {contract.client} — {contract.topic}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            Deck v{contract.deck_version || 0} {dirty ? "· unsaved changes" : ""} · {slides.length} slides · languages {langs.map((l) => l.toUpperCase()).join(", ")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginRight: 6 }}>
            <span style={{ fontSize: 11, color: C.muted, marginRight: 4 }}>Editing</span>
            {langs.map((l) => (
              <button key={l} onClick={() => setLang(l)} style={btn({ background: lang === l ? C.gold : C.card2, color: lang === l ? "#0E0E0C" : C.soft, padding: "6px 10px" })}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button onClick={() => setShowSettings(!showSettings)} style={btn({ background: showSettings ? "#2A2520" : C.card2, color: showSettings ? C.gold : C.soft })}>
            Deck settings
          </button>
          <a href={"/interview/" + contractId} target="_blank" rel="noreferrer" style={{ ...btn({ background: C.card2, color: C.soft }), textDecoration: "none" }}>
            Preview (saved deck)
          </a>
          <button onClick={save} disabled={saving || !dirty} style={btn({ background: dirty && !saving ? C.gold : "#3A3A38", color: dirty && !saving ? "#0E0E0C" : "#666", padding: "10px 18px", fontSize: 13 })}>
            {saving ? "Saving..." : "Save deck"}
          </button>
        </div>
      </div>

      <div style={{ padding: "16px 20px", maxWidth: 1240, margin: "0 auto" }}>
        {errors.length > 0 && (
          <div style={{ background: "#3A2020", border: "1px solid " + C.red, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#F0B0A8", lineHeight: 1.6 }}>
            <strong style={{ color: C.red }}>Fix before saving:</strong>
            {errors.map((e, i) => (
              <div key={i}>• {e}</div>
            ))}
          </div>
        )}
        {msg && <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: /failed|not|could not/i.test(msg) ? C.amber : C.green, lineHeight: 1.5 }}>{msg}</div>}

        {/* deck settings */}
        {showSettings && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, marginBottom: 16 }}>
            <Section title="Deck">
              <Label>Default language</Label>
              <Select value={deck.default_language} onChange={(v) => mutate((d) => ({ ...d, default_language: v }))} options={langs.map((l) => [l, l.toUpperCase()])} />
              <div style={{ marginTop: 12 }}>
                <Toggle on={deck.show_progress !== false} onChange={(v) => mutate((d) => ({ ...d, show_progress: v }))} label="Show slide progress to the interviewee" />
                <Toggle on={deck.show_thank_you !== false} onChange={(v) => mutate((d) => ({ ...d, show_thank_you: v }))} label="Show the thank-you screen at the end" />
                <Toggle on={deck.client_can_view !== false} onChange={(v) => mutate((d) => ({ ...d, client_can_view: v }))} label="Client may view this deck in the portal" />
              </div>
            </Section>
            <Section title="Consent form">
              <Toggle on={deck.consent.video_recording !== false} onChange={(v) => mutate((d) => ({ ...d, consent: { ...d.consent, video_recording: v } }))} label="Video recording" />
              <Toggle on={deck.consent.audio_recording !== false} onChange={(v) => mutate((d) => ({ ...d, consent: { ...d.consent, audio_recording: v } }))} label="Audio recording" />
              <Toggle on={deck.consent.location_data !== false} onChange={(v) => mutate((d) => ({ ...d, consent: { ...d.consent, location_data: v } }))} label="Location data" />
              <Toggle on={deck.consent.third_party_sharing !== false} onChange={(v) => mutate((d) => ({ ...d, consent: { ...d.consent, third_party_sharing: v } }))} label="Shared with the client" />
              <Label>Data retention (days)</Label>
              <Input type="number" value={deck.consent.data_retention_days} onChange={(v) => mutate((d) => ({ ...d, consent: { ...d.consent, data_retention_days: Math.max(1, parseInt(v || "0", 10) || 1) } }))} />
              <Label hint={"leave empty to use \"" + contract.client + "\""}>Client name shown on the consent form ({lang.toUpperCase()})</Label>
              <Input value={G(deck.consent.client_name)} onChange={(v) => mutate((d) => ({ ...d, consent: { ...d.consent, client_name: setLangField(d.consent.client_name, v) } }))} placeholder="e.g. an independent research organization" />
            </Section>
            <Section title="Languages and regions">
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 6 }}>Each language lists the cities or countries where it is used. A tablet in one of those regions shows that language. All regions together decide which tablets sync this deck.</div>
              {langs.map((l) => (
                <div key={l} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: l === deck.default_language ? C.gold : C.soft }}>{l.toUpperCase()}</span>
                  <input value={(deck.languages[l] || []).join(", ")} onChange={(e) => mutate((d) => ({ ...d, languages: { ...d.languages, [l]: parseList(e.target.value) } }))} placeholder="e.g. Toronto, Brampton, Canada" style={{ ...inputStyle, flex: 1 }} />
                  {l !== deck.default_language && (
                    <button onClick={() => removeLanguage(l)} style={btn({ background: C.card2, color: C.red })}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <Label>Add a language</Label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={newLang.code} onChange={(e) => setNewLang({ ...newLang, code: e.target.value })} placeholder="code, e.g. de" style={{ ...inputStyle, width: 110 }} />
                <input value={newLang.name} onChange={(e) => setNewLang({ ...newLang, name: e.target.value })} placeholder="name, e.g. German" style={{ ...inputStyle, width: 150 }} />
                <input value={newLang.regions} onChange={(e) => setNewLang({ ...newLang, regions: e.target.value })} placeholder="regions, e.g. Berlin, Germany" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => addLanguage(true)} disabled={translating || !newLang.code.trim()} style={btn({ background: translating || !newLang.code.trim() ? "#3A3A38" : C.gold, color: translating || !newLang.code.trim() ? "#666" : "#0E0E0C" })}>
                  {translating ? "Translating..." : "Add and translate from " + deck.default_language.toUpperCase()}
                </button>
                <button onClick={() => addLanguage(false)} disabled={translating || !newLang.code.trim()} style={btn({ background: C.card2, color: C.soft })}>
                  Add empty
                </button>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>Translation covers slide text, questions, options and notes. Consent wording for a new language must be reviewed by counsel before use.</div>
            </Section>
          </div>
        )}

        {/* two columns */}
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
          {/* slide list */}
          <div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              <button onClick={() => addSlide("text")} style={btn({ background: C.card2, color: C.text })}>
                + Text
              </button>
              <button onClick={() => addSlide("image")} style={btn({ background: C.card2, color: C.text })}>
                + Image
              </button>
              <button onClick={() => addSlide("video")} style={btn({ background: C.card2, color: C.text })}>
                + Video
              </button>
              <button onClick={() => addSlide("question")} style={btn({ background: C.gold, color: "#0E0E0C" })}>
                + Question
              </button>
            </div>
            {slides.map((s, i) => {
              const sq = s.interactions && s.interactions[0];
              const isCur = i === safeSel;
              return (
                <div key={s.id} onClick={() => setSel(i)} style={{ padding: "10px 12px", borderRadius: 10, border: isCur ? "2px solid " + C.gold : "1px solid " + C.border, background: isCur ? "#2A2520" : C.card, marginBottom: 6, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isCur ? C.gold : C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {i + 1}. {s.title || s.id}
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        {s.media ? s.media.type : "no media"} · {sq ? sq.type.replace("_", " ") : "passive"}
                        {sq && sq.private ? " · private" : ""}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {slide && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button onClick={() => moveSlide(-1)} disabled={safeSel === 0} style={btn({ background: C.card2, color: safeSel === 0 ? "#555" : C.soft })}>
                  Up
                </button>
                <button onClick={() => moveSlide(1)} disabled={safeSel >= slides.length - 1} style={btn({ background: C.card2, color: safeSel >= slides.length - 1 ? "#555" : C.soft })}>
                  Down
                </button>
                <button onClick={dupSlide} style={btn({ background: C.card2, color: C.soft })}>
                  Duplicate
                </button>
                <button onClick={delSlide} style={btn({ background: "#3A2020", color: C.red })}>
                  Delete
                </button>
              </div>
            )}
          </div>

          {/* slide editor */}
          <div>
            {!slide && <div style={{ color: C.muted }}>Add a slide to begin.</div>}
            {slide && (
              <>
                <Section title={"Slide " + (safeSel + 1) + " · " + slide.id}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
                    <div>
                      <Label hint="for you, the HelpBot and statistics — not shown to the interviewee">Title</Label>
                      <Input value={slide.title} onChange={(v) => patchSlide({ title: v })} placeholder="e.g. The ad" />
                    </div>
                    <div>
                      <Label>Layout</Label>
                      <Select value={slide.layout || "stack"} onChange={(v) => patchSlide({ layout: v })} options={[["stack", "Media above, question below"], ["split", "Media left, question right (landscape)"]]} />
                    </div>
                  </div>
                </Section>

                <Section title="Media">
                  <Label>Type</Label>
                  <Select value={slide.media ? slide.media.type : ""} onChange={setMediaType} options={[["", "None"], ["image", "Image"], ["video", "Video"]]} />
                  {slide.media && (
                    <>
                      <Label hint={slide.media.type === "video" ? "under 2 minutes and 50 MB; MP4 recommended" : "compressed automatically to max 1600 px"}>File</Label>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input ref={fileRef} type="file" accept={slide.media.type === "video" ? "video/*" : "image/*"} onChange={(e) => onFile(e.target.files && e.target.files[0])} style={{ color: C.soft, fontSize: 12 }} />
                        {uploading && <span style={{ fontSize: 12, color: C.gold }}>{uploading}</span>}
                      </div>
                      <Label hint="or paste a public link">URL</Label>
                      <Input value={mediaUrl} onChange={(v) => patchSlide({ media: { ...slide.media, url: v } })} placeholder="https://..." />
                      {mediaUrl && (
                        <div style={{ marginTop: 10, background: "#000", borderRadius: 10, overflow: "hidden", maxWidth: 420 }}>
                          {slide.media.type === "video" ? <video src={mediaUrl} controls preload="metadata" style={{ width: "100%", display: "block", maxHeight: 240 }} /> : <img src={mediaUrl} alt="" style={{ width: "100%", display: "block", maxHeight: 240, objectFit: "contain" }} />}
                        </div>
                      )}
                      <Label hint="short description, used in the phone mirror and for accessibility">Description ({lang.toUpperCase()})</Label>
                      <Input value={G(slide.media.alt)} onChange={(v) => patchSlide({ media: { ...slide.media, alt: setLangField(slide.media.alt, v) } })} placeholder="e.g. The 30-second TV ad" />
                      {slide.media.type === "video" && (
                        <div style={{ marginTop: 12 }}>
                          <Toggle on={!!st.require_full_playback} onChange={(v) => patchSlide({ settings: { ...st, require_full_playback: v } })} label="Must watch the whole video before answering" />
                          <Toggle on={st.allow_replay !== false} onChange={(v) => patchSlide({ settings: { ...st, allow_replay: v } })} label="Allow replay" />
                        </div>
                      )}
                    </>
                  )}
                </Section>

                <Section
                  title="Text"
                  right={
                    slide.text ? (
                      <button onClick={() => patchSlide({ text: null })} style={btn({ background: C.card2, color: C.red })}>
                        Remove text
                      </button>
                    ) : (
                      <button onClick={() => patchSlide({ text: { heading: { [lang]: "" }, body: { [lang]: "" } } })} style={btn({ background: C.card2, color: C.soft })}>
                        Add text
                      </button>
                    )
                  }
                >
                  {slide.text && (
                    <>
                      <Label>Heading ({lang.toUpperCase()})</Label>
                      <Input value={G(slide.text.heading)} onChange={(v) => patchSlide({ text: { ...slide.text, heading: setLangField(slide.text.heading, v) } })} placeholder="e.g. Please watch this ad" />
                      <Label hint="**bold**, lines starting with - become bullets, blank line = paragraph break">Body ({lang.toUpperCase()})</Label>
                      <TextArea value={G(slide.text.body)} onChange={(v) => patchSlide({ text: { ...slide.text, body: setLangField(slide.text.body, v) } })} rows={5} placeholder={"We are going to show you a short ad.\n\n- Some questions have buttons\n- Some just ask you to speak"} />
                    </>
                  )}
                </Section>

                <Section title="Question">
                  <Label>Type</Label>
                  <Select value={q ? q.type : ""} onChange={setQType} options={Q_TYPES} />
                  {q && (
                    <>
                      <Label hint={"id " + q.id + " — this key never changes, so statistics stay consistent across edits and languages"}>Question ({lang.toUpperCase()})</Label>
                      <TextArea value={G(q.prompt)} onChange={(v) => patchQ({ prompt: setLangField(q.prompt, v) })} rows={2} placeholder="e.g. How did this ad make you feel?" />
                      <Label hint="optional, shown under the question">Helper text ({lang.toUpperCase()})</Label>
                      <Input value={G(q.helper)} onChange={(v) => patchQ({ helper: setLangField(q.helper, v) })} placeholder="e.g. Select all that apply." />

                      {CHOICE.includes(q.type) && (
                        <>
                          <Label>Answer options ({lang.toUpperCase()})</Label>
                          {(q.options || []).map((o, k) => (
                            <div key={o.id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                              <span style={{ width: 40, fontSize: 11, color: C.muted }}>{o.id}</span>
                              <input value={G(o.label)} onChange={(e) => patchQ({ options: q.options.map((x, j) => (j === k ? { ...x, label: setLangField(x.label, e.target.value) } : x)) })} placeholder={"Option " + (k + 1)} style={{ ...inputStyle, flex: 1 }} />
                              <button onClick={() => k > 0 && patchQ({ options: (() => { const a = [...q.options]; [a[k - 1], a[k]] = [a[k], a[k - 1]]; return a; })() })} style={btn({ background: C.card2, color: C.soft, padding: "8px 10px" })}>
                                Up
                              </button>
                              <button onClick={() => patchQ({ options: q.options.filter((x, j) => j !== k) })} style={btn({ background: C.card2, color: C.red, padding: "8px 10px" })}>
                                Remove
                              </button>
                            </div>
                          ))}
                          <button onClick={() => patchQ({ options: [...(q.options || []), { id: nextId("o", (q.options || []).map((x) => x.id)), label: { [lang]: "" } }] })} style={btn({ background: C.card2, color: C.text, marginTop: 4 })}>
                            + Add option
                          </button>
                          <div style={{ marginTop: 12 }}>
                            <Toggle on={!!q.allow_other} onChange={(v) => patchQ({ allow_other: v })} label={"Add \"Other (please specify)\" with a text box"} />
                            <Toggle on={!!q.allow_prefer_not} onChange={(v) => patchQ({ allow_prefer_not: v })} label={"Add \"Prefer not to say\""} />
                          </div>
                        </>
                      )}

                      {q.type === "scale" && (
                        <div style={{ display: "grid", gridTemplateColumns: "100px 100px 1fr 1fr", gap: 10 }}>
                          <div>
                            <Label>From</Label>
                            <Input type="number" value={q.scale.min} onChange={(v) => patchQ({ scale: { ...q.scale, min: parseInt(v || "0", 10) || 0 } })} />
                          </div>
                          <div>
                            <Label>To</Label>
                            <Input type="number" value={q.scale.max} onChange={(v) => patchQ({ scale: { ...q.scale, max: parseInt(v || "0", 10) || 0 } })} />
                          </div>
                          <div>
                            <Label>Low label ({lang.toUpperCase()})</Label>
                            <Input value={G(q.scale.min_label)} onChange={(v) => patchQ({ scale: { ...q.scale, min_label: setLangField(q.scale.min_label, v) } })} placeholder="Not at all" />
                          </div>
                          <div>
                            <Label>High label ({lang.toUpperCase()})</Label>
                            <Input value={G(q.scale.max_label)} onChange={(v) => patchQ({ scale: { ...q.scale, max_label: setLangField(q.scale.max_label, v) } })} placeholder="A great deal" />
                          </div>
                        </div>
                      )}

                      {q.type === "text" && (
                        <>
                          <Label>Placeholder ({lang.toUpperCase()})</Label>
                          <Input value={G(q.placeholder)} onChange={(v) => patchQ({ placeholder: setLangField(q.placeholder, v) })} placeholder="Type here..." />
                        </>
                      )}

                      {q.type === "voice" && <div style={{ fontSize: 12, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>The interviewee answers out loud. The transcript for the time this slide is on screen becomes the answer (tagged automatically after transcription).</div>}

                      <div style={{ marginTop: 12 }}>
                        {q.type === "text" && <Toggle on={!!q.private} onChange={(v) => patchQ({ private: v })} label="Private: the interviewer cannot see this answer" />}
                        {q.type !== "voice" && <Toggle on={q.required !== false} onChange={(v) => patchQ({ required: v })} label="Answer expected (interviewer is warned if skipped)" />}
                      </div>
                    </>
                  )}
                </Section>

                <Section title="Screen behaviour">
                  <Toggle on={!!st.auto_blank} onChange={(v) => patchSlide({ settings: { ...st, auto_blank: v } })} label="Blank the tablet screen automatically on this slide (interviewee looks at the interviewer instead)" />
                </Section>

                <Section
                  title={"Private notes for the interviewer (" + lang.toUpperCase() + ")"}
                  right={
                    <button onClick={() => patchSlide({ notes: [...(slide.notes || []), { [lang]: "" }] })} style={btn({ background: C.card2, color: C.soft })}>
                      + Add note
                    </button>
                  }
                >
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Probes and cues. Shown only on the interviewer phone, never on the tablet.</div>
                  {(slide.notes || []).map((n, k) => (
                    <div key={k} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <input value={G(n)} onChange={(e) => patchSlide({ notes: slide.notes.map((x, j) => (j === k ? setLangField(x, e.target.value) : x)) })} placeholder="e.g. If they pick 1 or 2, ask what lowered their trust." style={{ ...inputStyle, flex: 1 }} />
                      <button onClick={() => patchSlide({ notes: slide.notes.filter((x, j) => j !== k) })} style={btn({ background: C.card2, color: C.red, padding: "8px 10px" })}>
                        Remove
                      </button>
                    </div>
                  ))}
                </Section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
