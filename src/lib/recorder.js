// ============================================================
// InsightRide — tablet recording, local storage and upload queue
// File location in repo: src/lib/recorder.js
// Browser-only (MediaRecorder + IndexedDB). Imported by the tablet kiosk.
//
// Recording:  front camera + mic at 720p, MediaRecorder writes a chunk every
//             5 seconds into IndexedDB (memory stays flat; a crash loses <=5 s).
// Crash:      a run left "recording" when the page died becomes "interrupted";
//             the kiosk offers Resume / Start over. Resume records a new PART
//             (part_of = the interview's primary run). Parts upload together.
// Saving:     at End Interview the kiosk stores a "payload" (answers, timeline,
//             demographics...) on the primary run and marks it "pending".
// Uploading:  processPending() -> /api/interview/upload-url (signed URL per part)
//             -> direct upload to Supabase Storage -> /api/interview/complete.
//             Retried until it succeeds (record on cellular, upload on Wi-Fi).
// ============================================================

const DB_NAME = "insightride-recordings";
const DB_VERSION = 1;
const CHUNK_MS = 5000;
const BUCKET = "interview-videos";
export const VIDEO_BITRATE = 1200000; // 1.2 Mbps at 720p (locked decision: 720p)
export const AUDIO_BITRATE = 64000;

export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) {}
  return false;
}

// Prefer MP4 (plays in every browser incl. Safari on the client portal), fall back to WebM.
export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: "webm" };
  const candidates = [
    { mime: "video/mp4;codecs=avc1,mp4a.40.2", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    } catch (e) {}
  }
  return { mime: "", ext: "webm" };
}

// ── IndexedDB ──
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("recordings")) db.createObjectStore("recordings", { keyPath: "run_id" });
      if (!db.objectStoreNames.contains("chunks")) {
        const s = db.createObjectStore("chunks", { keyPath: ["run_id", "seq"] });
        s.createIndex("by_run", "run_id");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function withStore(name, mode, fn) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(name, mode);
      const s = t.objectStore(name);
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

export const store = {
  putRecording: (meta) => withStore("recordings", "readwrite", (s) => s.put(meta)),
  getRecording: (runId) => withStore("recordings", "readonly", (s) => s.get(runId)),
  listRecordings: async () => (await withStore("recordings", "readonly", (s) => s.getAll())) || [],
  deleteRecording: (runId) => withStore("recordings", "readwrite", (s) => s.delete(runId)),
  putChunk: (runId, seq, blob) => withStore("chunks", "readwrite", (s) => s.put({ run_id: runId, seq, blob })),
  getChunks: async (runId) => {
    const rows = (await withStore("chunks", "readonly", (s) => s.index("by_run").getAll(runId))) || [];
    return rows.sort((a, b) => a.seq - b.seq).map((r) => r.blob);
  },
  deleteChunks: (runId) =>
    withStore("chunks", "readwrite", (s) => {
      const req = s.index("by_run").openCursor(IDBKeyRange.only(runId));
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          c.delete();
          c.continue();
        }
      };
      return null;
    }),
};

export async function discardRun(runId) {
  if (!runId) return;
  try {
    await store.deleteChunks(runId);
  } catch (e) {}
  try {
    await store.deleteRecording(runId);
  } catch (e) {}
}

// Interviews waiting to upload (parts are counted with their interview, not separately)
export async function pendingCount() {
  const all = await store.listRecordings();
  return all.filter((m) => !m.part_of && (m.status === "pending" || m.status === "error" || m.status === "uploading")).length;
}

export async function listInterrupted() {
  const all = await store.listRecordings();
  return all.filter((m) => m.status === "interrupted");
}

