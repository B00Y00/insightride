import { createClient } from "@supabase/supabase-js";

// ============================================================
// InsightRide — GET /api/portal/deck?contractId=...
// File location in repo: src/app/api/portal/deck/route.js
// Header: Authorization: Bearer <access token>
//
// Returns a CLIENT-SAFE copy of the contract's slide deck:
//  - private interviewer notes, consent settings, region lists, rules and
//    variants are removed;
//  - "questions": every deck question with its stable option IDs and labels in
//    every language (the Statistics page uses this even when the slide viewer
//    is switched off for the client);
//  - "deck": the slides themselves, only when deck.client_can_view is not false
//    (admins always get it).
// ============================================================

export const runtime = "nodejs";

function json(b, s) {
  return Response.json(b, { status: s || 200 });
}

function cleanSlide(s) {
  return {
    id: s.id,
    title: s.title || "",
    layout: s.layout || "stack",
    media: s.media ? { type: s.media.type, url: s.media.url, alt: s.media.alt || {} } : null,
    text: s.text || null,
    interactions: (s.interactions || []).map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt || {},
      helper: q.helper || {},
      placeholder: q.placeholder || {},
      options: Array.isArray(q.options) ? q.options.map((o) => ({ id: o.id, label: o.label || {} })) : undefined,
      allow_other: !!q.allow_other,
      allow_prefer_not: !!q.allow_prefer_not,
      scale: q.scale || undefined,
      private: !!q.private,
    })),
    settings: { require_full_playback: !!(s.settings && s.settings.require_full_playback), allow_replay: !(s.settings && s.settings.allow_replay === false), auto_blank: !!(s.settings && s.settings.auto_blank) },
  };
}

export async function GET(request) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const token = (request.headers.get("authorization") || "").replace("Bearer ", "");
    if (!token) return json({ ok: false, error: "Not signed in" }, 401);
    const { data: caller } = await supabase.auth.getUser(token);
    if (!caller || !caller.user) return json({ ok: false, error: "Not signed in" }, 401);

    const contractId = new URL(request.url).searchParams.get("contractId");
    if (!contractId) return json({ ok: false, error: "contractId is required" }, 400);

    const { data: prof } = await supabase.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
    const isAdmin = prof && prof.role === "admin";
    if (!isAdmin) {
      const { data: link } = await supabase.from("client_contracts").select("access_revoked").eq("client_id", caller.user.id).eq("contract_id", contractId).maybeSingle();
      if (!link || link.access_revoked) return json({ ok: false, error: "This contract isn't assigned to your account." }, 403);
    }

    const { data: c } = await supabase.from("contracts").select("id, topic, deck, deck_version, deck_updated_at").eq("id", contractId).maybeSingle();
    if (!c) return json({ ok: false, error: "Contract not found" }, 404);
    const deck = c.deck && Array.isArray(c.deck.slides) && c.deck.slides.length ? c.deck : null;
    if (!deck) return json({ ok: true, has_deck: false, visible: false, questions: [], deck: null });

    const defaultLang = deck.default_language || "en";
    const languages = Array.from(new Set([defaultLang].concat(Object.keys(deck.languages || {}))));
    const slides = deck.slides.map(cleanSlide);
    const questions = [];
    slides.forEach((s) =>
      s.interactions.forEach((q) =>
        questions.push({ id: q.id, slide_id: s.id, slide_title: s.title, type: q.type, prompt: q.prompt, options: q.options || [], allow_other: q.allow_other, allow_prefer_not: q.allow_prefer_not, scale: q.scale || null })
      )
    );
    const visible = isAdmin || deck.client_can_view !== false;

    return json({
      ok: true,
      has_deck: true,
      visible,
      topic: c.topic,
      deck_version: c.deck_version,
      updated_at: c.deck_updated_at,
      default_language: defaultLang,
      languages,
      questions,
      deck: visible ? { default_language: defaultLang, languages, show_progress: deck.show_progress !== false, slides } : null,
    });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
