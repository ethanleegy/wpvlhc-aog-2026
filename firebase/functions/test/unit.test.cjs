const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { schemas, validate } = require("../src/validation");
const { inviteUrl, buildReport } = require("../src/service");
const { csvCell, guestCsv } = require("../src/csv");
const { loadConfig } = require("../src/config");

test("replies require explicit quantities, unique known-shaped IDs and consistent attendance", () => {
  for (const payload of [
    undefined,
    {},
    { rsvp: "maybe", items: [] },
    { rsvp: "no", items: [{ foodItemId: "food-01", quantity: 1 }] },
    { rsvp: "yes", items: [{ foodItemId: "food-01", quantity: "2" }] },
    { rsvp: "yes", items: [{ foodItemId: "food-01", quantity: 0 }] },
    {
      rsvp: "yes",
      items: [
        { foodItemId: "food-01", quantity: 2 },
        { foodItemId: "food-01", quantity: 3 },
      ],
    },
    { rsvp: "yes", items: [], name: "Cannot change identity" },
  ])
    assert.throws(() => validate(schemas.reply, payload), { status: 400 });
  assert.deepEqual(
    validate(schemas.reply, {
      rsvp: "yes",
      items: [{ foodItemId: "food-01", quantity: 2 }],
    }),
    {
      rsvp: "yes",
      items: [{ foodItemId: "food-01", quantity: 2, notes: "" }],
    },
  );
  assert.deepEqual(validate(schemas.reply, { rsvp: "no", items: [] }), {
    rsvp: "no",
    items: [],
  });
});

test("invitation URLs preserve the static site's subpath without accepting a client identity", () => {
  const token = "a".repeat(24);
  assert.equal(
    inviteUrl("https://example.org/gala/", token),
    `https://example.org/gala/?token=${token}`,
  );
  assert.throws(
    () =>
      validate(schemas.guestCreate, { name: "Pat", churchId: "church", token }),
    { status: 400 },
  );
  for (const invalid of ["../secret", "a/b", "", "name-only"])
    assert.throws(() => validate(schemas.token, { token: invalid }), {
      status: 400,
    });
});

test("reports count only active invitations, yes replies and the requested church", () => {
  const result = buildReport(
    {
      churches: [
        { id: "a", name: "Church A" },
        { id: "b", name: "Church B" },
      ],
      guests: [
        { id: "1", name: "Pat", churchId: "a", active: true, rsvp: "yes" },
        { id: "2", name: "Ali", churchId: "a", active: true, rsvp: "no" },
        { id: "3", name: "Lee", churchId: "b", active: true, rsvp: "pending" },
        { id: "4", name: "Sam", churchId: "a", active: false, rsvp: "yes" },
      ],
      foodItems: [
        { id: "food", name: "Rice", unit: "servings", active: false },
      ],
      contributions: ["1", "2", "3", "4"].map((guestId) => ({
        guestId,
        items: [
          {
            foodItemId: "food",
            name: "Rice",
            unit: "servings",
            quantity: 10,
            notes: "",
          },
        ],
      })),
    },
    "a",
  );
  assert.deepEqual(result.totals, {
    invited: 2,
    yes: 1,
    no: 1,
    pending: 0,
    contributors: 1,
  });
  assert.equal(result.foodItems[0].quantity, 10);
  assert.equal(result.contributions.length, 1);
  assert.equal(result.churches.length, 1);
});

test("CSV escapes quotes and neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell('hello,"friend"\n'), '"hello,""friend""\n"');
  for (const value of [
    "=1+1",
    " +SUM(A1)",
    "-1+2",
    "@SUM(A1)",
    "\t=CMD()",
    "\r=1",
  ])
    assert.ok(csvCell(value).startsWith("\"'"));
  const output = guestCsv({
    guests: [
      {
        name: "=1+1",
        churchName: "A, B",
        rsvp: "yes",
        uniqueUrl: "https://example.org/?token=a",
        respondedAt: null,
      },
    ],
  });
  assert.ok(output.startsWith("\uFEFF"));
  assert.ok(output.includes("\r\n"));
});

test("production has no default credentials or insecure cookie mode", () => {
  assert.throws(
    () =>
      validate(schemas.login, { username: "admin", password: "é".repeat(37) }),
    { status: 400 },
  );
  assert.throws(() => loadConfig({}), /Missing required configuration/);
  const env = {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: bcrypt.hashSync("unit-test-only", 4),
    ADMIN_JWT_SECRET: "x".repeat(40),
    PUBLIC_SITE_URL: "https://example.org/gala/",
    ALLOWED_ORIGINS: "https://admin.example.org",
  };
  assert.equal(loadConfig(env).local, false);
  assert.throws(
    () => loadConfig({ ...env, ADMIN_JWT_SECRET: "short" }),
    /at least 32 bytes/,
  );
  assert.throws(
    () => loadConfig({ ...env, LOCAL_DEVELOPMENT: "true" }),
    /requires Firestore emulation/,
  );
  assert.throws(
    () => loadConfig({ ...env, ALLOWED_ORIGINS: "http://localhost:5173" }),
    /HTTPS/,
  );
});
