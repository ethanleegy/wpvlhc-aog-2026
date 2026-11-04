const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createGalleryService } = require("../src/gallery-service");
const { LIMITS } = require("../src/gallery-contract.mjs");
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith("demo-")) throw new Error("Gallery integration requires demo Firestore emulation");
let app, db, service;
const objects = new Map();
const config = { local: true, ticketSecret: "test-ticket-".repeat(4), claimSecret: "test-claim-".repeat(4), internalSecret: "test-internal-".repeat(4), workerUrl: "http://localhost:8787", billingStart: Date.now() - 1000, billingEnd: Date.now() + 86400000, turnstileSiteKey: "" };
const key = object => `${object.bucket}:${object.key}`;
const factory = (config, reserve) => ({
  async read(object) { await reserve(0, 1); if (!objects.has(key(object))) throw Object.assign(new Error("Unfinished"), { status: 409, code: "UPLOAD_INCOMPLETE" }); return objects.get(key(object)); },
  async copy(source, target) { await reserve(1, 1); if (!objects.has(key(source))) throw new Error("Missing"); objects.set(key(target), objects.get(key(source))); },
  async delete(object) { await reserve(0, 0); objects.delete(key(object)); },
});
const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 6, 0, 8, 1, 1, 0x11, 0, 0xff, 0xda, 0, 2, 0, 0xff, 0xd9]);
const variant = { width: 8, height: 6, bytes: buffer.length, mimeType: "image/jpeg", sha256: createHash("sha256").update(buffer).digest("hex") };
const file = itemId => ({ itemId, fileName: "fixture.jpg", thumbnail: variant, display: variant });
async function authorize(requestId, source = "guest", extra = {}) {
  const session = source === "guest" ? await service.createSession("", "127.0.0.1") : null;
  const payload = { requestId, files: [file(requestId)], ...(session ? { sessionToken: session.sessionToken } : {}), ...extra };
  const result = await service.authorize(payload, source, source === "admin" ? "testadmin" : undefined);
  return { payload, upload: result.uploads[0] };
}
async function store(upload) {
  const { verifyCapability } = require("../src/gallery-contract.mjs");
  for (const name of ["thumbnail", "display"]) {
    const ticket = upload.variants[name].ticket;
    await service.claim(ticket, config.claimSecret);
    const decoded = await verifyCapability(config.ticketSecret, ticket, "upload");
    objects.set(key({ bucket: "private", key: decoded.key }), buffer);
    await service.receipt(ticket, "stored", config.claimSecret);
  }
}
before(async () => {
  app = initializeApp({ projectId: `${process.env.GCLOUD_PROJECT}-gallery` }, "gallery-integration"); db = getFirestore(app);
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${app.options.projectId}/databases/(default)/documents`, { method: "DELETE" });
  service = createGalleryService(db, { gallery: config, siteUrl: "http://localhost:3000/" }, factory);
});
after(async () => { await db?.terminate(); if (app) await deleteApp(app); });
test("automatic publication, completion retries, hide/show and prior approval", async () => {
  const { payload, upload } = await authorize("first-photo-01");
  assert.equal((await service.authorize(payload, "guest")).uploads[0].photoId, upload.photoId);
  await store(upload);
  const completed = await service.complete(upload.photoId, upload.completionToken);
  assert.equal(completed.deliveryState, "published"); assert.ok(completed.photo.thumbnailUrl.includes("/images/public/"));
  const copies = objects.size;
  assert.equal((await service.complete(upload.photoId, upload.completionToken)).photo.id, upload.photoId); assert.equal(objects.size, copies);
  await service.moderate([upload.photoId], "hide", "testadmin");
  await assert.rejects(() => service.detail(upload.photoId), { code: "NOT_FOUND" });
  assert.equal((await service.list({ limit: 20 })).photos.length, 0);
  assert.ok((await service.list({ limit: 20, status: "hidden" }, true)).photos[0].thumbnailUrl.includes("/images/admin/"));
  await service.patchSettings({ requireApproval: true }, "testadmin");
  const pending = (await authorize("pending-photo-01")).upload; await store(pending);
  assert.equal((await service.complete(pending.photoId, pending.completionToken)).reviewState, "pending");
  await service.patchSettings({ requireApproval: false }, "testadmin");
  assert.equal((await service.list({ limit: 20 })).photos.length, 0);
  await service.moderate([upload.photoId, pending.photoId], "show", "testadmin");
  assert.equal((await service.list({ limit: 20 })).photos.length, 2);
});
test("concurrent replay claims consume at most one billable write", async () => {
  const { upload } = await authorize("claim-photo-01");
  const ticket = upload.variants.thumbnail.ticket;
  const results = await Promise.allSettled([service.claim(ticket, config.claimSecret), service.claim(ticket, config.claimSecret)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "ATTEMPT_ALREADY_USED");
  await assert.rejects(() => service.claim(upload.variants.display.ticket, "wrong-secret"), { code: "FORBIDDEN" });
});
test("guest closure leaves admin batches open and publication overrides explicit", async () => {
  await service.patchSettings({ guestUploadsOpen: false, requireApproval: true }, "testadmin");
  await assert.rejects(() => service.createSession("", "127.0.0.1"), { code: "UPLOADS_CLOSED" });
  const batch = await service.createBatch({ requestId: "admin-batch-01", publication: "publish" }, "testadmin");
  const { upload } = await authorize("admin-photo-01", "admin", { batchId: batch.id }); await store(upload);
  assert.equal((await service.complete(upload.photoId, null, true)).deliveryState, "published");
});
test("operation and storage budgets fail closed before further work", async () => {
  const usage = db.collection("GalleryUsage").doc(String(config.billingStart));
  const original = (await usage.get()).data(); await usage.set({ ...original, writes: LIMITS.monthlyWrites });
  await assert.rejects(() => service.reserveOps(1, 0), { code: "OPERATION_LIMIT_REACHED" });
  await usage.set(original);
  const cap = db.collection("GalleryCapacity").doc("gala-2026"), prior = (await cap.get()).data(); await cap.set({ ...prior, reservedBytes: LIMITS.storageBytes });
  const batch = await service.createBatch({ requestId: "limit-batch-01", publication: "review" }, "testadmin");
  await assert.rejects(() => authorize("over-budget-01", "admin", { batchId: batch.id }), { code: "STORAGE_LIMIT_REACHED" });
  await cap.set(prior);
});
