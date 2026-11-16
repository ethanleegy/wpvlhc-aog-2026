import { test, expect } from "@playwright/test";

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGMMqHBjwAaYsIoOWgkA1+YBHmKFY/QAAAAASUVORK5CYII=", "base64");
const turnstileMock = `
window.verificationTest = { resets: 0,
  success(token) { this.options.callback(token); },
  expire() { this.options['expired-callback'](); },
  fail(code = 'test-error') { this.options['error-callback'](code); },
  timeout() { this.options['timeout-callback'](); },
  interactive() { this.options['before-interactive-callback'](); },
  finishedInteracting() { this.options['after-interactive-callback'](); },
  unsupported() { this.options['unsupported-callback'](); }
};
window.turnstile = {
  render(element, options) { window.verificationTest.options = options; element.textContent = 'Verifying…'; element.style.minWidth = options.size === 'compact' ? '150px' : '300px'; return 'test-widget'; },
  reset() { window.verificationTest.resets++; }
};`;

async function fixture(page, { rejectSession = false, delaySession = false, savedSession = false, rejectSavedSession = false, failTransfer = false, failScript = false, delayScript = false, verificationRequired = true } = {}) {
  const calls = { sessions: [], uploads: [], puts: [], scripts: 0 }, photos = new Map();
  let transferFailed = false, sessionRejected = false;
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  if (savedSession) await page.addInitScript(() => localStorage.setItem("wpvlhc-gallery-session", JSON.stringify({ sessionToken: "saved-session", expiresAt: new Date(Date.now() + 60_000).toISOString() })));
  // No requests from this suite reach Firebase, Cloudflare or external image storage.
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:5187") return route.continue();
    const json = (data, status = 200) => route.fulfill({ json: data, status });
    if (url.hostname === "challenges.cloudflare.com") {
      calls.scripts++;
      if (failScript && calls.scripts === 1) return route.abort();
      if (delayScript && calls.scripts === 1) await new Promise(resolve => { calls.releaseScript = resolve; });
      return route.fulfill({ contentType: "application/javascript", body: turnstileMock });
    }
    if (url.origin === "https://gallery-storage.test") {
      if (request.method() !== "PUT") return route.fulfill({ contentType: "image/png", body: tinyPng });
      calls.puts.push({ url: url.href, bytes: request.postDataBuffer().length, mime: request.headers()["content-type"] });
      if (failTransfer && !transferFailed) { transferFailed = true; return json({ error: { code: "TEST_INTERRUPTION", message: "Transfer interrupted" } }, 401); }
      const [, id, variant] = url.pathname.split("/"); photos.get(id).received.add(variant);
      return json({ uploaded: true });
    }
    if (url.origin !== "http://127.0.0.1:5999" || !url.pathname.startsWith("/v1/gallery/")) return route.abort();
    const path = url.pathname.slice("/v1/gallery".length);
    if (path === "/policy") return json({ enabled: true, requireApproval: false, guestUploadsOpen: true, turnstileSiteKey: verificationRequired ? "mock-site-key" : "" });
    if (path === "/photos") return json({ photos: [], nextCursor: null });
    if (path === "/sessions") {
      const body = request.postDataJSON(); calls.sessions.push(body);
      if (delaySession) await new Promise(resolve => { calls.releaseSession = resolve; });
      if (verificationRequired && !body.turnstileToken || rejectSession && calls.sessions.length === 1) return json({ error: { code: "VERIFICATION_REQUIRED", message: "Please complete the photo-sharing verification" } }, 403);
      return json({ sessionToken: "fresh-session", expiresAt: new Date(Date.now() + 86400_000).toISOString() }, 201);
    }
    if (path === "/uploads") {
      const body = request.postDataJSON(); calls.uploads.push(body);
      if (rejectSavedSession && body.sessionToken === "saved-session" && !sessionRejected) { sessionRejected = true; return json({ error: { code: "SESSION_EXPIRED", message: "Please reopen photo sharing" } }, 403); }
      const id = String(photos.size + 1).padStart(32, "0");
      const variants = Object.fromEntries(["thumbnail", "display"].map(variant => [variant, { url: `https://gallery-storage.test/${id}/${variant}`, ticket: "mock-ticket", mimeType: body.files[0][variant].mimeType }]));
      const upload = { photoId: id, completionToken: "mock-completion", variants };
      photos.set(id, { upload, received: new Set() }); return json({ uploads: [upload] });
    }
    const match = path.match(/^\/uploads\/(\d{32})\/(complete|retry)$/);
    if (match) {
      const photo = photos.get(match[1]);
      if (match[2] === "retry") return json(photo.upload);
      if (photo.received.size < 2) return json({ error: { code: "UPLOAD_INCOMPLETE", message: "Transfer unfinished" } }, 409);
      return json({ uploadState: "ready", reviewState: "approved", deliveryState: "published", photo: { id: match[1], thumbnailUrl: `https://gallery-storage.test/${match[1]}/image`, width: 8, height: 8 } });
    }
    throw new Error(`Unexpected gallery fixture request: ${path}`);
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Choose photos", exact: true })).toBeEnabled();
  if (verificationRequired && !failScript && !delayScript) await page.waitForFunction(() => !!window.verificationTest?.options);
  return { calls, errors, photos };
}
async function choose(page, count = 2) {
  const previous = await page.locator(".selection img").count();
  await page.locator("input[type=file]").nth(1).setInputFiles(Array.from({ length: count }, (_, index) => ({ name: `mobile-photo-${index}.png`, mimeType: "image/png", buffer: tinyPng })));
  await expect(page.locator(".selection img")).toHaveCount(previous + count);
  await expect(page.locator(".selection")).not.toContainText("Preparing on your device");
}
const verify = (page, token = "completed-challenge") => page.evaluate(token => window.verificationTest.success(token), token);
const share = page => page.getByRole("button", { name: "Share photos", exact: true });