// On boot: a run left "recording" means the page died mid-interview. Mark it
// "interrupted" so the kiosk can offer Resume / Start over. Prune old done entries.
export async function recoverStale() {
  const all = await store.listRecordings();
  const cutoff = Date.now() - 7 * 864e5;
  for (const m of all) {
    if (m.status === "recording") await store.putRecording({ ...m, status: "interrupted" });
    else if (m.status === "uploading") await store.putRecording({ ...m, status: "pending" });
    else if (m.status === "done" && m.created_at && new Date(m.created_at).getTime() < cutoff) await store.deleteRecording(m.run_id);
  }
}

// Queue an interrupted primary run for upload as-is (used when it cannot be resumed)
export async function finalizeRun(runId, extra) {
  const meta = (await store.getRecording(runId)) || { run_id: runId };
  await store.putRecording({ ...meta, ...(extra || {}), status: "pending" });
}

// ── Recorder ──
export class Recorder {
  constructor() {
    this.stream = null;
    this.rec = null;
    this.runId = null;
    this.seq = 0;
    this.bytes = 0;
    this.startedAt = null;
    this.mime = "";
    this.ext = "webm";
    this._writes = [];
  }
  get active() {
    return !!this.rec && this.rec.state !== "inactive";
  }
  async start(runId, meta) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const pick = pickMimeType();
    const opts = { videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: AUDIO_BITRATE };
    if (pick.mime) opts.mimeType = pick.mime;
    let rec;
    try {
      rec = new MediaRecorder(stream, opts);
    } catch (e) {
      rec = new MediaRecorder(stream); // let the browser pick
    }
    this.stream = stream;
    this.rec = rec;
    this.runId = runId;
    this.seq = 0;
    this.bytes = 0;
    this._writes = [];
    this.mime = rec.mimeType || pick.mime || "video/webm";
    this.ext = this.mime.indexOf("mp4") >= 0 ? "mp4" : "webm";
    await store.putRecording({ run_id: runId, status: "recording", mime: this.mime, ext: this.ext, created_at: new Date().toISOString(), ...(meta || {}) });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        const seq = this.seq++;
        this.bytes += e.data.size;
        this._writes.push(store.putChunk(runId, seq, e.data).catch(() => {}));
      }
    };
    await new Promise((resolve, reject) => {
      rec.onstart = () => {
        this.startedAt = Date.now();
        resolve();
      };
      rec.onerror = (ev) => reject((ev && ev.error) || new Error("recorder error"));
      try {
        rec.start(CHUNK_MS);
      } catch (e) {
        reject(e);
      }
    });
    return { mime: this.mime, ext: this.ext, startedAt: this.startedAt };
  }
  async stop() {
    const rec = this.rec;
    if (!rec) return null;
    if (rec.state !== "inactive") {
      await new Promise((resolve) => {
        rec.onstop = () => resolve();
        try {
          rec.stop();
        } catch (e) {
          resolve();
        }
      });
    }
    await Promise.all(this._writes);
    if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
    const out = { runId: this.runId, mime: this.mime, ext: this.ext, startedAt: this.startedAt, endedAt: Date.now(), chunks: this.seq, bytes: this.bytes };
    this.rec = null;
    this.stream = null;
    return out;
  }
}

