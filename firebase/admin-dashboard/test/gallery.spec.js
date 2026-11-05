import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const apiBase = "http://127.0.0.1:5999/v1";
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGMMqHBjwAaYsIoOWgkA1+YBHmKFY/QAAAAASUVORK5CYII=", "base64");
test("device compression, automatic publication, bulk hide/show, prior approval and admin batch", async ({ browser, request }) => {
  const admin = await browser.newPage(); await admin.goto("http://127.0.0.1:5173/");
  await admin.getByLabel("Username", { exact: true }).fill("localadmin"); await admin.getByLabel("Password", { exact: true }).fill("local-gallery-only"); await admin.getByRole("button", { name: "Sign in →" }).click();
  await expect(admin.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  const reset = await admin.request.patch("http://127.0.0.1:5173/v1/admin/gallery/settings", { headers: { "X-Admin-Request": "true" }, data: { requireApproval: false, guestUploadsOpen: true, adminUploadsOpen: true } });
  expect(reset.status()).toBe(200);
  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; guest.on("pageerror", error => errors.push(error.message));
  await guest.goto("http://127.0.0.1:5174/");
  await expect(guest.getByRole("button", { name: "Choose photos", exact: true })).toBeEnabled();
  const dataUrl = await guest.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 2400; canvas.height = 1800;
    const context = canvas.getContext("2d"), gradient = context.createLinearGradient(0, 0, 2400, 1800);
    gradient.addColorStop(0, "#b17a40"); gradient.addColorStop(1, "#153b2b"); context.fillStyle = gradient; context.fillRect(0, 0, 2400, 1800);
    context.fillStyle = "white"; context.font = "100px sans-serif"; context.fillText("Christmas Gala · local test", 120, 900);
    return canvas.toDataURL("image/png");
  });
  const buffer = Buffer.from(dataUrl.split(",")[1], "base64"), suffix = Date.now().toString(36);
  const upload = { name: `guest-${suffix}.png`, mimeType: "image/png", buffer };
  const puts = []; guest.on("request", req => { if (req.method() === "PUT") puts.push({ mime: req.headers()["content-type"] }); });
  await guest.locator("input[type=file]").nth(1).setInputFiles(upload);
  await expect(guest.getByRole("button", { name: "Share photos", exact: true })).toBeEnabled();
  const authorization = guest.waitForResponse(response => response.url() === `${apiBase}/gallery/uploads` && response.request().method() === "POST");
  await guest.getByRole("button", { name: "Share photos", exact: true }).click();
  const uploadedId = (await (await authorization).json()).uploads[0].photoId;
  await expect(guest.locator(".selection")).toContainText("In the gallery", { timeout: 45_000 });
  expect(puts).toHaveLength(2);
  expect(puts.every(item => ["image/webp", "image/jpeg"].includes(item.mime))).toBe(true);
  const feed = await (await request.get(`${apiBase}/gallery/photos?limit=50`)).json();
  const photo = feed.photos.find(item => item.id === uploadedId); expect(photo.width).toBeLessThanOrEqual(1600); expect(photo.height).toBeLessThanOrEqual(1600);
  const delivered = await request.get(photo.thumbnailUrl); expect(delivered.status()).toBe(200); expect((await delivered.body()).length).toBeLessThanOrEqual(50000);
  expect((await (await request.get(photo.displayUrl)).body()).length).toBeLessThanOrEqual(500000);
  const tampered = new URL(photo.thumbnailUrl); tampered.searchParams.set("v", tampered.searchParams.get("v") + "x"); expect((await request.get(tampered.href)).status()).toBe(403);
  await admin.getByRole("button", { name: "Photo gallery", exact: false }).click();
  await expect(admin.getByRole("heading", { name: "Share the evening", exact: true })).toBeVisible();
  await admin.getByRole("checkbox", { name: `Select ${upload.name}`, exact: true }).check();
  await admin.getByRole("button", { name: "Hide selected (1)", exact: true }).click();
  await expect(admin.getByRole("status")).toContainText("1 photo hidden");
  const hidden = await (await request.get(`${apiBase}/gallery/photos?limit=50`)).json(); expect(hidden.photos.some(item => item.id === photo.id)).toBe(false);
  await admin.getByLabel("Show photos", { exact: true }).selectOption("hidden");
  await admin.getByRole("checkbox", { name: `Select ${upload.name}`, exact: true }).check();
  await admin.getByRole("button", { name: "Show selected (1)", exact: true }).click();
  await expect(admin.getByRole("status")).toContainText("1 photo shown");
  await admin.getByLabel("Require approval before display").check();
  await expect(admin.getByLabel("Require approval before display")).toBeEnabled();
  await guest.getByRole("button", { name: "Refresh photos", exact: true }).click();
  await guest.locator("input[type=file]").nth(1).setInputFiles({ ...upload, name: `review-${suffix}.png` });
  await expect(guest.getByRole("button", { name: "Share photos", exact: true })).toBeEnabled();
  await guest.getByRole("button", { name: "Share photos", exact: true }).click();
  await expect(guest.locator(".selection")).toContainText("Uploaded — awaiting approval", { timeout: 45_000 });
  await admin.getByLabel("Require approval before display").uncheck();
  await expect(admin.getByLabel("Require approval before display")).toBeEnabled();
  await admin.getByLabel("Show photos", { exact: true }).selectOption("pending");
  await expect(admin.getByRole("checkbox", { name: `Select review-${suffix}.png`, exact: true })).toBeVisible();
  await admin.getByLabel("Guest photo sharing open").uncheck();
  await expect(admin.getByLabel("Guest photo sharing open")).toBeEnabled();
  await admin.getByLabel("Publish this batch").selectOption("publish");
  await admin.getByLabel("Choose admin photos").setInputFiles([{ ...upload, name: `admin-a-${suffix}.png` }, { ...upload, name: `admin-b-${suffix}.png` }]);
  await admin.getByRole("button", { name: "Start sharing", exact: true }).click();
  await expect(admin.locator(".gallery-upload [role=status]")).toContainText("2 of 2 shared", { timeout: 45_000 });
  await admin.getByLabel("Guest photo sharing open").check();
  expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await guest.screenshot({ path: "test-results/gallery/guest-mobile.png", fullPage: true });
  await admin.screenshot({ path: "test-results/gallery/admin-desktop.png", fullPage: true });
  expect(errors).toEqual([]); await guest.close(); await admin.close();
});

