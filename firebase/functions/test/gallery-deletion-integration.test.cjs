const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const request = require("supertest"), bcrypt = require("bcryptjs");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createApp } = require("../src/app");
const { createGalleryService } = require("../src/gallery-service");
const { EVENT, LIMITS, verifyCapability } = require("../src/gallery-contract.mjs");
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith("demo-")) throw new Error("Gallery deletion tests require demo Firestore emulation");
let firebaseApp, db, service, app, agent, failDelete, deleteCalls;
const objects = new Map(), key = object => `${object.bucket}:${object.key}`;
const gallery = { local: true, ticketSecret: "delete-ticket-".repeat(4), claimSecret: "delete-claim-".repeat(4), internalSecret: "delete-internal-".repeat(4), workerUrl: "http://localhost:8787", billingStart: Date.now() - 1000, billingEnd: Date.now() + 86400000, turnstileSiteKey: "" };
const config = { local: true, username: "testadmin", passwordHash: bcrypt.hashSync("local-delete-test", 4), jwtSecret: "gallery-delete-auth-".repeat(4), siteUrl: "http://localhost:3000/", origins: ["http://localhost:3000"], gallery };
const factory = (_, reserve) => ({
  async read(object) { await reserve(0, 1); if (!objects.has(key(object))) throw Object.assign(new Error("Incomplete"), { code: "UPLOAD_INCOMPLETE", status: 409 }); return objects.get(key(object)); },
  async copy(source, target) { await reserve(1, 1); objects.set(key(target), objects.get(key(source))); },
  async delete(object) { objects.delete(key(object)); },
  async deleteMany(refs) { deleteCalls++; if (failDelete) throw Object.assign(new Error("Storage unavailable"), { code: "STORAGE_UNAVAILABLE" }); refs.forEach(ref => objects.delete(key(ref))); },
});
const bytes = Buffer.from([255,216,255,192,0,11,8,0,6,0,8,1,1,17,0,255,218,0,2,0,255,217]);
const variant = { width: 8, height: 6, bytes: bytes.length, mimeType: "image/jpeg", sha256: createHash("sha256").update(bytes).digest("hex") };
const mutate = (method, path, body = {}, client = agent) => client[method](`/v1/admin/gallery${path}`).set("X-Admin-Request", "true").send(body);
async function upload(name, source = "guest") {
  const session = source === "guest" ? await service.createSession("", "127.0.0.1") : null;
  const batch = source === "admin" ? await service.createBatch({ requestId: `batch-${name}`, publication: "publish" }, "testadmin") : null;
  const payload = { requestId: `request-${name}`, files: [{ itemId: `item-${name}`, fileName: `${name}.jpg`, thumbnail: variant, display: variant }], ...(session ? { sessionToken: session.sessionToken } : { batchId: batch.id }) };
  const photo = (await service.authorize(payload, source, source === "admin" ? "testadmin" : undefined)).uploads[0];
  return { photo, payload, source };
}
async function publish(upload) {
  for (const name of ["thumbnail", "display"]) {
    const ticket = upload.photo.variants[name].ticket, cap = await verifyCapability(gallery.ticketSecret, ticket, "upload");
    await service.claim(ticket, gallery.claimSecret); objects.set(`private:${cap.key}`, bytes); await service.receipt(ticket, "stored", gallery.claimSecret);
  }
  await service.complete(upload.photo.photoId, upload.photo.completionToken, upload.source === "admin");
}
const capacity = async () => (await db.collection("GalleryCapacity").doc(EVENT).get()).data();
const remove = ids => service.deletePhotos(ids, "delete", "testadmin");
before(async () => {
  firebaseApp = initializeApp({ projectId: `${process.env.GCLOUD_PROJECT}-gallery-delete` }, "gallery-delete"); db = getFirestore(firebaseApp);
  service = createGalleryService(db, config, factory);
  app = createApp({ getDb: () => db, getConfig: () => config, galleryStorageFactory: factory, logger: { error() {} } });
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${firebaseApp.options.projectId}/databases/(default)/documents`, { method: "DELETE" });
  objects.clear(); failDelete = false; deleteCalls = 0;
  agent = request.agent(app);
  await agent.post("/v1/admin/login").set("X-Admin-Request", "true").send({ username: config.username, password: "local-delete-test" }).expect(200);
});
after(async () => { await db?.terminate(); if (firebaseApp) await deleteApp(firebaseApp); });
test("deletion requires an admin session, mutation header, JSON, exact confirmation and bounded IDs", async () => {
  const { photo } = await upload("auth-test");
  await mutate("delete", `/photos/${photo.photoId}`, { confirmation: "delete" }, request(app)).expect(401);
  await agent.delete(`/v1/admin/gallery/photos/${photo.photoId}`).send({ confirmation: "delete" }).expect(403);
  await agent.delete(`/v1/admin/gallery/photos/${photo.photoId}`).set("X-Admin-Request", "true").expect(415);
  await mutate("delete", `/photos/${photo.photoId}`).expect(409);
  await mutate("delete", `/photos/${photo.photoId}`, { confirmation: "DELETE" }).expect(400);
  await mutate("delete", `/photos/${photo.photoId}`, { confirmation: "delete" }).set("Origin", "https://invalid.example").expect(403);
  for (const ids of [[], [photo.photoId, photo.photoId], ["bad"], Array.from({ length: 26 }, (_, i) => i.toString(16).padStart(32, "0"))]) await mutate("post", "/photos/bulk-delete", { confirmation: "delete", photoIds: ids }).expect(400);
  assert.equal((await db.collection("Photos").get()).size, 1); assert.equal(deleteCalls, 0);
});
test("published and hidden guest/admin photos lose every stored variant and release capacity once", async () => {
  const guest = await upload("guest-photo"), admin = await upload("admin-photo", "admin");
  await publish(guest); await publish(admin);
  await service.moderate([admin.photo.photoId], "hide", "testadmin");
  const ids = [guest.photo.photoId, admin.photo.photoId];
  const response = await mutate("post", "/photos/bulk-delete", { photoIds: ids, confirmation: "delete" }).expect(200);
  assert.ok(response.body.results.every(result => result.success && !result.pending));
  assert.equal(objects.size, 0); assert.equal((await db.collection("Photos").get()).size, 0);
  assert.deepEqual(await capacity(), { reservedBytes: 0, photoCount: 0, guestCount: 0, adminCount: 0, pendingDeletionCount: 0 });
  await remove(ids); assert.equal((await capacity()).photoCount, 0); assert.equal(deleteCalls, 2);
  const tombstone = (await db.collection("PhotoDeletions").doc(ids[0]).get()).data();
  assert.deepEqual(Object.keys(tombstone).sort(), ["deletedAt", "deletedBy", "requestedAt", "state"]);
});
test("deleted photos disappear from every view and old upload requests cannot recreate them", async () => {
  const original = await upload("replay-photo"); await publish(original); await remove([original.photo.photoId]);
  assert.equal((await service.list({ limit: 100 }, true)).photos.length, 0);
  assert.equal((await service.list({ limit: 50 })).photos.length, 0);
  await assert.rejects(() => service.detail(original.photo.photoId), { status: 404 });
  await assert.rejects(() => service.complete(original.photo.photoId, original.photo.completionToken), { code: "PHOTO_DELETED", status: 410 });
  await assert.rejects(() => service.retry(original.photo.photoId, original.photo.completionToken), { code: "PHOTO_DELETED" });
  await assert.rejects(() => service.authorize(original.payload, "guest"), { code: "PHOTO_DELETED" });
  const session = await verifyCapability(gallery.ticketSecret, original.payload.sessionToken, "session");
  assert.equal((await db.collection("GallerySessions").doc(session.id).get()).data().photoCount, 1);
  const moderation = await service.moderate([original.photo.photoId], "show", "testadmin"); assert.equal(moderation.results[0].success, false);
  assert.equal((await capacity()).photoCount, 0);
});
test("in-flight transfers keep their reservation until a late successful receipt permits cleanup", async () => {
  const { photo } = await upload("inflight-photo"), ticket = photo.variants.thumbnail.ticket;
  await service.claim(ticket, gallery.claimSecret);
  const before = await capacity(), result = await remove([photo.photoId]);
  assert.equal(result.results[0].pending, true); assert.equal((await capacity()).reservedBytes, before.reservedBytes);
  assert.equal((await capacity()).pendingDeletionCount, 1); assert.equal(deleteCalls, 0);
  await assert.rejects(() => service.claim(photo.variants.display.ticket, gallery.claimSecret));
  const cap = await verifyCapability(gallery.ticketSecret, ticket, "upload"); objects.set(`private:${cap.key}`, bytes);
  await service.receipt(ticket, "stored", gallery.claimSecret);
  const maintenance = await service.maintenance(); assert.equal(maintenance.deleted, 1); assert.equal(objects.size, 0);
  assert.equal((await capacity()).reservedBytes, 0); assert.equal((await capacity()).photoCount, 0);
  await service.receipt(ticket, "stored", gallery.claimSecret); // Late duplicate cannot recreate anything.
});
test("uncertain transfer failures defer cleanup through ticket expiry and grace", async () => {
  const { photo } = await upload("uncertain-photo"), ticket = photo.variants.thumbnail.ticket;
  await service.claim(ticket, gallery.claimSecret); await remove([photo.photoId]); await service.receipt(ticket, "failed", gallery.claimSecret);
  const jobRef = db.collection("PhotoDeletions").doc(photo.photoId), job = (await jobRef.get()).data();
  assert.ok(job.notBefore > Date.now()); await service.maintenance(); assert.equal(deleteCalls, 0);
  await jobRef.update({ notBefore: Date.now() - 1, nextCleanupAt: Date.now() - 1 });
  assert.equal((await service.maintenance()).deleted, 1); assert.equal((await capacity()).reservedBytes, 0);
});
test("storage failures retain capacity and maintenance safely retries after counters hit their operation limit", async () => {
  const { photo } = await upload("storage-error"); await publish({ photo, source: "guest" });
  await db.collection("GalleryUsage").doc(String(gallery.billingStart)).set({ writes: LIMITS.monthlyWrites, reads: LIMITS.monthlyReads });
  const before = await capacity(); failDelete = true;
  assert.equal((await remove([photo.photoId])).results[0].pending, true);
  assert.equal((await capacity()).reservedBytes, before.reservedBytes);
  failDelete = false;
  await db.collection("PhotoDeletions").doc(photo.photoId).update({ nextCleanupAt: Date.now() - 1 });
  assert.equal((await service.maintenance()).deleted, 1); assert.equal(objects.size, 0); assert.equal((await capacity()).reservedBytes, 0);
});
test("busy photos can retry, concurrent deletions are idempotent, and missing IDs do not affect other photos", async () => {
  const first = await upload("busy-photo"), other = await upload("untouched-photo");
  await db.collection("Photos").doc(first.photo.photoId).update({ lease: { owner: "busy-worker", expiresAt: Date.now() + 60_000 } });
  assert.equal((await remove([first.photo.photoId])).results[0].error.code, "PHOTO_BUSY");
  assert.equal((await db.collection("Photos").doc(first.photo.photoId).get()).exists, true);
  await db.collection("Photos").doc(first.photo.photoId).update({ lease: null });
  await Promise.all([remove([first.photo.photoId]), remove([first.photo.photoId])]);
  assert.equal((await remove(["f".repeat(32)])).results[0].missing, true);
  assert.equal((await capacity()).photoCount, 1); assert.equal((await capacity()).pendingDeletionCount, 0);
  assert.equal((await db.collection("Photos").doc(other.photo.photoId).get()).exists, true);
});
test("expired and failed upload records can be removed even after staging bytes were already released", async () => {
  const ids = [];
  for (const state of ["expired", "failed"]) {
    const { photo } = await upload(`${state}-photo`); ids.push(photo.photoId);
    await db.collection("Photos").doc(photo.photoId).update({ uploadState: state, reservedBytes: 0 });
  }
  await db.collection("GalleryCapacity").doc(EVENT).update({ reservedBytes: 0 });
  await remove(ids); assert.equal((await capacity()).photoCount, 0); assert.equal((await capacity()).reservedBytes, 0);
});
test("cleanup covers both the recorded generation and a pending publication revision", async () => {
  const { photo } = await upload("revision-photo");
  await db.collection("Photos").doc(photo.photoId).update({ generation: "4", reviewRevision: 5, deliveryState: "error" });
  for (const generation of ["4", "5"]) for (const variant of ["thumbnail", "display"]) objects.set(`published:published/${EVENT}/${photo.photoId}/${generation}/${variant}`, bytes);
  await remove([photo.photoId]); assert.equal(objects.size, 0); assert.equal((await capacity()).reservedBytes, 0);
});
