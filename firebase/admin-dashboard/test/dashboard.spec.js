import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const churchId = "wpvlhc-aog";
const ids = ["a", "b", "c", "d", "e", "f"].map((letter) => letter.repeat(24));

async function fixture(page, { signedIn = true, empty = false, failImportOnce = false, extraPeople = 0, failPeopleDeleteOnce = false } = {}) {
  const church = { id: churchId, name: "World Prayer Vision Life Healing Center", active: true };
  const guests = empty ? [] : [
    ["Alice Henry", "yes", true, "Jane Henry", true],
    ["Ben Henry", "yes", false, "", true],
    ["Chloe Henry", "no", false, "", true],
    ["Devon Henry", "pending", false, "", true],
    ["Erin Henry", "yes", true, "Inactive Companion", false],
    ["Other church guest", "yes", true, "Other Companion", true],
  ].map(([name, rsvp, plusOne, plusOneName, active], index) => ({
    id: ids[index], token: ids[index], name, personalizedName: "", churchId: index === 5 ? "other" : churchId,
    rsvp, plusOne, plusOneName, active, registrationSource: "public",
    uniqueUrl: `https://example.test/?token=${ids[index]}`, respondedAt: "2026-11-09T12:00:00Z",
  }));
  for (let index = 0; index < extraPeople; index++) {
    const id = (index + 1).toString(16).padStart(24, "0");
    guests.push({ id, token: id, name: `Extra Person ${index + 1}`, personalizedName: "", churchId, rsvp: "yes", active: true, plusOne: false, plusOneName: "", uniqueUrl: `https://example.test/?token=${id}` });
  }
  const foods = empty ? [] : [
    { id: "rice-a", name: "Rice", unit: "servings", description: 'Homemade, "warm"\nKeep covered', active: true, claimedBy: ids[0] },
    { id: "rice-b", name: "Rice", unit: "servings", description: "=SUM(1,2)", active: true, claimedBy: ids[0] },
    { id: "juice", name: "Juice", unit: "bottles", description: "Fruit juice", active: false, claimedBy: ids[1] },
    { id: "cake", name: "Cake", unit: "pieces", description: "Homemade cake", active: true, claimedBy: null },
    { id: "water", name: "Water", unit: "bottles", description: "", active: true, claimedBy: null },
    { id: "old", name: "Old option", unit: "pieces", description: "Closed", active: false, claimedBy: null },
    { id: "reserved", name: "Reserved option", unit: "servings", description: "Retained reservation", active: true, claimedBy: ids[4] },
  ].map((food) => ({ ...food, hasContributions: !!food.claimedBy }));
  const selections = empty ? {} : {
    [ids[0]]: [{ foodItemId: "rice-a", quantity: 12, notes: '=HYPERLINK("untrusted")' }, { foodItemId: "rice-b", quantity: 8, notes: "Ready by six" }],
    [ids[1]]: [{ foodItemId: "juice", quantity: 4, notes: "Cold" }],
    [ids[4]]: [{ foodItemId: "reserved", quantity: 6, notes: "Inactive guest" }],
  };
  const calls = [];
  const imports = new Map(); let sequence = 0, failedImport = false;
  let peopleDeleteCalls = 0, failedPeopleDelete = false;
  function report() {
    const active = guests.filter((guest) => guest.active && guest.churchId === churchId);
    const coming = active.filter((guest) => guest.rsvp === "yes");
    const contributions = coming.flatMap((guest) => (selections[guest.id] || []).map((item) => ({
      ...item, guestId: guest.id, guestName: guest.name, churchId, churchName: church.name,
      foodName: foods.find((food) => food.id === item.foodItemId)?.name,
      unit: foods.find((food) => food.id === item.foodItemId)?.unit,
    })));
    const plusOnes = coming.filter((guest) => guest.plusOne).length;
    const totals = {
      invited: active.length, yes: coming.length, no: active.filter((guest) => guest.rsvp === "no").length,
      pending: active.filter((guest) => guest.rsvp === "pending").length,
      plusOnes, attendingPeople: coming.length + plusOnes,
      contributors: coming.filter((guest) => selections[guest.id]?.length).length,
    };
    return { generatedAt: "2026-11-09T12:00:00Z", churchId, totals, churches: [{ ...totals, churchId, name: church.name }], contributions,
      foodItems: foods.map((food) => ({ foodItemId: food.id, ...food, contributors: contributions.filter((row) => row.foodItemId === food.id).length,
        quantity: contributions.filter((row) => row.foodItemId === food.id).reduce((sum, row) => sum + row.quantity, 0) })) };
  }
  await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await page.route("**/v1/admin/**", async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace("/v1/admin", "");
    const body = req.postDataJSON();
    calls.push({ path, method: req.method(), query: Object.fromEntries(url.searchParams), body });
    const json = (data, status = 200) => route.fulfill({ json: data, status });
    if (path === "/session") return json(signedIn ? { username: "testadmin" } : { error: { message: "Sign in" } }, signedIn ? 200 : 401);
    if (path === "/login") { signedIn = true; return json({ username: "testadmin" }); }
    if (path === "/logout") { signedIn = false; return route.fulfill({ status: 204 }); }
    if (path === "/churches") return json({ churches: [church, { id: "other", name: "Other church", active: true }] });
    if (path === "/reports/summary") return json(report());
    if (path === "/food-items") return json({ foodItems: foods });
    if (path === "/food-items/import") {
      const prior = imports.get(body.requestId);
      if (prior) return json(prior);
      const ids = body.items.map((item) => { const id = `import-${++sequence}`; foods.push({ id, ...item, claimedBy: null, hasContributions: false }); return id; });
      const receipt = { ids, count: ids.length }; imports.set(body.requestId, receipt);
      if (failImportOnce && imports.size === 2 && !failedImport) { failedImport = true; return json({ error: { code: "TEST_INTERRUPTION", message: "Import interrupted" } }, 503); }
      return json(receipt, 201);
    }
    const foodDelete = req.method() === "DELETE" ? path.match(/^\/food-items\/([^/]+)$/) : null;
    if ((foodDelete && req.method() === "DELETE") || path === "/food-items/bulk-delete") {
      const ids = foodDelete ? [foodDelete[1]] : body.ids;
      const selected = new Set(ids);
      const hasChoices = foods.some((food) => selected.has(food.id) && food.claimedBy) || Object.values(selections).some((rows) => rows.some((item) => selected.has(item.foodItemId)));
      if (hasChoices && body.confirmation !== "delete") return json({ error: { code: "FOOD_DELETE_CONFIRMATION_REQUIRED", message: "This item was selected. Type delete to confirm." } }, 409);
      for (const id of Object.keys(selections)) selections[id] = selections[id].filter((item) => !selected.has(item.foodItemId));
      const deletedIds = foods.filter((food) => selected.has(food.id)).map((food) => food.id);
      for (let i = foods.length - 1; i >= 0; i--) if (selected.has(foods[i].id)) foods.splice(i, 1);
      return json({ deletedIds, missingIds: [], affectedGuests: hasChoices ? 1 : 0, removedChoices: hasChoices ? 1 : 0 });
    }
    if (path === "/guests" && req.method() === "GET") {
      const scoped = guests.filter((guest) => guest.churchId === url.searchParams.get("churchId"));
      const after = url.searchParams.get("after"), start = after ? scoped.findIndex((guest) => guest.id === after) + 1 : 0;
      const pageRows = scoped.slice(start, start + 3);
      return json({ guests: pageRows, nextCursor: start + 3 < scoped.length ? pageRows.at(-1).id : null });
    }
    if (path === "/guests" && req.method() === "POST") {
      const id = "9".repeat(24);
      const guest = { ...body, id, token: id, rsvp: "pending", plusOne: false, plusOneName: "", uniqueUrl: `https://example.test/?token=${id}` };
      guests.push(guest); return json(guest, 201);
    }
    const personDelete = req.method() === "DELETE" ? path.match(/^\/guests\/([a-f0-9]{24})$/) : null;
    if (personDelete || path === "/guests/bulk-delete") {
      if (body.confirmation !== "delete") return json({ error: { code: "GUEST_DELETE_CONFIRMATION_REQUIRED", message: "Type delete to confirm." } }, 409);
      const selected = new Set(personDelete ? [personDelete[1]] : body.ids);
      const deletedIds = guests.filter((guest) => selected.has(guest.id)).map((guest) => guest.id);
      let releasedFoodSlots = 0, removedChoices = 0;
      for (const food of foods) if (selected.has(food.claimedBy)) { food.claimedBy = null; releasedFoodSlots++; }
      for (const id of selected) { removedChoices += selections[id]?.length || 0; delete selections[id]; }
      for (let index = guests.length - 1; index >= 0; index--) if (selected.has(guests[index].id)) guests.splice(index, 1);
      peopleDeleteCalls++;
      if (failPeopleDeleteOnce && peopleDeleteCalls === 2 && !failedPeopleDelete) {
        failedPeopleDelete = true; return json({ error: { message: "Deletion interrupted" } }, 503);
      }
      return json({ deletedIds, missingIds: [...selected].filter((id) => !deletedIds.includes(id)), releasedFoodSlots, removedChoices });
    }
    const match = path.match(/^\/guests\/([a-f0-9]{24})(\/reply)?$/);
    if (match) {
      const guest = guests.find((row) => row.id === match[1]);
      if (req.method() === "GET") return json({ ...guest, items: selections[guest.id] || [] });
      if (match[2]) {
        for (const food of foods) if (food.claimedBy === guest.id) food.claimedBy = null;
        Object.assign(guest, { rsvp: body.rsvp, plusOne: body.plusOne, plusOneName: body.plusOneName });
        selections[guest.id] = body.items;
        for (const item of body.items) foods.find((food) => food.id === item.foodItemId).claimedBy = guest.id;
      } else Object.assign(guest, body);
      return json(guest);
    }
    throw new Error(`Unexpected test API request: ${req.method()} ${path}`);
  });
  return { calls, foods, imports, guests };
}

