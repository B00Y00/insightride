// ============================================================
// InsightRide — media cache worker
// File location in repo: public/sw.js   (served at /sw.js)
//
// Serves deck media that the tablet preloaded into Cache Storage, so slides
// render from the device even with no connection. It ONLY handles requests
// for images, video and audio; everything else (Supabase, realtime, pages,
// API routes) is never touched. Cache misses go to the network as normal.
// ============================================================

const MEDIA_CACHE = "ir-media-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const dest = req.destination;
  if (dest !== "image" && dest !== "video" && dest !== "audio") return;
  event.respondWith(serveMedia(req));
});

async function serveMedia(req) {
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const hit = await cache.match(req.url, { ignoreVary: true });
    if (hit) return withRange(req, hit);
  } catch (e) {}
  return fetch(req);
}

// Video elements ask for byte ranges; answer them from the cached full file.
async function withRange(req, cached) {
  const range = req.headers.get("range");
  if (!range || cached.type === "opaque") return cached;
  try {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m) return cached;
    const blob = await cached.blob();
    const size = blob.size;
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (isNaN(start) || start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
    }
    const slice = blob.slice(start, end + 1);
    return new Response(slice, {
      status: 206,
      statusText: "Partial Content",
      headers: {
        "Content-Type": cached.headers.get("Content-Type") || "application/octet-stream",
        "Content-Range": "bytes " + start + "-" + end + "/" + size,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return cached;
  }
}
