import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// InsightRide — POST /api/deck/translate
// File location in repo: src/app/api/deck/translate/route.js
// Body: { deck, source: "en", target: "de", target_name: "German" }
// Returns the same deck with a new language layer on every text field.
// IDs (slides, questions, options) never change, so statistics aggregate
// across languages. Admin sign-in required.
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";

function json(b, s) {
  return NextResponse.json(b, { status: s || 200 });
}
async function requireAdmin(req, supabase) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return profile && profile.role === "admin" ? data.user : null;
}
function isLangObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

// Collect every language field in the deck as { path: [...], text }
function collect(deck, source) {
  const items = [];
  const add = (path, obj) => {
    if (isLangObj(obj) && typeof obj[source] === "string" && obj[source].trim()) items.push({ path, text: obj[source] });
  };
  if (deck.consent) add(["consent", "client_name"], deck.consent.client_name);
  (deck.slides || []).forEach((s, si) => {
    if (s.text) {
      add(["slides", si, "text", "heading"], s.text.heading);
      add(["slides", si, "text", "body"], s.text.body);
    }
    if (s.media) add(["slides", si, "media", "alt"], s.media.alt);
    (s.interactions || []).forEach((q, qi) => {
      add(["slides", si, "interactions", qi, "prompt"], q.prompt);
      add(["slides", si, "interactions", qi, "helper"], q.helper);
      add(["slides", si, "interactions", qi, "placeholder"], q.placeholder);
      (q.options || []).forEach((o, oi) => add(["slides", si, "interactions", qi, "options", oi, "label"], o.label));
      if (q.scale) {
        add(["slides", si, "interactions", qi, "scale", "min_label"], q.scale.min_label);
        add(["slides", si, "interactions", qi, "scale", "max_label"], q.scale.max_label);
      }
    });
    (s.notes || []).forEach((n, ni) => add(["slides", si, "notes", ni], n));
  });
  return items;
}
function setAt(root, path, lang, value) {
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  const key = path[path.length - 1];
  const existing = isLangObj(cur[key]) ? cur[key] : {};
  cur[key] = { ...existing, [lang]: value };
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { deck, source, target, target_name } = body || {};
    if (!deck || !Array.isArray(deck.slides) || !source || !target) return json({ ok: false, error: "deck, source and target are required" }, 400);
    if (source === target) return json({ ok: false, error: "source and target language are the same" }, 400);

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json({ ok: false, error: "admin sign-in required" }, 403);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ ok: false, error: "ANTHROPIC_API_KEY is not set" }, 500);

    const out = JSON.parse(JSON.stringify(deck));
    const items = collect(out, source);
    if (!items.length) return json({ ok: true, deck: out, translated: 0, warnings: ["No text found in the source language."] });

    const tool = {
      name: "translate_items",
      description: "Return a translation for every item, keyed by its index.",
      input_schema: {
        type: "object",
        properties: { items: { type: "array", items: { type: "object", properties: { i: { type: "integer" }, text: { type: "string" } }, required: ["i", "text"] } } },
        required: ["items"],
      },
    };
    const system =
      "You translate market-research interview decks shown to interviewees on a tablet. Translate from " +
      source +
      " into " +
      (target_name ? target_name + " (" + target + ")" : target) +
      ". Keep the meaning, tone and register (polite, plain, second person). PRESERVE FORMATTING EXACTLY: keep **bold** markers, keep lines that start with '- ' as bullet lines, keep blank lines and line breaks. Do not add, drop or reorder items. Do not translate brand or product names. Return every index.";
    const userText = items.map((it, i) => "[" + i + "]\n" + it.text).join("\n\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: userText }], tools: [tool], tool_choice: { type: "tool", name: "translate_items" } }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return json({ ok: false, error: (j.error && j.error.message) || "translation request failed (" + res.status + ")" }, 500);
    const block = (j.content || []).find((b) => b.type === "tool_use");
    const got = block && block.input && Array.isArray(block.input.items) ? block.input.items : [];
    const byIndex = new Map(got.map((x) => [Number(x.i), String(x.text || "")]));

    let translated = 0;
    const warnings = [];
    items.forEach((it, i) => {
      const text = byIndex.get(i);
      if (typeof text === "string" && text.trim()) {
        setAt(out, it.path, target, text);
        translated++;
      } else {
        setAt(out, it.path, target, it.text); // fall back to the source text so nothing is blank
        warnings.push("Item " + i + " was not translated; source text kept.");
      }
    });
    out.languages = { ...(out.languages || {}), [target]: Array.isArray((out.languages || {})[target]) ? out.languages[target] : [] };

    const usage = j.usage || {};
    const cost = ((usage.input_tokens || 0) * 1 + (usage.output_tokens || 0) * 5) / 1e6;
    return json({ ok: true, deck: out, translated, total: items.length, warnings, cost_estimate: Number(cost.toFixed(4)) });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