test("optional libheif sample converts on the uploading device", async ({ page }) => {
  const fixture = process.env.GALLERY_HEIC_FIXTURE || resolve(import.meta.dirname, "../../../.gallery-local/example.heic");
  test.skip(!existsSync(fixture), "Provide GALLERY_HEIC_FIXTURE for the device-side HEIC conversion check.");
  await page.goto("http://127.0.0.1:5174/");
  await expect(page.getByRole("button", { name: "Choose photos", exact: true })).toBeEnabled();
  await page.locator("input[type=file]").nth(1).setInputFiles(fixture);
  await expect(page.locator(".selection img")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Share photos", exact: true })).toBeEnabled();
  expect(await page.locator(".selection img").evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
});

test("guest retries a failed authorization after reload using its saved session", async ({ page, request }) => {
  await request.post("http://127.0.0.1:5173/v1/admin/login", { headers: { "X-Admin-Request": "true" }, data: { username: "localadmin", password: "local-gallery-only" } });
  const reset = await request.patch("http://127.0.0.1:5173/v1/admin/gallery/settings", { headers: { "X-Admin-Request": "true" }, data: { requireApproval: false, guestUploadsOpen: true } });
  expect(reset.status()).toBe(200);
  await page.route(`${apiBase}/gallery/uploads`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_OUTAGE", message: "Sharing temporarily interrupted" } }) }));
  await page.goto("http://127.0.0.1:5174/");
  await expect(page.getByRole("button", { name: "Choose photos", exact: true })).toBeEnabled();
  await page.locator("input[type=file]").nth(1).setInputFiles({ name: "reload-retry.png", mimeType: "image/png", buffer: tinyPng });
  await expect(page.getByRole("button", { name: "Share photos", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Share photos", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry failed photos", exact: true })).toBeVisible();
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve, reject) => { const open = indexedDB.open("wpvlhc-gallery-queue-v1", 1); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
    try { return await new Promise(resolve => { const get = db.transaction("queues").objectStore("queues").get("guest:http://127.0.0.1:5999/v1"); get.onsuccess = () => resolve(get.result?.rows?.some(row => row.phase === "failed")); }); }
    finally { db.close(); }
  });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("wpvlhc-gallery-session")));
  await page.unroute(`${apiBase}/gallery/uploads`);
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry failed photos", exact: true })).toBeVisible();
  const authorization = page.waitForRequest(req => req.url() === `${apiBase}/gallery/uploads` && req.method() === "POST");
  await page.getByRole("button", { name: "Retry failed photos", exact: true }).click();
  expect((await authorization).postDataJSON().sessionToken).toBe(saved.sessionToken);
  await expect(page.locator(".selection")).toContainText("In the gallery", { timeout: 45_000 });
});

test("admin refreshes expired thumbnails and bounds retries when storage stays unavailable", async ({ page }) => {
  const ids = ["c".repeat(32), "d".repeat(32)], refreshes = new Map(), imageAttempts = [];
  const photo = (id, fresh = false) => ({ id, fileName: `${id[0]}-expiry.jpg`, source: "guest", uploadState: "ready", reviewState: "approved", deliveryState: "published", desiredVisible: true,
    thumbnailUrl: `http://127.0.0.1:8787/images/admin/${id}/initial/thumbnail?v=${fresh ? "fresh" : "expired"}` });
  await page.route("**/v1/admin/gallery/photos?**", route => route.fulfill({ json: { photos: ids.map(id => photo(id)), nextCursor: null } }));
  await page.route(/\/v1\/admin\/gallery\/photos\/[cd]{32}$/, route => {
    const id = route.request().url().split("/").at(-1); refreshes.set(id, (refreshes.get(id) || 0) + 1);
    return route.fulfill({ json: photo(id, true) });
  });
  await page.route("**/images/admin/**/initial/thumbnail?**", route => {
    const url = new URL(route.request().url()), fresh = url.searchParams.get("v") === "fresh", id = url.pathname.split("/")[3];
    imageAttempts.push({ id, fresh });
    if (fresh && id === ids[0]) return route.fulfill({ contentType: "image/png", body: tinyPng });
    return route.fulfill({ status: 403 });
  });
  await page.goto("http://127.0.0.1:5173/");
  await page.getByLabel("Username", { exact: true }).fill("localadmin"); await page.getByLabel("Password", { exact: true }).fill("local-gallery-only");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await page.getByRole("button", { name: "Photo gallery", exact: false }).click();
  const recovered = page.getByRole("img", { name: "c-expiry.jpg", exact: true });
  await expect(recovered).toHaveJSProperty("naturalWidth", 8);
  await expect.poll(() => imageAttempts.filter(item => item.id === ids[1]).length).toBe(2);
  await page.getByRole("img", { name: "d-expiry.jpg", exact: true }).evaluate(image => image.dispatchEvent(new Event("error")));
  expect(refreshes.get(ids[0])).toBe(1); expect(refreshes.get(ids[1])).toBe(1);
});
