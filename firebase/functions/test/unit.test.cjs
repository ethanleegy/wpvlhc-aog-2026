const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { schemas, validate } = require("../src/validation");
const { inviteUrl, buildReport } = require("../src/service");
const { csvCell, guestCsv } = require("../src/csv");
const { loadConfig } = require("../src/config");
const { memberNames, foodSlots } = require("../../scripts/seed-data.cjs");

test("seed contains 200 sample members and 150 separate Guyanese menu slots", () => {
  assert.equal(memberNames.length, 200);
  assert.equal(new Set(memberNames).size, 200);
  assert.equal(foodSlots.length, 150);
  assert.equal(new Set(foodSlots.map((food) => food.id)).size, 150);
  const counts = new Map();
  for (const food of foodSlots) {
    const { id, ...payload } = food;
    validate(schemas.foodCreate, payload);
    counts.set(food.name, (counts.get(food.name) || 0) + 1);
  }
  assert.equal(counts.size, 50);
  assert.ok([...counts.values()].every((count) => count === 3));
  assert.equal(counts.get("Baked chicken"), 3);
  for (const name of memberNames)
    validate(schemas.guestCreate, { name, churchId: "wpvlhc-aog" });
});

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

test("public registration requires a private UUIDv4 request ID, name and explicit food choices", () => {
  const valid = {
    requestId: "62c72547-8a62-4126-9b0e-10ee3e7a50ec",
    name: "John Henry",
    items: [{ foodItemId: "gala-food-034", quantity: 12 }],
  };
  assert.deepEqual(validate(schemas.registration, valid), {
    ...valid,
    items: [{ foodItemId: "gala-food-034", quantity: 12, notes: "" }],
  });
  assert.deepEqual(validate(schemas.registration, { ...valid, items: [] }).items, []);
  for (const payload of [
    undefined,
    {},
    { ...valid, requestId: "guessable-request" },
    { ...valid, requestId: "62c72547-8a62-1126-9b0e-10ee3e7a50ec" },
    { ...valid, name: "" },
    { ...valid, name: "  John Henry  " },
    { ...valid, name: "J".repeat(161) },
    { ...valid, items: undefined },
    { ...valid, items: [{ foodItemId: "food", quantity: "12" }] },
    { ...valid, items: [{ foodItemId: "food", quantity: 0 }] },
    { ...valid, items: [{ foodItemId: "food", quantity: 1 }, { foodItemId: "food", quantity: 1 }] },
    ...["churchId", "rsvp", "active", "token", "registrationSource"].map((key) => ({ ...valid, [key]: "not-client-controlled" })),
  ]) assert.throws(() => validate(schemas.registration, payload), { status: 400 });
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
    plusOnes: 0,
    attendingPeople: 1,
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
        plusOne: true,
        plusOneName: '=HYPERLINK("untrusted")',
      },
    ],
  });
  assert.ok(output.startsWith("\uFEFF"));
  assert.ok(output.includes("\r\n"));
  assert.ok(output.includes('"Plus one","Plus-one name"'));
  assert.ok(output.includes('"Yes","\'=HYPERLINK(""untrusted"")"'));
});

test("plus-ones require an explicit boolean and companion name across all guest mutations", () => {
  const targets = [
    [schemas.registration, { requestId: "62c72547-8a62-4126-9b0e-10ee3e7a50ec", name: "John", items: [] }],
    [schemas.reply, { rsvp: "yes", items: [] }],
    [schemas.guestCreate, { name: "John", churchId: "wpvlhc-aog" }],
    [schemas.guestPatch, { name: "John" }],
  ];
  for (const [schema, base] of targets) {
    for (const fields of [{}, { plusOne: false }, { plusOne: false, plusOneName: "" }, { plusOne: true, plusOneName: "Jane Henry" }])
      assert.doesNotThrow(() => validate(schema, { ...base, ...fields }));
    for (const fields of [
      { plusOne: "true", plusOneName: "Jane" }, { plusOne: 1, plusOneName: "Jane" },
      { plusOne: null }, { plusOne: true }, { plusOne: true, plusOneName: "" },
      { plusOne: true, plusOneName: "  " }, { plusOne: true, plusOneName: " Jane " },
      { plusOne: true, plusOneName: "J".repeat(161) }, { plusOne: true, plusOneName: 123 },
      { plusOne: false, plusOneName: "Jane" }, { plusOneName: "Jane" }, { plusOneName: "" },
    ]) assert.throws(() => validate(schema, { ...base, ...fields }), { status: 400 });
    assert.doesNotThrow(() => validate(schema, { ...base, plusOne: true, plusOneName: "J".repeat(160) }));
  }
  assert.throws(() => validate(schemas.reply, { rsvp: "no", items: [], plusOne: true, plusOneName: "Jane" }), { status: 400 });
  assert.doesNotThrow(() => validate(schemas.reply, { rsvp: "no", items: [], plusOne: false }));
});