const stat = (page, name) => page.locator(".stat").filter({ has: page.getByText(name, { exact: true }) }).locator("strong");
async function mobileViewport(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).toHaveCSS("position", "static");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function csvDownload(page, button, filename) {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe(filename);
  expect(await file.failure()).toBeNull();
  return readFile(await file.path(), "utf8");
}

test("password visibility toggles without submitting and resets on sign-in", async ({ page }) => {
  const { calls } = await fixture(page, { signedIn: false });
  await page.goto("/");
  await expect(page).toHaveTitle("Christmas Social management · WPVLHC");
  await expect(page.getByText("Christmas Social · December 12, 2026", { exact: true })).toBeVisible();
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("sample-password");
  await expect(password).toHaveAttribute("type", "password");
  await page.screenshot({ path: "test-results/dashboard-signin-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  expect(calls.filter((call) => call.path === "/login")).toHaveLength(0);
  await page.getByRole("button", { name: "Hide password", exact: true }).press("Enter");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("sample-password");
  await page.getByLabel("Username").fill("testadmin");
  await password.press("Enter");
  await expect(stat(page, "People coming")).toHaveText("3");
  expect(calls.filter((call) => call.path === "/login")).toHaveLength(1);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("");
});

test("overview counts confirmed people, contributors, distinct selected slots and available options", async ({ page }) => {
  const { calls } = await fixture(page);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".brand")).toContainText("Christmas Social");
  await expect(page.locator("body")).not.toContainText("Christmas Gala");
  await expect(stat(page, "People coming")).toHaveText("3");
  await expect(stat(page, "Bringing something")).toHaveText("2");
  await expect(stat(page, "Food items selected")).toHaveText("3");
  await expect(stat(page, "Food items left")).toHaveText("2");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText("Other church", { exact: true })).toHaveCount(0);
  for (const call of calls.filter((call) => ["/guests", "/reports/summary"].includes(call.path))) expect(call.query.churchId).toBe(churchId);
  for (const table of await page.getByRole("table").all()) {
    await expect(table.getByRole("columnheader").first()).toHaveText("#");
    expect(await table.locator("tbody th").allTextContents()).toEqual(Array.from({ length: await table.locator("tbody tr").count() }, (_, i) => String(i + 1)));
  }
  await page.screenshot({ path: "test-results/dashboard-overview-desktop.png", fullPage: true });
  await mobileViewport(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/dashboard-overview-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("people follow all pages, show companions, and export the numbered filtered view", async ({ page }) => {
  const { calls } = await fixture(page);
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "People", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await expect(page.getByRole("cell", { name: "Jane Henry", exact: true })).toBeVisible();
  await expect(page.getByText("Erin Henry", { exact: true })).toBeVisible();
  expect([...new Set(calls.filter((call) => call.path === "/guests").map((call) => call.query.after || "start"))]).toEqual(["start", ids[2]]);
  await page.getByLabel("Find a person").fill("Jane");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody th")).toHaveText("1");
  const filtered = await csvDownload(page, "Export people ↓", "christmas-social-people.csv");
  expect(filtered.startsWith('\uFEFF"#","Name","Plus-one name"')).toBe(true);
  expect(filtered).toContain('"1","Alice Henry","Jane Henry","Attending"');
  expect(filtered).not.toContain("Ben Henry"); expect(filtered).not.toContain("Other church guest");
  await page.getByLabel("Find a person").fill("");
  const all = await csvDownload(page, "Export people ↓", "christmas-social-people.csv");
  expect(all).toContain('"5","Erin Henry"'); expect(all).not.toContain("Other church guest");
  await page.getByRole("combobox", { name: "Reply", exact: true }).selectOption("no");
  await expect(page.locator("tbody th")).toHaveText("1");
  const declined = await csvDownload(page, "Export people ↓", "christmas-social-people.csv");
  expect(declined).toContain("Chloe Henry"); expect(declined).not.toContain("Alice Henry");
});

test("catalogue and contribution exports are distinct, complete, numbered and spreadsheet-safe", async ({ page }) => {
  await fixture(page); await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Food & drinks", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(7);
  const catalogue = await csvDownload(page, "Export food list ↓", "christmas-social-food-list.csv");
  expect(catalogue).toContain('"#","Item","Unit","Description","Status"');
  expect(catalogue).toContain('"4","Cake","pieces","Homemade cake","Available"');
  expect(catalogue).toContain('"6","Old option","pieces","Closed","Inactive"');
  expect(catalogue).toContain('"\'=SUM(1,2)"');
  expect(catalogue).toContain('"Homemade, ""warm""\nKeep covered"');
  await page.getByRole("navigation").getByRole("button", { name: "Who is bringing what", exact: true }).click();
  await expect(page.locator("thead th")).toHaveText(["#", "Name", "Contribution", "Quantity", "Unit", "Description", "Notes"]);
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(page.locator("tbody tr").first()).toContainText("12");
  await expect(page.locator("tbody tr").first()).toContainText("servings");
  const contributions = await csvDownload(page, "Export contributions ↓", "christmas-social-contributions.csv");
  expect(contributions).toContain('"1","Alice Henry","Rice","12","servings"');
  expect(contributions).toContain('"3","Ben Henry","Juice","4","bottles","Fruit juice","Cold"');
  expect(contributions).toContain('"\'=HYPERLINK(""untrusted"")"');
  expect(contributions).not.toContain("Cake"); expect(contributions).not.toContain("Inactive guest");
  expect(contributions.endsWith("\r\n")).toBe(true);
  await page.screenshot({ path: "test-results/dashboard-contributions-desktop.png", fullPage: true });
  await mobileViewport(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/dashboard-contributions-mobile.png", fullPage: true });
});

test("manual corrections keep the fixed church and update companions, food and overview totals", async ({ page }) => {
  const { calls } = await fixture(page);
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "People", exact: true }).click();
  await page.getByRole("button", { name: "Add person +" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await dialog.getByLabel("Name", { exact: true }).fill("New Guest");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.find((call) => call.path === "/guests" && call.method === "POST").body.churchId).toBe(churchId);
  const row = page.getByRole("row").filter({ hasText: "New Guest" });
  await row.getByRole("button", { name: "Reply", exact: true }).click();
  await dialog.getByLabel("Bringing a plus-one").check();
  await dialog.getByLabel("Plus-one name", { exact: true }).fill("New Companion");
  await dialog.getByLabel("Add a food item").selectOption("cake");
  await dialog.getByLabel("Quantity (pieces)").fill("10");
  await dialog.getByLabel("Notes", { exact: true }).fill("Ready at six");
  await dialog.getByRole("button", { name: "Save reply" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("New Companion");
  const saved = calls.find((call) => call.path.endsWith("/reply") && call.method === "POST").body;
  expect(saved).toEqual({ rsvp: "yes", plusOne: true, plusOneName: "New Companion", items: [{ foodItemId: "cake", quantity: 10, notes: "Ready at six" }] });
  await page.getByRole("navigation").getByRole("button", { name: "Overview", exact: true }).click();
  await expect(stat(page, "People coming")).toHaveText("5");
  await expect(stat(page, "Bringing something")).toHaveText("3");
  await expect(stat(page, "Food items selected")).toHaveText("4");
  await expect(stat(page, "Food items left")).toHaveText("1");
  await page.getByRole("navigation").getByRole("button", { name: "Church settings", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Add church +" })).toHaveCount(0);
});

test("empty registrations and catalogue show zero counts and usable empty states", async ({ page }) => {
  await fixture(page, { empty: true }); await page.goto("/");
  for (const name of ["People coming", "Bringing something", "Food items selected", "Food items left"]) await expect(stat(page, name)).toHaveText("0");
  await page.getByRole("navigation").getByRole("button", { name: "People", exact: true }).click();
  await expect(page.getByText("No people match this view.")).toBeVisible();
  const csv = await csvDownload(page, "Export people ↓", "christmas-social-people.csv");
  expect(csv.split("\r\n")).toHaveLength(2);
  await page.getByRole("navigation").getByRole("button", { name: "Who is bringing what", exact: true }).click();
  await expect(page.getByText("Contributions appear here", { exact: false })).toBeVisible();
});

test("selected-food deletion requires typing delete and updates contributions without changing attendance", async ({ page }) => {
  const { calls } = await fixture(page); await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Food & drinks", exact: true }).click();
  await page.locator("tbody tr").filter({ has: page.getByRole("cell", { name: "Rice", exact: true }) }).first().getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Guest selections will be removed");
  const confirm = dialog.getByRole("button", { name: "Delete item", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type delete to confirm").fill("DELETE"); await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type delete to confirm").fill("delete");
  await page.screenshot({ path: "test-results/food-delete-warning-desktop.png", fullPage: true });
  await confirm.click(); await expect(dialog).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(6);
  expect(calls.find((call) => call.method === "DELETE").body).toEqual({ confirmation: "delete" });
  await page.getByRole("navigation").getByRole("button", { name: "Overview", exact: true }).click();
  await expect(stat(page, "People coming")).toHaveText("3");
  await expect(stat(page, "Food items selected")).toHaveText("2");
  await expect(page.getByRole("heading", { name: "Food items", exact: true })).toBeVisible();
  await expect(page.getByText("For the shared table", { exact: true })).toHaveCount(0);
});

test("bulk food selection deletes unused rows and resets numbering and selection", async ({ page }) => {
  const { calls } = await fixture(page); await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Food & drinks", exact: true }).click();
  for (const name of ["Cake", "Water"]) await page.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) }).getByRole("checkbox").check();
  await expect(page.getByLabel("Select all food items", { exact: true })).toHaveJSProperty("indeterminate", true);
  await page.getByRole("button", { name: "Delete selected (2)", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type delete to confirm")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Delete selected items", exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator("tbody tr")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Delete selected (0)", exact: true })).toBeDisabled();
  expect(calls.find((call) => call.path === "/food-items/bulk-delete").body.ids).toEqual(["cake", "water"]);
  expect(await page.locator("tbody th").allTextContents()).toEqual(["1", "2", "3", "4", "5"]);
});

test("a selection made after loading still forces the typed warning before deletion", async ({ page }) => {
  const { foods, calls } = await fixture(page); await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Food & drinks", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Cake", exact: true })).toBeVisible();
  foods.find((food) => food.id === "cake").claimedBy = ids[0];
  await page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Cake", exact: true }) }).getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Delete item", exact: true }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("Guest selections will be removed");
  await expect(dialog.getByRole("button", { name: "Delete item", exact: true })).toBeDisabled();
  expect(foods.some((food) => food.id === "cake")).toBe(true);
  await dialog.getByLabel("Type delete to confirm").fill("delete");
  await dialog.getByRole("button", { name: "Delete item", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(2);
});

test("CSV imports preview rows, reject invalid files without writes and add separate slots", async ({ page }) => {
  const { calls, foods } = await fixture(page); await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Food & drinks", exact: true }).click();
  await page.getByRole("button", { name: "Import CSV ↑", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const template = await csvDownload(page, "Download CSV template ↓", "christmas-social-food-template.csv");
  expect(template).toContain('"Name","Unit","Description","Active"');
  await dialog.getByLabel("Choose food CSV").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Unit\nRice,") });
  await expect(dialog.getByRole("alert")).toContainText("unit");
  expect(calls.filter((call) => call.path === "/food-items/import")).toHaveLength(0);
  await dialog.getByLabel("Choose food CSV").setInputFiles({ name: "food.csv", mimeType: "text/csv", buffer: Buffer.from('Name,Unit,Description,Active\nChicken,servings,"Cooked, warm",true\nChicken,servings,Second slot,false') });
  await expect(dialog.locator("tbody tr")).toHaveCount(2);
  await mobileViewport(page);
  await page.screenshot({ path: "test-results/food-import-preview-mobile.png", fullPage: true });
  expect(foods).toHaveLength(7);
  await dialog.getByRole("button", { name: "Add food items", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("All 2 food items added.");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  expect(foods).toHaveLength(9);
  expect(foods.slice(-2).map((food) => food.active)).toEqual([true, false]);
});

test("an interrupted CSV import resumes after reload using the same batch ID without duplicate slots", async ({ page }) => {
  const { calls, foods } = await fixture(page, { failImportOnce: true }); await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Food & drinks", exact: true }).click();
  await page.getByRole("button", { name: "Import CSV ↑", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Choose food CSV").setInputFiles({ name: "batch.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Unit\n" + Array.from({ length: 12 }, (_, i) => `Dish ${i},servings`).join("\n")) });
  await dialog.getByRole("button", { name: "Add food items", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Import interrupted");
  expect(foods).toHaveLength(19);
  const first = calls.filter((call) => call.path === "/food-items/import");
  expect(first.map((call) => call.body.items.length)).toEqual([10, 2]);
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "Food & drinks", exact: true }).click();
  await page.getByRole("button", { name: "Import CSV ↑", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue import", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("All 12 food items added.");
  expect(foods).toHaveLength(19);
  expect(calls.filter((call) => call.path === "/food-items/import").at(-1).body.requestId).toBe(first[1].body.requestId);
  expect(await page.evaluate(() => localStorage.getItem("wpvlhc-food-import-v1"))).toBeNull();
});

test("single person deletion requires typing delete, removes their plus-one and releases food slots", async ({ page }) => {
  const { calls, foods, guests } = await fixture(page); await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "People", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Alice Henry" }).getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog"), confirm = dialog.getByRole("button", { name: "Delete person", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("Registrations will be permanently removed");
  await expect(dialog).toContainText("Alice Henry + Jane Henry");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type delete to confirm").fill("DELETE"); await expect(confirm).toBeDisabled();
  expect(calls.filter((call) => call.method === "DELETE" && call.path.startsWith("/guests/"))).toHaveLength(0);
  await dialog.getByLabel("Type delete to confirm").fill("delete");
  await mobileViewport(page);
  await page.screenshot({ path: "test-results/people-delete-warning-mobile.png", fullPage: true });
  await confirm.click(); await expect(dialog).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(4);
  expect(guests.some((guest) => guest.id === ids[0])).toBe(false);
  expect(foods.filter((food) => food.claimedBy === ids[0])).toHaveLength(0);
  expect(calls.find((call) => call.method === "DELETE" && call.path.startsWith("/guests/")).body).toEqual({ confirmation: "delete" });
  expect(await page.locator("tbody th").allTextContents()).toEqual(["1", "2", "3", "4"]);
  await page.getByRole("navigation").getByRole("button", { name: "Overview", exact: true }).click();
  await expect(stat(page, "People coming")).toHaveText("1");
  await expect(stat(page, "Bringing something")).toHaveText("1");
  await expect(stat(page, "Food items selected")).toHaveText("1");
  await expect(stat(page, "Food items left")).toHaveText("4");
});

test("bulk person selection follows filters, clears hidden selections and deletes only shown people", async ({ page }) => {
  const { calls, guests } = await fixture(page); await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "People", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Alice Henry" }).getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Delete selected (1)", exact: true })).toBeEnabled();
  await page.getByLabel("Find a person").fill("Ben");
  await expect(page.getByRole("button", { name: "Delete selected (0)", exact: true })).toBeDisabled();
  await page.getByLabel("Select all shown people", { exact: true }).check();
  await page.getByLabel("Find a person").fill("");
  await expect(page.getByRole("button", { name: "Delete selected (0)", exact: true })).toBeDisabled();
  await page.getByRole("combobox", { name: "Reply", exact: true }).selectOption("yes");
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.getByLabel("Select all shown people", { exact: true }).check();
  await page.getByRole("button", { name: "Delete selected (3)", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type delete to confirm").fill("delete");
  await dialog.getByRole("button", { name: "Delete selected people", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("No people match this view.")).toBeVisible();
  expect(calls.find((call) => call.path === "/guests/bulk-delete").body).toEqual({ ids: [ids[0], ids[1], ids[4]], confirmation: "delete" });
  expect(guests.map((guest) => guest.id)).toEqual([ids[2], ids[3], ids[5]]);
});

test("large people deletions retry an interrupted batch without reprocessing earlier groups", async ({ page }) => {
  const { calls, guests } = await fixture(page, { extraPeople: 8, failPeopleDeleteOnce: true }); await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "People", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(13);
  await page.getByLabel("Select all shown people", { exact: true }).check();
  await page.getByRole("button", { name: "Delete selected (13)", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type delete to confirm").fill("delete");
  await dialog.getByRole("button", { name: "Delete selected people", exact: true }).click();
  await expect(dialog.getByRole("alert").last()).toContainText("Deletion interrupted");
  await expect(dialog.getByRole("status")).toContainText("10 of 13 deleted");
  const before = calls.filter((call) => call.path === "/guests/bulk-delete");
  expect(before.map((call) => call.body.ids.length)).toEqual([10, 3]);
  await dialog.getByRole("button", { name: "Retry deletion", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const after = calls.filter((call) => call.path === "/guests/bulk-delete");
  expect(after).toHaveLength(3); expect(after[2].body.ids).toEqual(before[1].body.ids);
  expect(guests.map((guest) => guest.id)).toEqual([ids[5]]);
});
