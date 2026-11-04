import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { signCapability } from "../../../firebase/functions/src/gallery-contract.mjs";

const secret = "worker-test-ticket-".repeat(3), internal = "worker-test-internal-".repeat(3);
const claimed = new Set(); let mf;
const bindings = { TICKET_SECRET: secret, INTERNAL_SECRET: internal, CLAIM_SECRET: "worker-test-claim-".repeat(3), API_BASE: "https://test-api.invalid/v1", ALLOWED_ORIGINS: "https://guest.example", COST_APPROVAL_EXPIRES_AT: new Date(Date.now() + 86400000).toISOString() };
const options = { modules: true, modulesRoot: resolve(import.meta.dirname, "../../.."), scriptPath: resolve(import.meta.dirname, "../../../.gallery-local/worker-build/worker.js"), compatibilityDate: "2026-08-01", r2Buckets: ["PRIVATE", "PUBLISHED"], bindings,
  outboundService: async request => {
    if (request.headers.get("Authorization") !== `Bearer ${bindings.CLAIM_SECRET}`) return Response.json({}, { status: 403 });
    const { ticket } = await request.json();
    if (request.url.endsWith("/upload-results")) return Response.json({ recorded: true });
    if (claimed.has(ticket)) return Response.json({ error: { code: "ATTEMPT_ALREADY_USED" } }, { status: 409 });
    claimed.add(ticket); return Response.json({ claimed: true });
  } };
before(async () => { mf = new Miniflare(convertV4MiniflareOptions(options)); await mf.ready; });
after(async () => { await mf?.dispose(); });
async function uploadTicket(attempt, body) {
  return signCapability(secret, { purpose: "upload", photoId: "a".repeat(32), variant: "display", key: `staging/gala-2026/${"a".repeat(32)}/${attempt}/display`, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), mimeType: "image/jpeg", exp: Math.floor(Date.now() / 1000) + 600, attempt });
}
test("CORS, internal access and unsigned uploads fail closed", async () => {
  assert.equal((await mf.dispatchFetch("https://worker.example/upload", { method: "OPTIONS", headers: { Origin: "https://guest.example" } })).status, 204);
  assert.equal((await mf.dispatchFetch("https://worker.example/upload", { method: "PUT", headers: { Origin: "https://evil.example" }, body: "test" })).status, 403);
  assert.equal((await mf.dispatchFetch("https://worker.example/upload", { method: "PUT", body: "test" })).status, 403);
  assert.equal((await mf.dispatchFetch("https://worker.example/internal/storage", { method: "POST", body: "{}" })).status, 403);
});
test("real R2 uploads enforce checksum, exact length and replay claims", async () => {
  const body = Buffer.from("local-compressed-fixture"), ticket = await uploadTicket("initial", body);
  const send = (ticket, bytes) => mf.dispatchFetch("https://worker.example/upload", { method: "PUT", headers: { "Content-Type": "image/jpeg", "X-Gallery-Ticket": ticket }, body: bytes });
  assert.equal((await send(ticket, body)).status, 200);
  assert.equal((await send(ticket, body)).status, 409);
  const wrongLength = await uploadTicket("length", body);
  assert.equal((await send(wrongLength, Buffer.concat([body, Buffer.from("extra")]))).status, 413);
  const wrongDigest = await uploadTicket("digest", body);
  assert.equal((await send(wrongDigest, Buffer.alloc(body.length, 65))).status, 422);
  const stored = await (await mf.getR2Bucket("PRIVATE")).get(`staging/gala-2026/${"a".repeat(32)}/initial/display`);
  assert.equal(await stored.text(), body.toString());
  assert.equal(await (await mf.getR2Bucket("PRIVATE")).get(`staging/gala-2026/${"a".repeat(32)}/digest/display`), null);
});
test("cached delivery still checks capability expiry and private scope", async () => {
  const id = "b".repeat(32), path = `/images/public/${id}/0/thumbnail`, key = `published/gala-2026/${id}/0/thumbnail`;
  await (await mf.getR2Bucket("PUBLISHED")).put(key, "published-test-photo", { httpMetadata: { contentType: "image/jpeg" } });
  const payload = { purpose: "view", scope: "public", bucket: "published", key, path, exp: Math.floor(Date.now() / 1000) + 300 };
  const token = await signCapability(secret, payload);
  const response = await mf.dispatchFetch(`https://worker.example${path}?v=${token}`);
  assert.equal(response.status, 200); assert.equal(await response.text(), "published-test-photo");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  const expired = await signCapability(secret, { ...payload, exp: Math.floor(Date.now() / 1000) - 1 });
  assert.equal((await mf.dispatchFetch(`https://worker.example${path}?v=${expired}`)).status, 403);
  const privateTicket = await signCapability(secret, { ...payload, bucket: "private", key: `retained/gala-2026/${id}/initial/thumbnail` });
  assert.equal((await mf.dispatchFetch(`https://worker.example${path}?v=${privateTicket}`)).status, 403);
});
test("expired cost review blocks image delivery and writes", async () => {
  await mf.setOptions(convertV4MiniflareOptions({ ...options, bindings: { ...bindings, COST_APPROVAL_EXPIRES_AT: "2020-01-01T00:00:00Z" } }));
  const response = await mf.dispatchFetch("https://worker.example/upload", { method: "PUT", body: "test" });
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "COST_REVIEW_REQUIRED");
});