test("mobile photos wait for verification, then share through one session", async ({ page }, testInfo) => {
  const { calls, errors } = await fixture(page);
  await choose(page);
  await expect(page.locator(".selection")).toContainText("Ready to share");
  await expect(share(page)).toBeDisabled();
  // Also guard non-button entry points while verification is pending.
  await share(page).evaluate(button => button.onclick());
  expect(calls.sessions).toEqual([]); expect(calls.uploads).toEqual([]);
  await expect(page.getByRole("status").filter({ hasText: "Waiting for photo-sharing verification" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-verification-waiting.png"), fullPage: true });
  await verify(page); await expect(share(page)).toBeEnabled(); await share(page).click();
  await expect(page.locator(".status")).toContainText("2 of 2 shared");
  expect(calls.sessions).toEqual([{ turnstileToken: "completed-challenge" }]);
  expect(calls.uploads).toHaveLength(2); expect(calls.puts).toHaveLength(4);
  expect(calls.puts.every(put => put.bytes <= 500_000 && ["image/webp", "image/jpeg"].includes(put.mime))).toBe(true);
  expect(await page.evaluate(() => window.verificationTest.resets)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("a stale challenge refreshes before sharing without losing photos", async ({ page }) => {
  await page.clock.install();
  const { calls, errors } = await fixture(page);
  await verify(page, "old-challenge"); await choose(page); await expect(share(page)).toBeEnabled();
  await page.clock.fastForward(290_001);
  await expect(share(page)).toBeDisabled();
  expect(await page.evaluate(() => window.verificationTest.resets)).toBe(1);
  expect(calls.sessions).toEqual([]);
  await expect(page.locator(".selection")).not.toContainText("Needs a retry");
  await verify(page, "new-challenge"); await share(page).click();
  await expect(page.locator(".status")).toContainText("2 of 2 shared");
  expect(calls.sessions).toEqual([{ turnstileToken: "new-challenge" }]); expect(errors).toEqual([]);
});

test("an expiry callback disables sharing until Cloudflare supplies a fresh challenge", async ({ page }) => {
  const { calls, errors } = await fixture(page);
  await choose(page); await verify(page, "expired-challenge"); await expect(share(page)).toBeEnabled();
  await page.evaluate(() => window.verificationTest.expire());
  await expect(share(page)).toBeDisabled(); expect(calls.sessions).toEqual([]);
  await verify(page, "fresh-challenge"); await share(page).click();
  await expect(page.locator(".status")).toContainText("2 of 2 shared");
  expect(calls.sessions).toEqual([{ turnstileToken: "fresh-challenge" }]); expect(errors).toEqual([]);
});

test("a pending session request does not reset its already submitted verification", async ({ page }) => {
  const { calls, errors } = await fixture(page, { delaySession: true });
  await choose(page, 1); await verify(page);
  await share(page).click();
  await expect.poll(() => calls.sessions.length).toBe(1);
  // A new selection causes a UI update while the session request is in flight.
  await choose(page, 2);
  await expect(page.locator(".selection img")).toHaveCount(3);
  expect(await page.evaluate(() => window.verificationTest.resets)).toBe(0);
  calls.releaseSession();
  await expect(page.locator(".status")).toContainText("3 of 3 shared");
  expect(calls.sessions).toHaveLength(1); expect(errors).toEqual([]);
});

test("a rejected verification restarts once and preserves the whole batch", async ({ page }) => {
  const { calls, errors } = await fixture(page, { rejectSession: true });
  await choose(page); await verify(page, "rejected-challenge"); await share(page).click();
  await expect(page.locator(".status")).toContainText("Please complete the photo-sharing verification");
  await expect(share(page)).toBeDisabled();
  expect(await page.evaluate(() => window.verificationTest.resets)).toBe(1);
  expect(calls.uploads).toEqual([]);
  await expect(page.locator(".selection").getByText("Ready to share", { exact: true })).toHaveCount(2);
  await verify(page, "replacement-challenge"); await share(page).click();
  await expect(page.locator(".status")).toContainText("2 of 2 shared");
  expect(calls.sessions.map(call => call.turnstileToken)).toEqual(["rejected-challenge", "replacement-challenge"]);
  expect(calls.uploads).toHaveLength(2); expect(errors).toEqual([]);
});

test("challenge errors and timeouts offer recovery without photo failures", async ({ page }) => {
  const { calls, errors } = await fixture(page);
  await choose(page, 1); await page.evaluate(() => window.verificationTest.fail());
  await expect(page.getByRole("status").filter({ hasText: "could not finish" })).toBeVisible();
  await expect(share(page)).toBeDisabled(); await page.getByRole("button", { name: "Retry verification", exact: true }).click();
  await page.evaluate(() => window.verificationTest.timeout());
  await expect(page.getByRole("status").filter({ hasText: "timed out" })).toBeVisible();
  await page.getByRole("button", { name: "Retry verification", exact: true }).click();
  expect(await page.evaluate(() => window.verificationTest.resets)).toBe(2);
  expect(calls.sessions).toEqual([]);
  await verify(page); await share(page).click();
  await expect(page.locator(".status")).toContainText("1 of 1 shared"); expect(errors).toEqual([]);
});

test("waiting for a person's checkbox does not trigger the automatic-check watchdog", async ({ page }) => {
  await page.clock.install();
  const { calls, errors } = await fixture(page);
  await choose(page, 1); await page.evaluate(() => window.verificationTest.interactive());
  await expect(page.getByRole("status").filter({ hasText: "complete the Cloudflare checkbox" })).toBeVisible();
  await page.clock.fastForward(45_000);
  await expect(page.getByRole("button", { name: "Retry verification", exact: true })).toBeHidden();
  await expect(share(page)).toBeDisabled(); expect(calls.sessions).toEqual([]);
  await page.evaluate(() => window.verificationTest.finishedInteracting());
  await verify(page); await share(page).click();
  await expect(page.locator(".status")).toContainText("1 of 1 shared"); expect(errors).toEqual([]);
});

test("a real challenge rejection exposes its reference and keeps photos ready", async ({ page }) => {
  const { calls, errors } = await fixture(page);
  await choose(page, 1); await page.evaluate(() => window.verificationTest.fail('600010'));
  await expect(page.getByRole("status").filter({ hasText: "Cloudflare could not verify this browser" })).toContainText("Reference: 600010");
  await expect(share(page)).toBeDisabled(); expect(calls.sessions).toEqual([]);
  await expect(page.locator(".selection")).toContainText("Ready to share");
  await page.getByRole("button", { name: "Retry verification", exact: true }).click();
  await verify(page); await share(page).click();
  await expect(page.locator(".status")).toContainText("1 of 1 shared"); expect(errors).toEqual([]);
});

test("hostname errors and unsupported browsers give actionable messages", async ({ page }) => {
  const { calls, errors } = await fixture(page);
  await page.evaluate(() => window.verificationTest.fail('110200'));
  await expect(page.getByRole("status").filter({ hasText: "not enabled for this website" })).toContainText("Reference: 110200");
  await page.getByRole("button", { name: "Retry verification", exact: true }).click();
  await page.evaluate(() => window.verificationTest.unsupported());
  await expect(page.getByRole("status").filter({ hasText: "up-to-date Chrome or Safari" })).toBeVisible();
  expect(calls.sessions).toEqual([]); expect(errors).toEqual([]);
});

test("the verification widget fits a smaller phone without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const { errors } = await fixture(page);
  expect(await page.evaluate(() => window.verificationTest.options.size)).toBe("compact");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("a hidden widget also fits a small phone when a saved session is rejected", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const { errors } = await fixture(page, { savedSession: true, rejectSavedSession: true });
  await choose(page, 1); await share(page).click();
  await expect(share(page)).toBeDisabled();
  expect(await page.evaluate(() => window.verificationTest.options.size)).toBe("compact");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("a verification script load failure can retry without refreshing the page", async ({ page }) => {
  const { calls, errors } = await fixture(page, { failScript: true });
  await choose(page, 1);
  await expect(page.getByRole("status").filter({ hasText: "could not load" })).toBeVisible();
  await page.getByRole("button", { name: "Retry verification", exact: true }).click();
  await page.waitForFunction(() => !!window.verificationTest?.options);
  await verify(page); await share(page).click();
  await expect(page.locator(".status")).toContainText("1 of 1 shared");
  expect(calls.scripts).toBe(2); expect(calls.sessions).toHaveLength(1); expect(errors).toEqual([]);
});

test("a slow script shows a retry message and can still finish loading", async ({ page }) => {
  await page.clock.install();
  const { calls, errors } = await fixture(page, { delayScript: true });
  await choose(page, 1); await page.clock.fastForward(30_001);
  await expect(page.getByRole("status").filter({ hasText: "taking longer than expected" })).toBeVisible();
  await page.getByRole("button", { name: "Retry verification", exact: true }).click();
  calls.releaseScript();
  await page.waitForFunction(() => !!window.verificationTest?.options);
  await verify(page); await share(page).click();
  await expect(page.locator(".status")).toContainText("1 of 1 shared");
  expect(calls.scripts).toBe(1); expect(errors).toEqual([]);
});

test("a saved valid session shares without waiting for another challenge", async ({ page }) => {
  const { calls, errors } = await fixture(page, { savedSession: true });
  await choose(page); await expect(share(page)).toBeEnabled(); await share(page).click();
  await expect(page.locator(".status")).toContainText("2 of 2 shared");
  expect(calls.sessions).toEqual([]);
  expect(calls.uploads.every(call => call.sessionToken === "saved-session")).toBe(true); expect(errors).toEqual([]);
});

test("a rejected saved session waits for a fresh challenge and reuses the photo request", async ({ page }) => {
  const { calls, errors } = await fixture(page, { savedSession: true, rejectSavedSession: true });
  await choose(page, 1); await share(page).click();
  await expect(share(page)).toBeDisabled();
  await expect(page.locator(".selection")).toContainText("Ready to share");
  expect(calls.sessions).toEqual([]);
  await verify(page, "renewal-challenge"); await share(page).click();
  await expect(page.locator(".status")).toContainText("1 of 1 shared");
  expect(calls.sessions).toEqual([{ turnstileToken: "renewal-challenge" }]);
  expect(calls.uploads).toHaveLength(2); expect(calls.uploads[0].requestId).toBe(calls.uploads[1].requestId);
  expect(errors).toEqual([]);
});

test("retrying an authorized transfer works after session expiry without a new challenge", async ({ page }) => {
  await page.clock.install();
  const { calls, errors, photos } = await fixture(page, { savedSession: true, failTransfer: true });
  await choose(page, 1); await share(page).click();
  const retry = page.getByRole("button", { name: "Retry failed photos", exact: true });
  await expect(retry).toBeVisible();
  await page.clock.fastForward(61_000); await retry.click();
  await expect(page.locator(".status")).toContainText("1 of 1 shared");
  expect(calls.sessions).toEqual([]); expect(calls.uploads).toHaveLength(1); expect(photos.size).toBe(1); expect(errors).toEqual([]);
});

test("restored failed photos wait for verification before retrying their original requests", async ({ page }) => {
  const { calls, errors } = await fixture(page);
  await choose(page);
  const originalRequests = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("wpvlhc-gallery-queue-v1", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      // Wait for the page's debounced persistence to finish before simulating the
      // verification failures saved by the previous gallery version.
      let saved;
      for (let attempt = 0; attempt < 100; attempt++) {
        saved = await new Promise(resolve => { const request = db.transaction("queues").objectStore("queues").get("guest:http://127.0.0.1:5999/v1"); request.onsuccess = () => resolve(request.result); });
        if (saved?.rows.length === 2 && saved.rows.every(row => row.prepared)) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (!saved?.rows.every(row => row.prepared)) throw new Error("Prepared photos were not persisted");
      saved.rows.forEach(row => { row.phase = "failed"; row.error = "Please complete the photo-sharing verification"; });
      await new Promise((resolve, reject) => { const tx = db.transaction("queues", "readwrite"); tx.objectStore("queues").put(saved, "guest:http://127.0.0.1:5999/v1"); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      return saved.rows.map(row => row.requestId);
    } finally { db.close(); }
  });
  await page.reload();
  const retry = page.getByRole("button", { name: "Retry failed photos", exact: true });
  await expect(retry).toBeVisible(); await expect(retry).toBeDisabled();
  expect(calls.sessions).toEqual([]);
  await verify(page, "retry-challenge"); await retry.click();
  await expect(page.locator(".status")).toContainText("2 of 2 shared");
  expect(calls.sessions).toEqual([{ turnstileToken: "retry-challenge" }]);
  expect(calls.uploads.map(call => call.requestId)).toEqual(originalRequests); expect(errors).toEqual([]);
});

test("the local development flow still shares when verification is disabled", async ({ page }) => {
  const { calls, errors } = await fixture(page, { verificationRequired: false });
  await choose(page, 1); await expect(share(page)).toBeEnabled(); await share(page).click();
  await expect(page.locator(".status")).toContainText("1 of 1 shared");
  expect(calls.scripts).toBe(0); expect(calls.sessions).toEqual([{ turnstileToken: "" }]); expect(errors).toEqual([]);
});
