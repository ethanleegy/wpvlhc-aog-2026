const { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
const { ApiError, requireRecord } = require("./errors");
const { assertGallery } = require("./gallery-config");
const { createGalleryStorage } = require("./gallery-storage");
const { verifyImage } = require("./gallery-image");
const { EVENT, LIMITS, VARIANTS, signCapability, verifyCapability } = require("./gallery-contract.mjs");

const hash = text => createHash("sha256").update(text).digest("hex");
const defaults = { requireApproval: false, guestUploadsOpen: true, adminUploadsOpen: true, version: 1 };
const ref = (bucket, key) => ({ bucket, key });
const nowIso = () => new Date().toISOString();
function safeEqual(given, expected) {
  return typeof given === "string" && typeof expected === "string" && timingSafeEqual(Buffer.from(hash(given), "hex"), Buffer.from(hash(expected), "hex"));
}
function createGalleryService(db, fullConfig, storageFactory = createGalleryStorage) {
  const config = assertGallery(fullConfig.gallery);
  const photos = db.collection("Photos");
  const settingsRef = db.collection("GallerySettings").doc(EVENT);
  const capacityRef = db.collection("GalleryCapacity").doc(EVENT);
  const usageRef = db.collection("GalleryUsage").doc(String(config.billingStart));
  const sessions = db.collection("GallerySessions");
  const batches = db.collection("GalleryUploadBatches");
  const requests = db.collection("GalleryUploadRequests");
  const capacityDefaults = { reservedBytes: 0, photoCount: 0, guestCount: 0, adminCount: 0 };

  async function reserveOps(writes, reads) {
    assertGallery(config);
    await db.runTransaction(async tx => {
      const usage = (await tx.get(usageRef)).data() || { writes: 0, reads: 0 };
      if (usage.writes + writes > LIMITS.monthlyWrites || usage.reads + reads > LIMITS.monthlyReads)
        throw new ApiError(503, "OPERATION_LIMIT_REACHED", "The gallery is paused to stay within its free allowance");
      tx.set(usageRef, { writes: usage.writes + writes, reads: usage.reads + reads, start: config.billingStart, end: config.billingEnd });
    });
  }
  const storage = storageFactory(config, reserveOps);
  async function settings() { return { ...defaults, ...(await settingsRef.get()).data() }; }
  async function policy() {
    const current = await settings();
    return { enabled: true, requireApproval: current.requireApproval, guestUploadsOpen: current.guestUploadsOpen,
      limits: LIMITS, formats: ["image/jpeg", "image/webp"], turnstileSiteKey: config.turnstileSiteKey, workerUrl: config.workerUrl };
  }
  async function patchSettings(payload, admin) {
    await db.runTransaction(async tx => {
      const current = { ...defaults, ...(await tx.get(settingsRef)).data() };
      tx.set(settingsRef, { ...current, ...payload, version: current.version + 1, updatedAt: nowIso(), updatedBy: admin });
    });
    return adminSettings();
  }
  async function adminSettings() {
    const [current, cap, usage] = await Promise.all([settings(), capacityRef.get(), usageRef.get()]);
    return { ...current, limits: LIMITS, capacity: { ...capacityDefaults, ...cap.data() }, usage: { writes: 0, reads: 0, ...usage.data() }, billingEnd: new Date(config.billingEnd).toISOString(), workerUrl: config.workerUrl,
      uploadUrl: new URL("gallery/upload/", fullConfig.siteUrl).href };
  }
  async function createSession(turnstileToken, ip) {
    if (!(await settings()).guestUploadsOpen) throw new ApiError(403, "UPLOADS_CLOSED", "Guest photo sharing is closed");
    if (!config.local) {
      let result;
      try {
        const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST", body: new URLSearchParams({ secret: config.turnstileSecret, response: turnstileToken, remoteip: ip }), signal: AbortSignal.timeout(8000),
        });
        result = await response.json();
      } catch { throw new ApiError(503, "VERIFICATION_UNAVAILABLE", "Unable to verify photo sharing. Please retry."); }
      if (!result.success || result.hostname !== config.publicHostname || result.action !== "gallery-upload") throw new ApiError(403, "VERIFICATION_REQUIRED", "Please complete the photo-sharing verification");
    }
    const id = randomBytes(16).toString("hex");
    const exp = Math.floor(Math.min(Date.now() + 86400000, config.billingEnd) / 1000);
    await sessions.doc(id).create({ photoCount: 0, createdAt: nowIso(), expiresAt: exp * 1000 });
    return { sessionToken: await signCapability(config.ticketSecret, { purpose: "session", id, exp }), expiresAt: new Date(exp * 1000).toISOString() };
  }
  async function guestOwner(token) {
    try { return (await verifyCapability(config.ticketSecret, token, "session")).id; }
    catch { throw new ApiError(403, "SESSION_EXPIRED", "Please reopen photo sharing to continue"); }
  }
  async function createBatch(payload, username) {
    const id = hash(`batch:${username}:${payload.requestId}`).slice(0, 32);
    await db.runTransaction(async tx => {
      const doc = await tx.get(batches.doc(id));
      if (doc.exists) {
        if (doc.data().publication !== payload.publication) throw new ApiError(409, "REQUEST_CHANGED", "This batch already has a different publication choice");
        return;
      }
      tx.create(batches.doc(id), { publication: payload.publication, username, createdAt: nowIso() });
    });
    return { id, publication: payload.publication };
  }
  async function authorize(payload, source, username) {
    const owner = source === "guest" ? await guestOwner(payload.sessionToken) : username;
    const requestRef = requests.doc(hash(`${source}:${owner}:${payload.requestId}`));
    const fingerprint = hash(JSON.stringify({ files: payload.files, batchId: payload.batchId || null }));
    const ids = payload.files.map(file => hash(`${source}:${owner}:${payload.requestId}:${file.itemId}`).slice(0, 32));
    await db.runTransaction(async tx => {
      const [priorDoc, settingsDoc, capacityDoc, ownerDoc] = await Promise.all([
        tx.get(requestRef), tx.get(settingsRef), tx.get(capacityRef),
        tx.get(source === "guest" ? sessions.doc(owner) : batches.doc(payload.batchId)),
      ]);
      const prior = priorDoc.data();
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ApiError(409, "REQUEST_CHANGED", "Retry this upload with its original compressed files");
        return;
      }
      const current = { ...defaults, ...settingsDoc.data() }, capacity = { ...capacityDefaults, ...capacityDoc.data() };
      const ownerData = requireRecord(ownerDoc, source === "guest" ? "Upload session" : "Upload batch");
      if (source === "admin" && ownerData.username !== username) throw new ApiError(403, "FORBIDDEN", "This batch belongs to another administrator");
      if (!(source === "guest" ? current.guestUploadsOpen : current.adminUploadsOpen)) throw new ApiError(403, "UPLOADS_CLOSED", "Photo sharing is closed");
      const count = payload.files.length;
      if (source === "guest" && ownerData.photoCount + count > LIMITS.guestPhotos) throw new ApiError(429, "SESSION_LIMIT_REACHED", "This browser has reached its photo-sharing limit");
      if (capacity.photoCount + count > LIMITS.eventPhotos || (source === "guest" && capacity.guestCount + count > LIMITS.guestEventPhotos)) throw new ApiError(409, "PHOTO_LIMIT_REACHED", "The gallery has reached its photo limit");
      const reserved = payload.files.reduce((sum, file) => sum + 3 * (file.thumbnail.bytes + file.display.bytes), 0);
      const protectedAdminBytes = source === "guest" ? Math.max(0, LIMITS.adminReservePhotos - capacity.adminCount) * 1_100_000 : 0;
      if (capacity.reservedBytes + reserved + protectedAdminBytes > LIMITS.storageBytes) throw new ApiError(409, "STORAGE_LIMIT_REACHED", "Photo sharing is paused to preserve the free storage allowance");
      const time = nowIso();
      payload.files.forEach((file, i) => {
        const expiresAt = Math.min(Date.now() + LIMITS.ticketSeconds * 1000, config.billingEnd);
        tx.create(photos.doc(ids[i]), {
          eventId: EVENT, source, owner, batchId: payload.batchId || null, fileName: file.fileName,
          expected: { thumbnail: file.thumbnail, display: file.display },
          uploadState: "authorized", reviewState: "pending", deliveryState: "private", approvalSource: null,
          desiredVisible: false, reviewRevision: 0, generation: null,
          publication: source === "admin" ? ownerData.publication : "follow",
          attempt: "initial", attemptExpiresAt: expiresAt, claimed: {}, attemptCount: 1,
          attempts: [{ id: "initial", expiresAt, claimed: {}, settled: {}, released: false }], nextCleanupAt: expiresAt + 120_000,
          needsReconcile: false,
          reservedBytes: 3 * (file.thumbnail.bytes + file.display.bytes), stagingReleased: false,
          createdAt: time, updatedAt: time, lease: null,
        });
      });
      tx.set(capacityRef, { ...capacity, reservedBytes: capacity.reservedBytes + reserved, photoCount: capacity.photoCount + count,
        guestCount: capacity.guestCount + (source === "guest" ? count : 0), adminCount: capacity.adminCount + (source === "admin" ? count : 0) });
      if (source === "guest") tx.update(ownerDoc.ref, { photoCount: ownerData.photoCount + count });
      tx.create(requestRef, { ids, fingerprint, createdAt: time });
    });
    return { uploads: await Promise.all(ids.map(async id => uploadDetails(id, (await photos.doc(id).get()).data()))) };
  }
  const stageRef = (id, photo, variant) => ref("private", `staging/${EVENT}/${id}/${photo.attempt}/${variant}`);
  const retainedRef = (id, variant) => ref("private", `retained/${EVENT}/${id}/initial/${variant}`);
  const publishedRef = (id, generation, variant) => ref("published", `published/${EVENT}/${id}/${generation}/${variant}`);
  async function uploadDetails(id, photo) {
    const exp = Math.floor(photo.attemptExpiresAt / 1000);
    const variants = {};
    for (const variant of VARIANTS) {
      const expected = photo.expected[variant];
      variants[variant] = { url: `${config.workerUrl}/upload`, ticket: await signCapability(config.ticketSecret, {
        purpose: "upload", photoId: id, variant, key: stageRef(id, photo, variant).key,
        attempt: photo.attempt, bytes: expected.bytes, sha256: expected.sha256, mimeType: expected.mimeType, exp,
      }), mimeType: expected.mimeType };
    }
    const completionToken = await signCapability(config.ticketSecret, { purpose: "complete", photoId: id, owner: photo.owner, exp: Math.floor(config.billingEnd / 1000) });
    return { photoId: id, variants, completionToken, expiresAt: new Date(photo.attemptExpiresAt).toISOString(), uploadState: photo.uploadState };
  }
  async function checkAccess(id, token, admin) {
    const photo = requireRecord(await photos.doc(id).get(), "Photo");
    if (!admin) {
      let capability;
      try { capability = await verifyCapability(config.ticketSecret, token, "complete"); }
      catch { throw new ApiError(403, "INVALID_COMPLETION", "Photo-sharing permission expired"); }
      if (capability.photoId !== id || capability.owner !== photo.owner || photo.source !== "guest") throw new ApiError(403, "FORBIDDEN", "Access denied");
    }
    return photo;
  }
  async function retry(id, token, admin = false) {
    await checkAccess(id, token, admin);
    await db.runTransaction(async tx => {
      const [doc, capDoc] = await Promise.all([tx.get(photos.doc(id)), tx.get(capacityRef)]);
      const photo = doc.data(), capacity = capDoc.data();
      if (photo.uploadState === "ready") return;
      if (["failed", "expired"].includes(photo.uploadState)) throw new ApiError(409, "UPLOAD_CLOSED", "Select this photo again to make a new submission");
      if (photo.lease?.expiresAt > Date.now()) throw new ApiError(409, "PHOTO_BUSY", "The photo is still being checked. Please retry shortly.");
      if (photo.attemptCount >= 3) throw new ApiError(409, "RETRY_LIMIT_REACHED", "This photo has reached its transfer retry limit. Select it again to make a new submission.");
      const extra = photo.expected.thumbnail.bytes + photo.expected.display.bytes;
      if (capacity.reservedBytes + extra > LIMITS.storageBytes) throw new ApiError(409, "STORAGE_LIMIT_REACHED", "Photo sharing is paused to preserve free storage");
      const attempt = randomBytes(8).toString("hex"), expiresAt = Math.min(Date.now() + LIMITS.ticketSeconds * 1000, config.billingEnd);
      tx.update(doc.ref, { attempt, attemptExpiresAt: expiresAt, claimed: {}, attemptCount: photo.attemptCount + 1,
        attempts: [...photo.attempts, { id: attempt, expiresAt, claimed: {}, settled: {}, released: false }], reservedBytes: photo.reservedBytes + extra,
        uploadState: "authorized", updatedAt: nowIso() });
      tx.update(capacityRef, { reservedBytes: capacity.reservedBytes + extra });
    });
    return uploadDetails(id, (await photos.doc(id).get()).data());
  }
  async function claim(ticket, secret) {
    if (!safeEqual(secret, config.claimSecret)) throw new ApiError(403, "FORBIDDEN", "Access denied");
    let capability;
    try { capability = await verifyCapability(config.ticketSecret, ticket, "upload"); }
    catch { throw new ApiError(403, "INVALID_TICKET", "Upload permission expired"); }
    const photoRef = photos.doc(capability.photoId);
    await db.runTransaction(async tx => {
      const [doc, usageDoc] = await Promise.all([tx.get(photoRef), tx.get(usageRef)]);
      const photo = requireRecord(doc, "Photo"), usage = usageDoc.data() || { writes: 0, reads: 0 };
      if (!VARIANTS.includes(capability.variant) || capability.attempt !== photo.attempt || capability.key !== stageRef(doc.id, photo, capability.variant).key || photo.attemptExpiresAt <= Date.now() || photo.uploadState !== "authorized") throw new ApiError(409, "UPLOAD_NOT_ACTIVE", "This upload is no longer active");
      const expected = photo.expected[capability.variant];
      if (capability.bytes !== expected.bytes || capability.sha256 !== expected.sha256 || capability.mimeType !== expected.mimeType) throw new ApiError(403, "INVALID_TICKET", "Upload permission does not match the photo");
      if (photo.claimed[capability.variant]) throw new ApiError(409, "ATTEMPT_ALREADY_USED", "This transfer attempt was already used. Check completion or request a retry.");
      if (usage.writes >= LIMITS.monthlyWrites) throw new ApiError(503, "OPERATION_LIMIT_REACHED", "The gallery is paused to preserve its free allowance");
      tx.update(photoRef, { [`claimed.${capability.variant}`]: true,
        attempts: photo.attempts.map(a => a.id === capability.attempt ? { ...a, claimed: { ...a.claimed, [capability.variant]: true } } : a), updatedAt: nowIso() });
      tx.set(usageRef, { ...usage, writes: usage.writes + 1, start: config.billingStart, end: config.billingEnd });
    });
    return { claimed: true };
  }
  async function receipt(ticket, outcome, secret) {
    if (!safeEqual(secret, config.claimSecret)) throw new ApiError(403, "FORBIDDEN", "Access denied");
    let capability;
    try { capability = await verifyCapability(config.ticketSecret, ticket, "upload", 0); }
    catch { throw new ApiError(403, "INVALID_TICKET", "Invalid upload permission"); }
    await db.runTransaction(async tx => {
      const doc = await tx.get(photos.doc(capability.photoId)), photo = requireRecord(doc, "Photo");
      const attempt = photo.attempts.find(a => a.id === capability.attempt);
      if (!attempt?.claimed?.[capability.variant]) throw new ApiError(409, "UNCLAIMED_UPLOAD", "Upload attempt was not claimed");
      tx.update(doc.ref, { attempts: photo.attempts.map(a => a.id === capability.attempt ? { ...a, settled: { ...a.settled, [capability.variant]: outcome } } : a) });
    });
    return { recorded: true };
  }
  async function lease(id) {
    const owner = randomUUID();
    const acquired = await db.runTransaction(async tx => {
      const photo = requireRecord(await tx.get(photos.doc(id)), "Photo");
      if (photo.lease?.expiresAt > Date.now()) return false;
      tx.update(photos.doc(id), { lease: { owner, expiresAt: Date.now() + 120_000 } });
      return true;
    });
    return acquired ? owner : null;
  }
  async function release(id, owner) {
    await db.runTransaction(async tx => {
      const doc = await tx.get(photos.doc(id));
      if (doc.data()?.lease?.owner === owner) tx.update(doc.ref, { lease: null });
    });
  }
  async function complete(id, token, admin = false) {
    await checkAccess(id, token, admin);
    const owner = await lease(id);
    if (!owner) return status(id, token, admin);
    try {
      let photo = (await photos.doc(id).get()).data();
      if (photo.uploadState === "failed" || photo.uploadState === "expired") return status(id, token, admin);
      if (photo.uploadState !== "ready") {
        try {
          for (const variant of VARIANTS) {
            const bytes = await storage.read(stageRef(id, photo, variant));
            verifyImage(bytes, photo.expected[variant], variant);
          }
          await photos.doc(id).update({ uploadState: "validating", updatedAt: nowIso() });
          for (const variant of VARIANTS) await storage.copy(stageRef(id, photo, variant), retainedRef(id, variant));
          await db.runTransaction(async tx => {
            const [doc, settingsDoc] = await Promise.all([tx.get(photos.doc(id)), tx.get(settingsRef)]);
            const latest = doc.data(), current = { ...defaults, ...settingsDoc.data() };
            const visible = latest.reviewRevision > 0 ? latest.desiredVisible : latest.publication === "publish" || (latest.publication === "follow" && !current.requireApproval);
            tx.update(doc.ref, { uploadState: "ready", reviewState: visible ? "approved" : latest.reviewState,
              desiredVisible: visible, approvalSource: visible ? (latest.publication === "publish" ? "admin" : "automatic") : latest.approvalSource,
              attempts: latest.attempts.map(a => a.id === latest.attempt ? { ...a, settled: { thumbnail: "stored", display: "stored" } } : a),
              policyVersion: current.version, needsReconcile: true, updatedAt: nowIso(), error: null });
          });
        } catch (error) {
          if (error.status === 422) await photos.doc(id).update({ uploadState: "failed", desiredVisible: false, reviewState: "unapproved", error: error.code, updatedAt: nowIso() });
          throw error;
        }
      }
      await reconcile(id);
      return status(id, token, admin);
    } finally { await release(id, owner); }
  }
  async function viewUrl(id, photo, variant, scope) {
    const generation = scope === "public" ? photo.generation : "initial";
    const object = scope === "public" ? publishedRef(id, generation, variant) : retainedRef(id, variant);
    const path = `/images/${scope}/${id}/${generation}/${variant}`;
    const exp = Math.floor(Math.min(Date.now() + LIMITS.viewSeconds * 1000, config.billingEnd) / 1000);
    const capability = await signCapability(config.ticketSecret, { purpose: "view", ...object, scope, path, exp });
    return `${config.workerUrl}${path}?v=${encodeURIComponent(capability)}`;
  }
  async function publicPhoto(id, photo) {
    return { id, thumbnailUrl: await viewUrl(id, photo, "thumbnail", "public"), displayUrl: await viewUrl(id, photo, "display", "public"), width: photo.expected.display.width, height: photo.expected.display.height, publishedAt: photo.publishedAt };
  }
  async function adminPhoto(id, photo) {
    return { id, fileName: photo.fileName, source: photo.source, batchId: photo.batchId, uploadState: photo.uploadState,
      reviewState: photo.reviewState, deliveryState: photo.deliveryState, desiredVisible: photo.desiredVisible,
      createdAt: photo.createdAt, error: photo.error || null,
      ...(photo.uploadState === "ready" ? { thumbnailUrl: await viewUrl(id, photo, "thumbnail", "admin"), displayUrl: await viewUrl(id, photo, "display", "admin") } : {}),
    };
  }
  async function status(id, token, admin = false) {
    const photo = await checkAccess(id, token, admin);
    return { photoId: id, uploadState: photo.uploadState, reviewState: photo.reviewState, deliveryState: photo.deliveryState,
      error: photo.error || null, photo: photo.uploadState === "ready" && photo.reviewState === "approved" && photo.deliveryState === "published" ? await publicPhoto(id, photo) : null };
  }
  async function reconcile(id) {
    const photoRef = photos.doc(id);
    let photo = (await photoRef.get()).data();
    if (photo.uploadState !== "ready") return;
    if (!photo.desiredVisible) {
      if (photo.generation) {
        await photoRef.update({ deliveryState: "unpublishing" });
        for (const variant of VARIANTS) await storage.delete(publishedRef(id, photo.generation, variant));
      }
      await db.runTransaction(async tx => {
        const latest = (await tx.get(photoRef)).data();
        tx.update(photoRef, { deliveryState: "private", generation: null, needsReconcile: latest.desiredVisible, updatedAt: nowIso(), error: null });
      });
      return;
    }
    if (photo.deliveryState === "published" && photo.generation) return;
    // A stable generation per desired revision makes retries overwrite only the
    // same bounded pair. A new revision is not started until old copies are gone.
    const generation = String(photo.reviewRevision);
    if (photo.generation && photo.generation !== generation) {
      for (const variant of VARIANTS) await storage.delete(publishedRef(id, photo.generation, variant));
    }
    await photoRef.update({ deliveryState: "publishing", generation });
    try {
      for (const variant of VARIANTS) await storage.copy(retainedRef(id, variant), publishedRef(id, generation, variant));
      const published = await db.runTransaction(async tx => {
        const latest = (await tx.get(photoRef)).data();
        if (!latest.desiredVisible || latest.reviewRevision !== photo.reviewRevision) return false;
        tx.update(photoRef, { deliveryState: "published", needsReconcile: false, publishedAt: nowIso(), error: null, updatedAt: nowIso() });
        return true;
      });
      if (!published) {
        for (const variant of VARIANTS) await storage.delete(publishedRef(id, generation, variant));
        await photoRef.update({ deliveryState: "private", generation: null });
      }
    } catch (error) {
      await photoRef.update({ deliveryState: "error", error: error.code || "PUBLICATION_FAILED", updatedAt: nowIso() });
      throw error;
    }
  }
  async function moderate(ids, action, username) {
    const results = [];
    for (const id of ids) {
      try {
        await db.runTransaction(async tx => {
          const doc = await tx.get(photos.doc(id)), photo = requireRecord(doc, "Photo");
          if (action === "show" && photo.uploadState !== "ready") throw new ApiError(409, "PHOTO_NOT_READY", "Only validated photos can be shown");
          const visible = action === "show";
          if (photo.desiredVisible === visible && photo.reviewState === (visible ? "approved" : "unapproved")) return;
          tx.update(doc.ref, { desiredVisible: visible, needsReconcile: true, reviewState: visible ? "approved" : "unapproved", reviewRevision: photo.reviewRevision + 1, approvalSource: "admin", moderatedBy: username, updatedAt: nowIso() });
        });
        const owner = await lease(id);
        if (owner) { try { await reconcile(id); } finally { await release(id, owner); } }
        results.push({ id, success: true, pending: !owner });
      } catch (error) { results.push({ id, success: false, error: { code: error.code || "ACTION_FAILED", message: error.status ? error.message : "Please retry this photo" } }); }
    }
    return { results };
  }
  async function detail(id, admin = false) {
    const photo = requireRecord(await photos.doc(id).get(), "Photo");
    if (admin) return adminPhoto(id, photo);
    if (photo.uploadState !== "ready" || photo.reviewState !== "approved" || photo.deliveryState !== "published") throw new ApiError(404, "NOT_FOUND", "This photo is no longer available in the gallery");
    return publicPhoto(id, photo);
  }
  async function list(query, admin = false) {
    let listing = photos.orderBy("__name__");
    if (!admin) listing = listing.where("uploadState", "==", "ready").where("reviewState", "==", "approved").where("deliveryState", "==", "published");
    else {
      if (query.batchId) listing = listing.where("batchId", "==", query.batchId);
      if (query.status === "visible") listing = listing.where("reviewState", "==", "approved").where("deliveryState", "==", "published");
      if (query.status === "hidden") listing = listing.where("reviewState", "==", "unapproved");
      if (query.status === "pending") listing = listing.where("reviewState", "==", "pending");
      if (query.status === "failed") listing = listing.where("uploadState", "==", "failed");
    }
    if (query.after) listing = listing.startAfter(query.after);
    const snapshot = await listing.limit(query.limit + 1).get();
    return { photos: await Promise.all(snapshot.docs.slice(0, query.limit).map(doc => admin ? adminPhoto(doc.id, doc.data()) : publicPhoto(doc.id, doc.data()))), nextCursor: snapshot.size > query.limit ? snapshot.docs[query.limit - 1].id : null };
  }
  async function maintenance(limit = 10) {
    const result = { cleaned: 0, repaired: 0, failed: 0 };
    const due = await photos.where("nextCleanupAt", "<=", Date.now()).orderBy("nextCleanupAt").limit(limit).get();
    for (const doc of due.docs) {
      const owner = await lease(doc.id);
      if (!owner) continue;
      try {
        const photo = (await doc.ref.get()).data(), expired = photo.attempts.filter(a => !a.released && a.expiresAt + 120_000 <= Date.now() && VARIANTS.every(v => !a.claimed?.[v] || a.settled?.[v]));
        for (const attempt of expired) for (const variant of VARIANTS) await storage.delete(stageRef(doc.id, { attempt: attempt.id }, variant));
        const allReleased = photo.attempts.every(a => a.released || expired.some(e => e.id === a.id));
        const closed = allReleased && photo.uploadState !== "ready";
        if (closed) for (const variant of VARIANTS) await storage.delete(retainedRef(doc.id, variant));
        await db.runTransaction(async tx => {
          const [latestDoc, capDoc] = await Promise.all([tx.get(doc.ref), tx.get(capacityRef)]);
          const latest = latestDoc.data(), capacity = capDoc.data();
          const attempts = latest.attempts.map(a => ({ ...a, released: a.released || expired.some(e => e.id === a.id) }));
          const releasedCount = latest.attempts.filter(a => !a.released && attempts.find(b => b.id === a.id).released).length;
          const bytes = latest.expected.thumbnail.bytes + latest.expected.display.bytes;
          const remaining = closed ? 0 : latest.reservedBytes - releasedCount * bytes;
          tx.update(doc.ref, { attempts, stagingReleased: attempts.every(a => a.released), reservedBytes: remaining,
            nextCleanupAt: attempts.filter(a => !a.released).reduce((next, a) => Math.min(next, Math.max(Date.now() + 60_000, a.expiresAt + 120_000)), config.billingEnd + 86400000),
            ...(closed ? { uploadState: latest.uploadState === "failed" ? "failed" : "expired", needsReconcile: false } : {}) });
          tx.update(capacityRef, { reservedBytes: capacity.reservedBytes - (latest.reservedBytes - remaining) });
        });
        result.cleaned++;
      } catch { result.failed++; }
      finally { await release(doc.id, owner); }
    }
    const repairs = await photos.where("needsReconcile", "==", true).where("uploadState", "==", "ready").limit(limit).get();
    for (const doc of repairs.docs) {
      const owner = await lease(doc.id);
      if (!owner) continue;
      try { await reconcile(doc.id); result.repaired++; }
      catch { result.failed++; }
      finally { await release(doc.id, owner); }
    }
    return result;
  }
  async function internalMaintenance(limit, secret) {
    if (!safeEqual(secret, config.claimSecret)) throw new ApiError(403, "FORBIDDEN", "Access denied");
    return maintenance(limit);
  }
  return { policy, settings: adminSettings, patchSettings, createSession, createBatch, authorize, complete, retry, status, claim, receipt, moderate, list, detail, reserveOps, maintenance, internalMaintenance };
}
module.exports = { createGalleryService, safeEqual };