test("attendance headcounts include companions once without changing guest or food counts", () => {
  const data = {
    churches: [{ id: "a", name: "Church A" }, { id: "b", name: "Church B" }],
    guests: [
      { id: "1", name: "Pat", churchId: "a", active: true, rsvp: "yes", plusOne: true, plusOneName: "Alex" },
      { id: "2", name: "Legacy", churchId: "a", active: true, rsvp: "yes" },
      { id: "3", churchId: "a", active: true, rsvp: "no", plusOne: true, plusOneName: "Not counted" },
      { id: "4", churchId: "a", active: true, rsvp: "pending", plusOne: true, plusOneName: "Not confirmed" },
      { id: "5", churchId: "a", active: false, rsvp: "yes", plusOne: true, plusOneName: "Inactive" },
      { id: "6", churchId: "b", active: true, rsvp: "yes", plusOne: true, plusOneName: "Another" },
    ],
    foodItems: [{ id: "food", name: "Rice", unit: "servings", active: true }],
    contributions: [{ guestId: "1", items: [{ foodItemId: "food", quantity: 4, name: "Rice", unit: "servings", notes: "" }] }],
  };
  const overall = buildReport(data);
  assert.deepEqual(overall.totals, { invited: 5, yes: 3, no: 1, pending: 1, contributors: 1, plusOnes: 2, attendingPeople: 5 });
  assert.equal(overall.churches[0].attendingPeople, 3); assert.equal(overall.churches[1].attendingPeople, 2);
  const filtered = buildReport(data, "a");
  assert.deepEqual(filtered.totals, { invited: 4, yes: 2, no: 1, pending: 1, contributors: 1, plusOnes: 1, attendingPeople: 3 });
  assert.equal(filtered.foodItems[0].quantity, 4); assert.equal(filtered.contributions.length, 1);
  assert.equal(filtered.guests.find((g) => g.id === "2").plusOne, false);
  assert.equal(filtered.guests.find((g) => g.id === "2").plusOneName, "");
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
    () => loadConfig({ ...env, ALLOWED_ORIGINS: "http://admin.example.org" }),
    /HTTPS/,
  );
});

test("production allows explicit HTTP loopback origins without enabling local cookie mode", () => {
  const origins = [
    "https://admin.example.org",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ];
  const env = {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: bcrypt.hashSync("unit-test-only", 4),
    ADMIN_JWT_SECRET: "x".repeat(40),
    PUBLIC_SITE_URL: "https://example.org/gala/",
    ALLOWED_ORIGINS: origins.join(","),
  };
  const config = loadConfig(env);
  assert.deepEqual(config.origins, origins);
  assert.equal(config.local, false);
  assert.equal(require("../src/auth").cookieOptions(config).secure, true);
  for (const origin of [
    "http://admin.example.org",
    "http://localhost.evil.example:3000",
    "http://127.0.0.1.evil.example:3000",
    "http://192.168.1.1:3000",
  ]) {
    assert.throws(
      () => loadConfig({ ...env, ALLOWED_ORIGINS: origin }),
      /HTTPS/,
    );
  }
  assert.throws(
    () => loadConfig({ ...env, PUBLIC_SITE_URL: "http://localhost:3000/" }),
    /HTTPS/,
  );
  assert.throws(
    () => loadConfig({ ...env, ALLOWED_ORIGINS: "http://localhost:3000/" }),
    /exact origins/,
  );
});
