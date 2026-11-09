import { test, expect } from "@playwright/test";

test("management creates an invitation, records food, exports reports and signs out", async ({
  page,
}) => {
  const username = process.env.GALA_TEST_USERNAME;
  const password = process.env.GALA_TEST_PASSWORD;
  if (!username || !password)
    throw new Error(
      "Set GALA_TEST_USERNAME and GALA_TEST_PASSWORD for the local demo emulator only",
    );
  const suffix = Date.now().toString(36);
  const guestName = `Demo guest ${suffix}`;
  const foodName = `Demo food ${suffix}`;
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();

  const initialComing = Number(await page.locator(".stat").filter({ hasText: "People coming" }).locator("strong").textContent());
  let dialog;

  await page
    .getByRole("button", { name: "Food & drinks", exact: false })
    .click();
  await page.getByRole("button", { name: "Add food item +" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(foodName);
  await dialog.getByLabel("Unit", { exact: true }).fill("servings");
  await dialog.getByLabel("Description").fill("Browser smoke-test item");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "People", exact: false }).click();
  await page.getByRole("button", { name: "Add person +" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(guestName);
  await dialog.getByLabel("Personal greeting").fill("Pastor Demo");
  await expect(dialog.getByRole("combobox", { name: "Church", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  let row = page.getByRole("row").filter({ hasText: guestName });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("status")).toHaveText(
    `Invitation link copied for ${guestName}.`,
  );
  const url = await page.evaluate(() => navigator.clipboard.readText());
  const invitation = new URL(url);
  expect(invitation.origin).toBe("http://localhost:3000");
  const token = invitation.searchParams.get("token");
  expect(token).toMatch(/^[a-f0-9]{24}$/);
  const personal = await page.request.get(`/v1/token/${token}`);
  expect(personal.status()).toBe(200);
  expect((await personal.json()).personalizedName).toBe("Pastor Demo");

  await row.getByRole("button", { name: "Reply", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Add a food item" })
    .selectOption({ label: `${foodName} · servings` });
  await dialog.getByLabel("Quantity (servings)").fill("12");
  await dialog
    .getByLabel("Notes", { exact: true })
    .fill("Vegetarian, ready at 6 PM");
  await dialog.getByRole("button", { name: "Save reply" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText("Attending", { exact: true })).toBeVisible();
  const saved = await (await page.request.get(`/v1/token/${token}`)).json();
  expect(saved.items[0].quantity).toBe(12);

  await page
    .getByRole("button", { name: "Who is bringing what", exact: false })
    .click();
  row = page.getByRole("row").filter({ hasText: guestName });
  await expect(row).toContainText(foodName);
  await expect(row.getByRole("cell", { name: "12", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "servings", exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export contributions ↓" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("gala-contributions.csv");
  expect(await download.failure()).toBeNull();

  await page.getByRole("button", { name: "Overview", exact: false }).click();
  await expect(
    page.locator(".stat").filter({ hasText: "People coming" }).locator("strong"),
  ).toHaveText(String(initialComing + 1));
  await page.screenshot({
    path: "test-results/management-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/management-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
});
