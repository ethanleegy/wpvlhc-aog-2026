import { compressPhoto } from "./compression.js";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const descriptor = item => ({ mimeType: item.mimeType, bytes: item.bytes, width: item.width, height: item.height, sha256: item.sha256 });

export function createGalleryApi({ admin = false, base = "/v1" } = {}) {
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`${base}${admin ? "/admin" : ""}${path}`, {
      method, credentials: admin ? "same-origin" : "omit", headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(admin && method !== "GET" ? { "X-Admin-Request": "true" } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (admin && response.status === 401) window.dispatchEvent(new Event("session-expired"));
      const error = new Error(data.error?.message || "Photo sharing is temporarily unavailable");
      error.status = response.status; error.code = data.error?.code; throw error;
    }
    return data;
  };
}
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("wpvlhc-gallery-queue-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("queues");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function persist(key, value) {
  const db = await database();
  try { await new Promise((resolve, reject) => { const tx = db.transaction("queues", "readwrite"); tx.objectStore("queues").put(value, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
}
async function restore(key) {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction("queues").objectStore("queues").get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
export class GalleryQueue {
  constructor({ api, admin = false, sessionToken = "", storageKey, onChange = () => {} }) {
    Object.assign(this, { api, admin, sessionToken, storageKey, onChange });
    this.rows = []; this.paused = true; this.running = false; this.publication = "follow";
  }
  async restore() {
    try {
      const saved = await restore(this.storageKey);
      if (saved) { this.rows = saved.rows; this.batchId = saved.batchId; this.batchRequest = saved.batchRequest; this.publication = saved.publication || "follow"; }
      for (const row of this.rows) if (!["published", "pending", "failed"].includes(row.phase)) row.phase = row.prepared || row.upload ? "queued" : "reselect";
    } catch { this.storageWarning = "Progress will be kept while this page stays open; this browser could not save it for reloads."; }
    this.changed();
  }
  add(files) {
    for (const file of files) {
      const matching = this.rows.find(row => row.fileName === file.name && row.sourceBytes === file.size && row.lastModified === file.lastModified && !row.file && !["published", "pending"].includes(row.phase));
      if (matching) { matching.file = file; matching.phase = "queued"; matching.error = null; continue; }
      this.rows.push({ itemId: crypto.randomUUID(), requestId: crypto.randomUUID(), fileName: file.name.slice(0, 160), sourceBytes: file.size, lastModified: file.lastModified, file, phase: "queued" });
    }
    this.changed();
  }
  async preparePreviews() {
    this.preparing = true; this.changed();
    try {
      for (const row of this.rows) if (row.phase === "queued" && !row.prepared && !row.upload && row.file) {
        row.phase = "preparing"; this.changed();
        try { row.prepared = await compressPhoto(row.file); row.compressedBytes = row.prepared.display.bytes + row.prepared.thumbnail.bytes; row.phase = "queued"; }
        catch (error) { row.phase = "failed"; row.error = error.message; }
        this.changed();
      }
    } finally { this.preparing = false; this.changed(); }
  }
  remove(itemId) { if (!this.running) { this.rows = this.rows.filter(row => row.itemId !== itemId); this.changed(); } }
  clearFinished() { this.rows = this.rows.filter(row => !["published", "pending"].includes(row.phase)); this.changed(); }
  pause() { this.paused = true; this.changed(); }
  retryFailed() { for (const row of this.rows) if (row.phase === "failed") { row.phase = row.file || row.prepared || row.upload ? "queued" : "reselect"; row.error = null; } return this.start(); }
  changed() {
    let persistedBytes = 0;
    let heldBytes = 0;
    for (const row of this.rows) if (row.phase === "failed" && row.prepared) {
      heldBytes += row.prepared.display.bytes + row.prepared.thumbnail.bytes;
      if (heldBytes > 23_000_000) row.prepared = null;
    }
    const rows = this.rows.map(({ file, ...row }) => {
      const bytes = row.prepared ? row.prepared.display.bytes + row.prepared.thumbnail.bytes : 0;
      persistedBytes += bytes;
      return { ...row, ...(persistedBytes > 25_000_000 ? { prepared: undefined } : {}) };
    });
    if (this.storageKey) {
      this.pendingSave = { rows, batchId: this.batchId, batchRequest: this.batchRequest, publication: this.publication };
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        const snapshot = this.pendingSave;
        this.saveWork = (this.saveWork || Promise.resolve()).catch(() => {}).then(() => persist(this.storageKey, snapshot)).catch(() => {
          this.storageWarning = "Reload recovery is unavailable. Keep this page open until sharing finishes.";
          this.onChange(this.rows, this);
        });
      }, this.running ? 200 : 0);
    }
    this.onChange(this.rows, this);
  }
  async start() {
    if (this.running) { this.paused = false; return; }
    this.paused = false; this.running = true; this.error = null; this.changed();
    const active = new Set();
    try {
      if (this.admin && !this.batchId) {
        this.batchRequest ||= crypto.randomUUID();
        this.batchId = (await this.api("/gallery/batches", { requestId: this.batchRequest, publication: this.publication })).id;
        this.changed();
      }
      for (const row of this.rows) {
        if (this.paused) break;
        if (row.phase !== "queued") continue;
        while (active.size >= 2) await Promise.race(active);
        if (this.paused) break;
        try {
          if (!row.prepared && !row.upload) {
            if (!row.file) { row.phase = "reselect"; this.changed(); continue; }
            row.phase = "preparing"; this.changed();
            row.prepared = await compressPhoto(row.file);
            row.compressedBytes = row.prepared.display.bytes + row.prepared.thumbnail.bytes;
          }
          const transfer = this.attemptTransfer(row).catch(error => {
            row.phase = "failed"; row.error = error.message;
            if (error.status === 401 || error.status === 503 || ["STORAGE_LIMIT_REACHED", "PHOTO_LIMIT_REACHED", "SESSION_LIMIT_REACHED"].includes(error.code)) this.paused = true;
          }).finally(() => { active.delete(transfer); this.changed(); });
          active.add(transfer);
        } catch (error) { row.phase = "failed"; row.error = error.message; this.changed(); }
      }
      await Promise.all(active);
    } catch (error) { this.error = error.message; this.paused = true; }
    finally { this.running = false; this.changed(); }
  }
  async completion(row, suffix = "complete") {
    return this.api(`/gallery/uploads/${row.upload.photoId}/${suffix}`, this.admin ? {} : { completionToken: row.upload.completionToken });
  }
  async attemptTransfer(row) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.transfer(row); }
      catch (error) {
        const temporary = !error.status || error.status >= 500 || ["ATTEMPT_ALREADY_USED", "UPLOAD_FAILED"].includes(error.code);
        if (!temporary || attempt === 2 || ["OPERATION_LIMIT_REACHED", "COST_REVIEW_REQUIRED", "GALLERY_DISABLED"].includes(error.code)) throw error;
        row.phase = "retrying"; this.changed(); await wait(1000 * (attempt + 1));
      }
    }
  }
  async transfer(row) {
    if (row.upload) {
      // Reconcile an uncertain prior transfer before requesting new write permission.
      try {
        const result = await this.completion(row);
        if (await this.accept(row, result)) return;
        row.phase = "publishing"; this.changed();
        for (let attempt = 0; attempt < 8; attempt++) {
          await wait(Math.min(1000 * (attempt + 1), 5000));
          if (await this.accept(row, await this.completion(row))) return;
        }
        throw new Error("Your photo is still being added. Retry to check its progress.");
      } catch (error) { if (!["UPLOAD_INCOMPLETE", "PHOTO_BUSY"].includes(error.code)) throw error; }
      if (!row.prepared) {
        if (!row.file) throw new Error("Select this source photo again to retry its unfinished transfer");
        row.prepared = await compressPhoto(row.file);
      }
      const expected = row.descriptor;
      if (expected && (expected.display.sha256 !== row.prepared.display.sha256 || expected.thumbnail.sha256 !== row.prepared.thumbnail.sha256)) throw new Error("This browser produced different compressed files. Start a new submission for this photo.");
      row.upload = await this.completion(row, "retry");
    }
    if (!row.upload) {
      row.phase = "authorizing"; this.changed();
      row.descriptor = { itemId: row.itemId, fileName: row.fileName, thumbnail: descriptor(row.prepared.thumbnail), display: descriptor(row.prepared.display) };
      const result = await this.api("/gallery/uploads", { requestId: row.requestId,
        ...(this.admin ? { batchId: this.batchId } : { sessionToken: this.sessionToken }), files: [row.descriptor] });
      row.upload = result.uploads[0]; this.changed();
    }
    row.phase = "uploading"; this.changed();
    // At most two photos are in flight; each uploads its variants sequentially.
    for (const variant of ["thumbnail", "display"]) {
      const upload = row.upload.variants[variant];
      const response = await fetch(upload.url, { method: "PUT", credentials: "omit", headers: { "Content-Type": upload.mimeType, "X-Gallery-Ticket": upload.ticket }, body: row.prepared[variant].blob });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = new Error(data.error?.message || "Photo transfer interrupted. Retry this photo."); error.status = response.status; error.code = data.error?.code; throw error;
      }
    }
    row.phase = "publishing"; this.changed();
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = await this.completion(row);
      if (await this.accept(row, result)) return;
      await wait(Math.min(1000 * (attempt + 1), 5000));
    }
    throw new Error("Your photo is still being added. Retry to check its progress; it will not be uploaded twice.");
  }
  async accept(row, result) {
    if (["failed", "expired"].includes(result.uploadState)) throw new Error("This photo could not be accepted. Please select a fresh JPEG or WebP copy.");
    if (result.uploadState !== "ready") return false;
    if (result.reviewState === "approved" && result.deliveryState !== "published") return false;
    row.phase = result.photo ? "published" : "pending";
    row.photo = result.photo; row.prepared = null; row.file = null; row.error = null; this.changed(); return true;
  }
}
