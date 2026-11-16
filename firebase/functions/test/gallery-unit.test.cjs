const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { loadGalleryConfig, assertGallery } = require("../src/gallery-config");
const { verifyImage } = require("../src/gallery-image");
const { signCapability, verifyCapability } = require("../src/gallery-contract.mjs");

function image(width = 8, height = 6) {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, height, 0, width, 1, 1, 0x11, 0, 0xff, 0xda, 0, 2, 0, 0xff, 0xd9]);
  return { buffer, expected: { width, height, bytes: buffer.length, mimeType: "image/jpeg", sha256: createHash("sha256").update(buffer).digest("hex") } };
}
test("gallery capabilities reject tampering, wrong purposes and expiry", async () => {
  const secret = "unit-ticket-only-".repeat(4), payload = { purpose: "upload", photoId: "a".repeat(32), exp: Math.floor(Date.now() / 1000) + 60 };
  const ticket = await signCapability(secret, payload);
  assert.equal((await verifyCapability(secret, ticket, "upload")).photoId, payload.photoId);
  for (const [token, purpose, now] of [[`${ticket}x`, "upload"], [ticket, "view"], [ticket, "upload", Date.now() + 120_000]])
    await assert.rejects(() => verifyCapability(secret, token, purpose, now));
});
test("image checks enforce actual bytes, digest, dimensions and metadata rejection", () => {
  const { buffer, expected } = image();
  assert.equal(verifyImage(buffer, expected, "thumbnail").width, 8);
  for (const invalid of [{ ...expected, bytes: expected.bytes + 1 }, { ...expected, width: 9 }, { ...expected, sha256: "a".repeat(64) }])
    assert.throws(() => verifyImage(buffer, invalid, "thumbnail"), { status: 422 });
  const tagged = Buffer.concat([buffer.subarray(0, 2), Buffer.from([0xff, 0xe1, 0, 4, 0, 0]), buffer.subarray(2)]);
  assert.throws(() => verifyImage(tagged, { ...expected, bytes: tagged.length, sha256: createHash("sha256").update(tagged).digest("hex") }, "display"), { status: 422 });
  assert.throws(() => verifyImage(Buffer.alloc(500001), expected, "display"), { status: 422 });
});
test("gallery is opt in and stops at its approved billing period", () => {
  assert.equal(loadGalleryConfig({}, false), null);
  assert.throws(() => assertGallery(null), { code: "GALLERY_DISABLED" });
  assert.throws(() => assertGallery({ billingStart: Date.now() - 1000, billingEnd: Date.now() - 1 }), { code: "COST_REVIEW_REQUIRED" });
  assert.throws(() => loadGalleryConfig({ GALLERY_ENABLED: "true" }, false), /requires at least/);
});
module.exports = { image };
test("free storage deletions do not consume or require the read/write operation budget", async () => {
  const { createGalleryStorage } = require("../src/gallery-storage");
  const previous = global.fetch, commands = [];
  global.fetch = async (_, options) => { commands.push(JSON.parse(options.body)); return Response.json({ deleted: true }); };
  try {
    const storage = createGalleryStorage({ workerUrl: "https://worker.example", internalSecret: "unit-test-only" }, () => { throw new Error("Read/write budget must not be used for deletion"); });
    const object = { bucket: "private", key: "test-object" };
    await storage.delete(object); await storage.deleteMany([object]);
    assert.deepEqual(commands.map(command => command.action), ["delete", "delete-many"]);
  } finally { global.fetch = previous; }
});
