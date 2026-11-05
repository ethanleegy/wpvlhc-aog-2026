import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestSession } from "../src/guest-session.js";
import { GalleryQueue } from "../src/queue.js";

const start = Date.parse("2026-11-05T12:00:00Z");
const session = (token, time = start + 60_000) => ({ sessionToken: token, expiresAt: new Date(time).toISOString() });
function storage(saved) {
  let value = saved ? JSON.stringify(saved) : null;
  return { getItem: () => value, setItem: (_, next) => { value = next; }, removeItem: () => { value = null; } };
}
test("a reloaded guest restores a valid saved session before authorizing", async () => {
  const getToken = createGuestSession({ api: () => { throw new Error("Should reuse the saved session"); }, storage: () => storage(session("saved-token")), now: () => start });
  assert.equal(await getToken(), "saved-token");
});
test("expired sessions renew once for concurrent uploads and renew again after expiry", async () => {
  let calls = 0, time = start;
  const saved = storage(session("expired", start - 1));
  const getToken = createGuestSession({ storage: () => saved, now: () => time, getVerification: () => "fresh-challenge", api: async (path, body) => {
    assert.equal(path, "/gallery/sessions"); assert.equal(body.turnstileToken, "fresh-challenge");
    calls++; await Promise.resolve(); return session(`token-${calls}`, time + 60_000);
  } });
  assert.deepEqual(await Promise.all([getToken(), getToken()]), ["token-1", "token-1"]); assert.equal(calls, 1);
  time += 60_000;
  assert.equal(await getToken(), "token-2"); assert.equal(calls, 2);
});
test("a late rejection of an old session preserves its already renewed replacement", async () => {
  let calls = 0;
  const saved = storage(session("old-token"));
  const getToken = createGuestSession({ storage: () => saved, now: () => start, api: async () => { calls++; return session("new-token"); } });
  assert.equal(await getToken(), "old-token");
  assert.deepEqual(await Promise.all([getToken({ rejectedToken: "old-token" }), getToken({ rejectedToken: "old-token" })]), ["new-token", "new-token"]);
  assert.equal(await getToken({ rejectedToken: "old-token" }), "new-token"); assert.equal(calls, 1);
});
test("verification failures can retry even when browser storage is unavailable", async () => {
  let calls = 0;
  const getToken = createGuestSession({ storage: () => { throw new Error("Storage blocked"); }, now: () => start, api: async () => {
    if (++calls === 1) throw new Error("Verification unavailable"); return session("fresh-token");
  } });
  await assert.rejects(getToken(), /Verification unavailable/);
  assert.equal(await getToken(), "fresh-token"); assert.equal(await getToken(), "fresh-token"); assert.equal(calls, 2);
});
test("a restored failed upload renews a rejected session without duplicating its request", async () => {
  const bodies = [], renewals = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ uploaded: true });
  const variant = { bytes: 10, mimeType: "image/jpeg", width: 1, height: 1, sha256: "0".repeat(64), blob: new Blob(["fixture"]) };
  try {
    const queue = new GalleryQueue({ getSessionToken: async options => { renewals.push(options); return options?.rejectedToken ? "renewed-token" : "old-token"; }, api: async (path, body) => {
      if (path === "/gallery/uploads") {
        bodies.push(body);
        if (bodies.length === 1) { const error = new Error("Expired session"); error.status = 403; error.code = "SESSION_EXPIRED"; throw error; }
        const transfer = { url: "https://worker.example/upload", mimeType: "image/jpeg", ticket: "test-ticket" };
        return { uploads: [{ photoId: "a".repeat(32), completionToken: "test-completion", variants: { thumbnail: transfer, display: transfer } }] };
      }
      return { uploadState: "ready", reviewState: "approved", deliveryState: "published", photo: { id: "a".repeat(32) } };
    } });
    queue.rows = [{ itemId: "reload-item", requestId: "stable-request", fileName: "photo.jpg", phase: "failed", prepared: { thumbnail: variant, display: variant } }];
    await queue.retryFailed();
    assert.equal(queue.rows[0].phase, "published"); assert.equal(bodies.length, 2);
    assert.deepEqual(bodies.map(body => body.sessionToken), ["old-token", "renewed-token"]);
    assert.equal(bodies[0].requestId, bodies[1].requestId); assert.deepEqual(renewals, [undefined, { rejectedToken: "old-token" }]);
  } finally { globalThis.fetch = originalFetch; }
});
