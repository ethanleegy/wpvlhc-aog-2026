const { randomUUID } = require("node:crypto");
const { ApiError, requireRecord } = require("./errors");
const { EVENT, VARIANTS } = require("./gallery-contract.mjs");

const deletedError = () => new ApiError(410, "PHOTO_DELETED", "This photo was deleted by management. It cannot be resumed or shown again.");
// A claimed transfer with an uncertain outcome may still finish writing. The
// Worker stops a stream by ticket expiry; retain its reservation through grace.
const settleAt = attempts => Math.max(Date.now(), ...attempts.filter(a => VARIANTS.some(v => a.claimed?.[v] && a.settled?.[v] !== "stored")).map(a => a.expiresAt + 120_000));

function createGalleryDeletion(db, storage) {
  const photos = db.collection("Photos"), jobs = db.collection("PhotoDeletions");
  const capacityRef = db.collection("GalleryCapacity").doc(EVENT);
  async function request(id, username) {
    return db.runTransaction(async tx => {
      const [jobDoc, photoDoc, capDoc] = await Promise.all([tx.get(jobs.doc(id)), tx.get(photos.doc(id)), tx.get(capacityRef)]);
      if (jobDoc.exists) return { id, success: true, pending: jobDoc.data().state !== "deleted" };
      if (!photoDoc.exists) return { id, success: true, pending: false, missing: true };
      const photo = photoDoc.data(), capacity = capDoc.data() || {};
      if (photo.lease?.expiresAt > Date.now()) throw new ApiError(409, "PHOTO_BUSY", "This photo is being processed. Please retry its deletion shortly.");
      const attempts = photo.attempts || [{ id: photo.attempt || "initial", expiresAt: photo.attemptExpiresAt || 0, claimed: photo.claimed || {}, settled: {} }];
      const objects = attempts.flatMap(a => VARIANTS.map(v => ({ bucket: "private", key: `staging/${EVENT}/${id}/${a.id}/${v}` })));
      objects.push(...VARIANTS.map(v => ({ bucket: "private", key: `retained/${EVENT}/${id}/initial/${v}` })));
      const generations = new Set([photo.generation, String(photo.reviewRevision || 0)].filter(value => value !== null && value !== undefined && value !== ""));
      for (const generation of generations) objects.push(...VARIANTS.map(v => ({ bucket: "published", key: `published/${EVENT}/${id}/${generation}/${v}` })));
      const unique = [...new Map(objects.map(object => [`${object.bucket}:${object.key}`, object])).values()];
      const notBefore = settleAt(attempts);
      tx.create(jobDoc.ref, { state: "pending", objects: unique, attempts, source: photo.source, reservedBytes: photo.reservedBytes || 0,
        requestedAt: new Date().toISOString(), deletedBy: username, notBefore, nextCleanupAt: notBefore, lease: null });
      tx.delete(photoDoc.ref); // Immediately excludes every public/admin listing.
      tx.set(capacityRef, { pendingDeletionCount: (capacity.pendingDeletionCount || 0) + 1 }, { merge: true });
      return { id, success: true, pending: true };
    });
  }
  async function cleanup(id) {
    const jobRef = jobs.doc(id), owner = randomUUID();
    const job = await db.runTransaction(async tx => {
      const doc = await tx.get(jobRef), value = doc.data();
      if (!value || value.state === "deleted") return null;
      if (value.notBefore > Date.now() || value.lease?.expiresAt > Date.now()) return false;
      tx.update(jobRef, { lease: { owner, expiresAt: Date.now() + 120_000 }, nextCleanupAt: Date.now() + 120_000 });
      return value;
    });
    if (job === null) return { pending: false };
    if (job === false) return { pending: true };
    try {
      await storage.deleteMany(job.objects);
      await db.runTransaction(async tx => {
        const [doc, capDoc] = await Promise.all([tx.get(jobRef), tx.get(capacityRef)]);
        const latest = doc.data(), capacity = capDoc.data() || {};
        if (latest.state === "deleted") return;
        if (latest.lease?.owner !== owner) throw new ApiError(409, "PHOTO_BUSY", "Photo cleanup is already running");
        if ((capacity.reservedBytes || 0) < latest.reservedBytes) throw new ApiError(503, "GALLERY_ACCOUNTING_ERROR", "Photo storage accounting needs attention");
        tx.set(capacityRef, { reservedBytes: (capacity.reservedBytes || 0) - latest.reservedBytes,
          photoCount: Math.max(0, (capacity.photoCount || 0) - 1),
          [latest.source === "guest" ? "guestCount" : "adminCount"]: Math.max(0, (capacity[latest.source === "guest" ? "guestCount" : "adminCount"] || 0) - 1),
          pendingDeletionCount: Math.max(0, (capacity.pendingDeletionCount || 0) - 1) }, { merge: true });
        // Keep only a minimal tombstone so repeated deletes/replays cannot bring
        // back the photo or release its capacity twice. Remove the file manifest.
        tx.set(jobRef, { state: "deleted", requestedAt: latest.requestedAt, deletedAt: new Date().toISOString(), deletedBy: latest.deletedBy });
      });
      return { pending: false };
    } catch (error) {
      await db.runTransaction(async tx => {
        const doc = await tx.get(jobRef);
        if (doc.data()?.lease?.owner === owner) tx.update(jobRef, { lease: null, nextCleanupAt: Date.now() + 60_000, lastError: typeof error.code === "string" ? error.code : "DELETE_FAILED" });
      });
      return { pending: true, failed: true };
    }
  }
  async function remove(ids, confirmation, username) {
    if (confirmation !== "delete") throw new ApiError(409, "PHOTO_DELETE_CONFIRMATION_REQUIRED", "Type delete to permanently remove these photos and their stored files.");
    const results = [], deadline = Date.now() + 25_000;
    for (const id of ids) {
      try { results.push(await request(id, username)); }
      catch (error) { results.push({ id, success: false, error: { code: typeof error.code === "string" ? error.code : "DELETE_FAILED", message: error.status ? error.message : "Please retry this photo" } }); }
    }
    // Bound work to this function's request budget. Unfinished cleanup is durable
    // and picked up by the existing maintenance task, including after a timeout.
    for (let index = 0; index < results.length && Date.now() < deadline; index += 2) {
      await Promise.all(results.slice(index, index + 2).filter(r => r.success && r.pending).map(async result => {
        try { result.pending = (await cleanup(result.id)).pending; } catch { /* Already queued durably. */ }
      }));
    }
    return { results };
  }
  async function recordReceipt(tx, capability, outcome) {
    const jobRef = jobs.doc(capability.photoId), job = requireRecord(await tx.get(jobRef), "Photo");
    if (job.state === "deleted") return;
    const attempt = job.attempts.find(a => a.id === capability.attempt);
    if (!attempt?.claimed?.[capability.variant]) throw new ApiError(409, "UNCLAIMED_UPLOAD", "Upload attempt was not claimed");
    const attempts = job.attempts.map(a => a.id === capability.attempt ? { ...a, settled: { ...a.settled, [capability.variant]: outcome } } : a);
    const notBefore = settleAt(attempts);
    tx.update(jobRef, { attempts, notBefore, nextCleanupAt: Math.min(job.nextCleanupAt, notBefore) });
  }
  async function maintenance(limit) {
    const due = await jobs.where("nextCleanupAt", "<=", Date.now()).orderBy("nextCleanupAt").limit(limit).get();
    let deleted = 0, failed = 0;
    const deadline = Date.now() + 20_000;
    for (let index = 0; index < due.docs.length && Date.now() < deadline; index += 2) {
      await Promise.all(due.docs.slice(index, index + 2).map(async doc => {
        try { const result = await cleanup(doc.id); if (!result.pending) deleted++; else if (result.failed) failed++; }
        catch { failed++; }
      }));
    }
    return { deleted, failed };
  }
  return { remove, maintenance, recordReceipt, wasDeleted: async id => (await jobs.doc(id).get()).exists };
}
module.exports = { createGalleryDeletion, deletedError };
