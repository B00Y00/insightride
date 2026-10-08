// ============================================================
// InsightRide — deck preloading + sync (tablet) and region matching (tablet + phone)
// File location in repo: src/lib/decksync.js
//
// Deck DEFINITIONS (small JSON) -> IndexedDB "insightride-decks"
// Deck MEDIA (images/videos)     -> Cache Storage "ir-media-v1", served by public/sw.js
// syncDecks(): fetch active deck contracts for the interviewer's region, store
// definitions, download missing media, evict decks that are no longer relevant.
// ============================================================

export const MEDIA_CACHE = "ir-media-v1";
const DB_NAME = "insightride-decks";
const DB_VERSION = 1;

// ── Region matching (used by the tablet AND the interviewer phone) ──
export function normRegion(s) {
  return String(s || "").trim().toLowerCase();
}
// A contract with no region tags runs everywhere. Otherwise it must name the
// interviewer's city OR country (case-insensitive).
export function contractMatchesRegion(contract, region) {
  const regs = Array.isArray(contract && contract.regions) ? contract.regions.map(normRegion).filter(Boolean) : [];
  if (!regs.length) return true;
  if (!region) return false;
  const mine = [normRegion(region.city), normRegion(region.country)].filter(Boolean);
  return regs.some((r) => mine.includes(r));
}
export function regionLabel(region) {
  if (!region) return "";
  return [region.city, region.country].filter(Boolean).join(", ");
}

// ── Environment helpers ──
export function connectionType() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c && c.type) return c.type; // wifi | cellular | ethernet | none | unknown ...
  } catch (e) {}
  return "unknown";
}
export async function estimateStorage() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage || 0, quota: e.quota || 0 };
    }
  } catch (e) {}
  return null;
}
export async function registerMediaWorker() {
  try {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.register("/sw.js");
    return true;
  } catch (e) {
    return false;
  }
}

// ── IndexedDB for deck definitions ──
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("decks")) db.createObjectStore("decks", { keyPath: "contract_id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function withStore(mode, fn) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction("decks", mode);
      const s = t.objectStore("decks");
      let out;
      const r = fn(s);
      if (r && typeof r === "object" && "onsuccess" in r) {
        r.onsuccess = () => {
          out = r.result;
        };
      }
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("transaction aborted"));
    });
  } finally {
    db.close();
  }
}
export const deckStore = {
  get: (id) => withStore("readonly", (s) => s.get(id)),
  put: (row) => withStore("readwrite", (s) => s.put(row)),
  list: async () => (await withStore("readonly", (s) => s.getAll())) || [],
  delete: (id) => withStore("readwrite", (s) => s.delete(id)),
};
export async function getCachedDeck(contractId) {
  try {
    return (await deckStore.get(contractId)) || null;
  } catch (e) {
    return null;
  }
}

// ── Media cache ──
export function deckMediaUrls(deck) {
  const urls = new Set();
  ((deck && deck.slides) || []).forEach((s) => {
    if (s.media && s.media.url) urls.add(s.media.url);
  });
  return Array.from(urls);
}
export async function isUrlCached(url) {
  try {
    const cache = await caches.open(MEDIA_CACHE);
    return !!(await cache.match(url, { ignoreVary: true }));
  } catch (e) {
    return false;
  }
}
// Download one media file into the cache. Tries a normal (CORS) fetch first so
// videos support seeking; falls back to an opaque fetch for hosts without CORS.
export async function cacheUrl(url) {
  const cache = await caches.open(MEDIA_CACHE);
  if (await cache.match(url, { ignoreVary: true })) return "cached";
  let res = null;
  try {
    res = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
  } catch (e) {
    res = null;
  }
  if (res && res.ok) {
    await cache.put(url, res);
    return "cached";
  }
  if (res && !res.ok && res.type !== "opaque") throw new Error("HTTP " + res.status);
  let opaque = null;
  try {
    opaque = await fetch(url, { mode: "no-cors", credentials: "omit", cache: "no-store" });
  } catch (e) {
    throw new Error("download failed");
  }
  await cache.put(url, opaque);
  return "cached";
}

// ── Contracts ──
export const CONTRACT_FIELDS = "id, client, topic, type, estimated_minutes, interviewer_payout, interviewee_incentive, interviews_total, interviews_remaining, interviewee_demographics, deck, deck_version, deck_updated_at, regions";
export async function fetchActiveContracts(supabase) {
  const { data, error } = await supabase.from("contracts").select(CONTRACT_FIELDS).gt("deck_version", 0).gt("interviews_remaining", 0);
  if (error) throw new Error(error.message || "could not load contracts");
  return data || [];
}

// ── The sync ──
// Returns { status: {contract_id: {...}}, synced_at, region, count }
export async function syncDecks({ supabase, region, allowMedia, onProgress }) {
  const contracts = await fetchActiveContracts(supabase);
  const relevant = contracts.filter((c) => c.deck && Array.isArray(c.deck.slides) && contractMatchesRegion(c, region));
  const status = {};
  const keepUrls = new Set();

  for (const c of relevant) {
    const urls = deckMediaUrls(c.deck);
    urls.forEach((u) => keepUrls.add(u));
    const { deck, ...rest } = c;
    await deckStore.put({ contract_id: c.id, version: c.deck_version, updated_at: c.deck_updated_at, contract: rest, deck, media_urls: urls, cached_at: new Date().toISOString() });

    let cached = 0;
    let error = null;
    for (const u of urls) {
      try {
        if (await isUrlCached(u)) {
          cached++;
        } else if (allowMedia) {
          await cacheUrl(u);
          cached++;
        }
      } catch (e) {
        error = String((e && e.message) || e);
      }
      if (onProgress) onProgress({ contract_id: c.id, client: c.client, cached, total: urls.length });
    }
    status[c.id] = {
      version: c.deck_version,
      client: c.client,
      topic: c.topic,
      media_total: urls.length,
      media_cached: cached,
      ready: cached === urls.length,
      error,
      deferred: !allowMedia && cached < urls.length,
    };
  }

  // Evict definitions and media that no relevant contract uses any more
  try {
    const all = await deckStore.list();
    for (const d of all) {
      if (!relevant.find((c) => c.id === d.contract_id)) await deckStore.delete(d.contract_id);
    }
    const cache = await caches.open(MEDIA_CACHE);
    const keys = await cache.keys();
    for (const req of keys) {
      if (!keepUrls.has(req.url)) await cache.delete(req);
    }
  } catch (e) {}

  return { status, synced_at: new Date().toISOString(), region, count: relevant.length };
}
