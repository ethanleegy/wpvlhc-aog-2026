import { test, expect } from "@playwright/test";
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGMMqHBjwAaYsIoOWgkA1+YBHmKFY/QAAAAASUVORK5CYII=", "base64");
const browserErrors = new WeakMap();
test.afterEach(async ({ page }) => { expect(browserErrors.get(page) || []).toEqual([]); });
async function fixture(page, { count = 3, interruptOnce = false, cleanupPending = false, busyOnce = false } = {}) {
  const errors = []; browserErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    const expectedInterruption = interruptOnce && failed && message.text().includes("status of 503") && message.location().url.endsWith("/v1/admin/gallery/photos/bulk-delete");
    if (message.type() === "error" && !expectedInterruption) errors.push(message.text());
  });
  let photos = Array.from({ length: count }, (_, i) => ({ id: (i + 1).toString(16).padStart(32, "0"), fileName: i === 0 ? "expired.png" : `photo-${i}.png`, source: "admin", uploadState: i === 0 ? "expired" : "ready", reviewState: "approved", deliveryState: "published", desiredVisible: i !== 0, ...(i ? { thumbnailUrl: `https://gallery-test.invalid/${i}.png` } : {}) }));
  const removed = new Set(), calls = []; let failed = false, cleanup = 0, busy = false;
  await page.route("https://gallery-test.invalid/**", route => route.fulfill({ contentType: "image/png", body: tinyPng }));
  await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "" }));
  await page.route("**/v1/admin/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.slice("/v1/admin".length);
    const json = data => route.fulfill({ json: data });
    if (path === "/session") return json({ username: "testadmin" });
    if (path === "/churches") return json({ churches: [{ id: "wpvlhc-aog", name: "WPVLHC", active: true }] });
    if (path === "/guests") return json({ guests: [], nextCursor: null });
    if (path === "/food-items") return json({ foodItems: [] });
    if (path === "/reports/summary") return json({ totals: { invited: 0, yes: 0, no: 0, pending: 0, plusOnes: 0, attendingPeople: 0, contributors: 0 }, churches: [], foodItems: [], contributions: [] });
    if (path === "/gallery/settings") return json({ requireApproval: false, guestUploadsOpen: true, adminUploadsOpen: true, billingEnd: "2026-12-01T00:00:00Z", uploadUrl: "https://example.test/gallery/upload/", limits: { storageBytes: 6000000000 }, capacity: { reservedBytes: (photos.length + cleanup) * 1000, photoCount: photos.length + cleanup, pendingDeletionCount: cleanup } });
    if (path === "/gallery/photos") {
      const start = url.searchParams.has("after") ? photos.findIndex(photo => photo.id === url.searchParams.get("after")) + 1 : 0;
      const items = photos.slice(start, start + 20);
      return json({ photos: items, nextCursor: start + 20 < photos.length ? items.at(-1).id : null });
    }
    if (path === "/gallery/maintenance") { const deleted = cleanup; cleanup = 0; return json({ cleaned: 0, repaired: 0, failed: 0, deleted }); }
    if (req.method() === "DELETE" || path === "/gallery/photos/bulk-delete") {
      const body = req.postDataJSON(), ids = req.method() === "DELETE" ? [path.split("/").at(-1)] : body.photoIds;
      calls.push({ ids, body, method: req.method() });
      const results = ids.map(id => {
        if (busyOnce && !busy && id === ids.at(-1)) { busy = true; return { id, success: false, error: { code: "PHOTO_BUSY", message: "This photo is being processed. Please retry." } }; }
        const missing = removed.has(id);
        if (!missing) { removed.add(id); photos = photos.filter(photo => photo.id !== id); if (cleanupPending) cleanup++; }
        return { id, success: true, pending: cleanupPending, missing };
      });
      if (interruptOnce && !failed && calls.length === 2) { failed = true; return route.fulfill({ status: 503, json: { error: { message: "Connection interrupted after removal" } } }); }
      return json({ results });
    }
    throw new Error(`Unexpected gallery fixture request ${req.method()} ${path}`);
  });
  await page.goto("/"); await page.getByRole("button", { name: "Photo gallery", exact: false }).click();
  await expect(page.getByRole("heading", { name: "Share the evening", exact: true })).toBeVisible();
  return calls;
}
test("single-photo deletion warns, requires the exact word and removes an expired card", async ({ page }, testInfo) => {
  const calls = await fixture(page);
  await page.getByRole("button", { name: "Delete expired.png", exact: true }).click();
  const dialog = page.getByRole("dialog"), confirm = dialog.getByRole("button", { name: "Delete photo", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("cannot be undone");
  await expect(confirm).toBeDisabled(); await dialog.getByLabel("Type delete to confirm").fill("DELETE"); await expect(confirm).toBeDisabled();
  expect(calls).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("photo-delete-confirmation.png"), fullPage: true });
  await dialog.getByLabel("Type delete to confirm").fill("delete"); await confirm.click();
  await expect(dialog).toHaveCount(0); await expect(page.getByRole("checkbox", { name: "Select expired.png", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("1 photo removed");
  expect(calls).toHaveLength(1); expect(calls[0].method).toBe("DELETE"); expect(calls[0].body.confirmation).toBe("delete");
});
test("bulk deletion resumes an uncertain batch without reprocessing completed groups", async ({ page }) => {
  const calls = await fixture(page, { count: 56, interruptOnce: true });
  await page.getByRole("button", { name: "Load more photos", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select loaded photos (40)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more photos", exact: true }).click();
  await page.getByRole("button", { name: "Select loaded photos (56)", exact: true }).click();
  await page.getByRole("button", { name: "Delete selected (56)", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("Type delete to confirm").fill("delete");
  await dialog.getByRole("button", { name: "Delete selected photos", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Connection interrupted" })).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("25 of 56 removed");
  await dialog.getByRole("button", { name: "Retry deletion", exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByRole("status")).toContainText("56 photos removed");
  expect(calls.map(call => call.ids.length)).toEqual([25, 25, 25, 6]);
  expect(calls[1].ids).toEqual(calls[2].ids);
  expect(calls[2].ids.some(id => calls[0].ids.includes(id))).toBe(false);
  expect(calls.every(call => call.body.confirmation === "delete")).toBe(true);
  await expect(page.getByText("No photos in this view yet.", { exact: true })).toBeVisible();
});
test("pending file cleanup stays visible in capacity and can be retried", async ({ page }) => {
  await fixture(page, { count: 1, cleanupPending: true });
  await page.getByRole("button", { name: "Delete expired.png", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("Type delete to confirm").fill("delete"); await dialog.getByRole("button", { name: "Delete photo", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("File cleanup is queued");
  await expect(page.getByText("1 photo is awaiting file cleanup.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Retry pending operations", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 photo deletion completed");
  await expect(page.getByText("1 photo is awaiting file cleanup.", { exact: false })).toHaveCount(0);
});
test("partial busy-photo failures retry only the photos that were not removed", async ({ page }) => {
  const calls = await fixture(page, { count: 3, busyOnce: true });
  await page.getByRole("button", { name: "Select loaded photos (3)", exact: true }).click();
  await page.getByRole("button", { name: "Delete selected (3)", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("Type delete to confirm").fill("delete"); await dialog.getByRole("button", { name: "Delete selected photos", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("2 of 3 removed");
  await dialog.getByRole("button", { name: "Retry deletion", exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(calls.map(call => call.ids.length)).toEqual([3, 1]);
  expect(calls[1].ids).toEqual([calls[0].ids[2]]);
});
test("the photo deletion dialog fits and works on a phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page, { count: 1 });
  await page.getByRole("button", { name: "Delete expired.png", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type delete to confirm").fill("delete");
  const bounds = await dialog.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("photo-delete-mobile.png") });
  await dialog.getByRole("button", { name: "Delete photo", exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByRole("status")).toContainText("1 photo removed");
});