// ── Upload ──
async function blobFor(runId, fallbackMime, fallbackExt) {
  const chunks = await store.getChunks(runId);
  if (!chunks.length) return null;
  const meta = await store.getRecording(runId);
  const mime = (meta && meta.mime) || fallbackMime || "video/webm";
  const ext = (meta && meta.ext) || fallbackExt || (mime.indexOf("mp4") >= 0 ? "mp4" : "webm");
  return { blob: new Blob(chunks, { type: mime }), mime, ext };
}
async function signedUpload(base, ext, part, interviewNumber) {
  const r = await fetch("/api/interview/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...base, ext, part, interview_number: interviewNumber || undefined }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || "could not prepare the upload (" + r.status + ")");
  return j;
}

export async function uploadRecording(supabase, runId, onEvent) {
  const emit = (phase, extra) => {
    try {
      onEvent && onEvent({ run_id: runId, phase, ...(extra || {}) });
    } catch (e) {}
  };
  const meta = await store.getRecording(runId);
  if (!meta) throw new Error("recording not found on this tablet");
  if (meta.status === "done") {
    emit("done", { interview_number: meta.interview_number, interview_id: meta.interview_id, video_path: meta.video_path });
    return meta;
  }

  // Every part of this interview (a resumed interview has 2+ parts)
  const parts = Array.isArray(meta.parts) && meta.parts.length ? meta.parts : [{ run_id: runId, index: 0, offset_ms: 0 }];
  const files = [];
  for (const p of parts) {
    const b = await blobFor(p.run_id, meta.mime, meta.ext);
    if (b) files.push({ ...p, ...b });
  }
  if (!files.length) throw new Error("no video data was captured");
  const total = files.reduce((sum, f) => sum + f.blob.size, 0);
  emit("uploading", { bytes: total });

  const base = { session_id: meta.session_id, device_id: meta.device_id, contract_id: meta.contract_id, run_id: runId };
  const first = await signedUpload(base, files[0].ext, 1, null);
  let path = first.path;
  let interviewNumber = first.interview_number;
  let interviewId = first.interview_id || null;

  if (!first.already_complete) {
    const uploaded = [];
    for (let k = 0; k < files.length; k++) {
      const f = files[k];
      const target = k === 0 ? first : await signedUpload(base, f.ext, k + 1, interviewNumber);
      const { error: upErr } = await supabase.storage.from(BUCKET).uploadToSignedUrl(target.path, target.token, f.blob, { contentType: f.mime, upsert: true });
      if (upErr) throw new Error(upErr.message || "upload failed");
      uploaded.push({ part: k + 1, path: target.path, offset_ms: f.offset_ms || 0, bytes: f.blob.size, mime: f.mime });
    }
    path = uploaded[0].path;
    emit("finalizing", { bytes: total });
    const payload = meta.payload || {};
    const recording = { ...(meta.recording || {}), mime: files[0].mime, ext: files[0].ext, bytes: total };
    if (uploaded.length > 1) {
      recording.parts = uploaded;
      recording.multi_part = true;
    }
    const r2 = await fetch("/api/interview/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, ...payload, video_path: path, interview_number: interviewNumber, recording, partial: !!meta.partial }),
    });
    const j2 = await r2.json().catch(() => ({}));
    if (!r2.ok || !j2.ok) throw new Error(j2.error || "could not save the interview (" + r2.status + ")");
    interviewNumber = j2.interview_number;
    interviewId = j2.interview_id;
  }

  const done = { ...meta, status: "done", video_path: path, interview_number: interviewNumber, interview_id: interviewId, error: null, payload: null };
  await store.putRecording(done);
  for (const p of parts) {
    await store.deleteChunks(p.run_id);
    if (p.run_id !== runId) {
      try {
        await store.deleteRecording(p.run_id);
      } catch (e) {}
    }
  }
  emit("done", { interview_number: interviewNumber, interview_id: interviewId, video_path: path });
  return done;
}

export async function processPending(supabase, onEvent) {
  const all = await store.listRecordings();
  const todo = all.filter((m) => !m.part_of && (m.status === "pending" || m.status === "error")).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const results = [];
  for (const m of todo) {
    await store.putRecording({ ...m, status: "uploading" });
    try {
      const r = await uploadRecording(supabase, m.run_id, onEvent);
      results.push({ run_id: m.run_id, ok: true, r });
    } catch (e) {
      const msg = String((e && e.message) || e);
      const latest = (await store.getRecording(m.run_id)) || m;
      await store.putRecording({ ...latest, status: "error", error: msg, attempts: (latest.attempts || 0) + 1, last_attempt: new Date().toISOString() });
      try {
        onEvent && onEvent({ run_id: m.run_id, phase: "error", error: msg });
      } catch (x) {}
      results.push({ run_id: m.run_id, ok: false, error: msg });
    }
  }
  return results;
}
