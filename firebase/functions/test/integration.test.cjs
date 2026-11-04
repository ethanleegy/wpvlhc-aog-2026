const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createApp } = require("../src/app");

if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.GCLOUD_PROJECT?.startsWith("demo-")
) {
  throw new Error(
    "Integration tests require a demo- project and the Firestore emulator; they never access a live database.",
  );
}
let firebaseApp, db, app, agent, church, food, guest;
const config = {
  local: true,
  username: "testadmin",
  passwordHash: bcrypt.hashSync("integration-only", 4),
  jwtSecret: "test-secret-only-".repeat(4),
  siteUrl: "http://localhost:3000/gala/",
  origins: ["http://localhost:5173", "http://localhost:3000"],
};
const mutate = (method, path, body, client = agent) =>
  client[method](`/v1${path}`).set("X-Admin-Request", "true").send(body);

before(async () => {
  firebaseApp = initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  db = getFirestore(firebaseApp);
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(response.status, 200);
  app = createApp({
    getDb: () => db,
    getConfig: () => config,
    logger: { error() {} },
  });
  agent = request.agent(app);
});
after(async () => {
  await db?.terminate();
  if (firebaseApp) await deleteApp(firebaseApp);
});

test("authentication, origin checks, JSON errors and cookies", async () => {
  await request(app).get("/v1/admin/guests").expect(401);
  await request(app)
    .post("/v1/admin/login")
    .send({ username: config.username, password: "integration-only" })
    .expect(403);
  await mutate("post", "/admin/login", {
    username: config.username,
    password: "wrong",
  }).expect(401);
  const response = await mutate("post", "/admin/login", {
    username: config.username,
    password: "integration-only",
  }).expect(200);
  assert.match(
    response.headers["set-cookie"][0],
    /__session=.*HttpOnly.*SameSite=Strict/,
  );
  await agent.get("/v1/admin/session").expect(200);
  await request(app)
    .get("/v1/food-items")
    .set("Origin", "https://untrusted.invalid")
    .expect(403);
  const cors = await request(app)
    .get("/v1/food-items")
    .set("Origin", "http://localhost:3000")
    .expect(200);
  assert.equal(
    cors.headers["access-control-allow-origin"],
    "http://localhost:3000",
  );
  await request(app)
    .post("/v1/token/aaaaaaaaaaaaaaaaaaaaaaaa/reply")
    .set("Content-Type", "application/json")
    .send('{"rsvp":')
    .expect(400);
  await request(app)
    .post("/v1/token/aaaaaaaaaaaaaaaaaaaaaaaa/reply")
    .set("Content-Type", "text/plain")
    .send("hi")
    .expect(415);
  const missing = await request(app)
    .post("/v1/token/aaaaaaaaaaaaaaaaaaaaaaaa/reply")
    .set("Content-Type", "application/json")
    .expect(400);
  assert.equal(missing.body.error.code, "VALIDATION_ERROR");
});

test("church and food creation; personal links cannot be supplied or guessed from a name", async () => {
  church = (
    await mutate("post", "/admin/churches", { name: "Church A" }).expect(201)
  ).body;
  food = (
    await mutate("post", "/admin/food-items", {
      name: "Rice",
      unit: "servings",
    }).expect(201)
  ).body;
  guest = (
    await mutate("post", "/admin/guests", {
      name: "Pat Example",
      personalizedName: "Pastor Pat",
      churchId: church.id,
    }).expect(201)
  ).body;
  assert.match(guest.token, /^[a-f0-9]{24}$/);
  assert.equal(
    guest.uniqueUrl,
    `http://localhost:3000/gala/?token=${guest.token}`,
  );
  await mutate("post", "/admin/guests", {
    name: "Name",
    churchId: church.id,
    token: "custom",
  }).expect(400);
  const result = await request(app).get(`/v1/token/${guest.token}`).expect(200);
  assert.equal(result.body.personalizedName, "Pastor Pat");
  assert.equal(result.body.rsvp, "pending");
  assert.equal(result.body.createdAt, undefined);
  assert.equal(result.body.active, undefined);
  await request(app).get("/v1/token/Pat%20Example").expect(400);
  await request(app).get("/v1/token/%E0%A4%A").expect(400);
  await request(app).get("/v1/token/aaaaaaaaaaaaaaaaaaaaaaaa").expect(404);
});

test("replies are atomic, replace choices, reject invalid foods and retain locked units", async () => {
  const reply = (quantity) => ({
    rsvp: "yes",
    items: [{ foodItemId: food.id, quantity }],
  });
  await request(app)
    .post(`/v1/token/${guest.token}/reply`)
    .send(reply(10))
    .expect(200);
  await request(app)
    .post(`/v1/token/${guest.token}/reply`)
    .send(reply(10))
    .expect(200);
  let report = (await agent.get("/v1/admin/reports/summary").expect(200)).body;
  assert.equal(report.totals.yes, 1);
  assert.equal(report.foodItems[0].quantity, 10);
  assert.equal(report.totals.contributors, 1);
  await Promise.all(
    [11, 12, 13].map((quantity) =>
      request(app)
        .post(`/v1/token/${guest.token}/reply`)
        .send(reply(quantity))
        .expect(200),
    ),
  );
  const concurrent = (await agent.get("/v1/admin/reports/summary").expect(200))
    .body;
  assert.equal(concurrent.totals.contributors, 1);
  assert.ok([11, 12, 13].includes(concurrent.foodItems[0].quantity));
  await request(app)
    .post(`/v1/token/${guest.token}/reply`)
    .send(reply(10))
    .expect(200);
  const status = (
    await request(app).get(`/v1/token/${guest.token}/status`).expect(200)
  ).body;
  assert.equal(status.valid, true);
  assert.equal(status.rsvp, "yes");
  await request(app)
    .post(`/v1/token/${guest.token}/reply`)
    .send({ rsvp: "no", items: [{ foodItemId: food.id, quantity: 1 }] })
    .expect(400);
  await request(app)
    .post(`/v1/token/${guest.token}/reply`)
    .send({ rsvp: "yes", items: [{ foodItemId: "missing", quantity: 2 }] })
    .expect(404);
  assert.equal(
    (await request(app).get(`/v1/token/${guest.token}`)).body.items[0].quantity,
    10,
  );
  await mutate("patch", `/admin/food-items/${food.id}`, {
    unit: "trays",
  }).expect(409);
  await mutate("patch", `/admin/food-items/${food.id}`, {
    active: false,
  }).expect(200);
  assert.equal(
    (await request(app).get("/v1/food-items")).body.foodItems.length,
    0,
  );
  await request(app)
    .post(`/v1/token/${guest.token}/reply`)
    .send(reply(12))
    .expect(409);
  await request(app)
    .post(`/v1/token/${guest.token}/reply`)
    .send(reply(8))
    .expect(200);
  await request(app)
    .post(`/v1/token/${guest.token}/reply`)
    .send({ rsvp: "no", items: [] })
    .expect(200);
  report = (await agent.get("/v1/admin/reports/summary")).body;
  assert.equal(report.totals.no, 1);
  assert.equal(report.foodItems[0].quantity, 0);
  assert.equal(report.contributions.length, 0);
});

test("admin replies, pagination, church reassignment, reports, CSV and disabling links", async () => {
  await mutate("patch", `/admin/food-items/${food.id}`, {
    active: true,
  }).expect(200);
  await mutate("post", `/admin/guests/${guest.id}/reply`, {
    rsvp: "yes",
    items: [{ foodItemId: food.id, quantity: 20, notes: '=HYPERLINK("evil")' }],
  }).expect(200);
  const churchB = (
    await mutate("post", "/admin/churches", { name: "Church B" }).expect(201)
  ).body;
  await mutate("post", "/admin/guests", {
    name: "Second Guest",
    churchId: churchB.id,
  }).expect(201);
  const page1 = (await agent.get("/v1/admin/guests?limit=1").expect(200)).body;
  assert.ok(page1.nextCursor);
  const page2 = (
    await agent
      .get(`/v1/admin/guests?limit=1&after=${page1.nextCursor}`)
      .expect(200)
  ).body;
  assert.equal(page2.nextCursor, null);
  assert.notEqual(page1.guests[0].id, page2.guests[0].id);
  await agent.get("/v1/admin/guests?limit=0").expect(400);
  const filtered = (
    await agent
      .get(`/v1/admin/guests?churchId=${church.id}&rsvp=yes`)
      .expect(200)
  ).body;
  assert.equal(filtered.guests.length, 1);
  await mutate("patch", `/admin/guests/${guest.id}`, {
    churchId: churchB.id,
  }).expect(200);
  assert.equal(
    (await agent.get(`/v1/admin/reports/summary?churchId=${church.id}`)).body
      .totals.invited,
    0,
  );
  const report = (
    await agent
      .get(`/v1/admin/reports/summary?churchId=${churchB.id}`)
      .expect(200)
  ).body;
  assert.deepEqual(report.totals, {
    invited: 2,
    yes: 1,
    no: 0,
    pending: 1,
    contributors: 1,
  });
  assert.equal(report.contributions[0].churchId, churchB.id);
  const csv = await agent
    .get(`/v1/admin/reports/food.csv?churchId=${churchB.id}`)
    .expect(200);
  assert.match(csv.headers["content-type"], /text\/csv/);
  assert.ok(csv.text.includes("'=HYPERLINK"));
  await mutate("patch", `/admin/guests/${guest.id}`, { active: false }).expect(
    200,
  );
  await request(app).get(`/v1/token/${guest.token}`).expect(410);
  await request(app)
    .post(`/v1/token/${guest.token}/reply`)
    .send({ rsvp: "yes", items: [] })
    .expect(410);
  const detail = (await agent.get(`/v1/admin/guests/${guest.id}`).expect(200))
    .body;
  assert.equal(detail.items[0].quantity, 20);
  assert.equal(
    (await agent.get("/v1/admin/reports/summary")).body.totals.yes,
    0,
  );
  await mutate("patch", `/admin/churches/${churchB.id}`, {
    active: false,
  }).expect(200);
  await mutate("post", "/admin/guests", {
    name: "Blocked",
    churchId: churchB.id,
  }).expect(409);
});

test("duplicate dish slots allow one person each and release atomically", async () => {
  const people = [];
  const slots = [];
  for (const name of ["Slot guest A", "Slot guest B"])
    people.push(
      (
        await mutate("post", "/admin/guests", {
          name,
          churchId: church.id,
        }).expect(201)
      ).body,
    );
  for (let i = 0; i < 3; i += 1)
    slots.push(
      (
        await mutate("post", "/admin/food-items", {
          name: "Baked chicken",
          unit: "servings",
        }).expect(201)
      ).body,
    );
  const payload = (foodItemId) => ({
    rsvp: "yes",
    items: [{ foodItemId, quantity: 12 }],
  });
  const replies = await Promise.all(
    people.map((person) =>
      request(app)
        .post(`/v1/token/${person.token}/reply`)
        .send(payload(slots[0].id)),
    ),
  );
  assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409]);
  const winnerIndex = replies.findIndex((reply) => reply.status === 200);
  const winner = people[winnerIndex];
  const loser = people[1 - winnerIndex];
  assert.equal(replies[1 - winnerIndex].body.error.code, "FOOD_ITEM_TAKEN");
  assert.equal(
    (await request(app).get(`/v1/token/${loser.token}`)).body.rsvp,
    "pending",
  );
  let available = (await request(app).get("/v1/food-items")).body.foodItems;
  assert.equal(
    available.filter((item) => item.name === "Baked chicken").length,
    2,
  );
  assert.ok(!available.some((item) => item.id === slots[0].id));
  assert.ok(!available.some((item) => "claimedBy" in item));

  // Switching choices returns the first slot while reserving the second.
  await request(app)
    .post(`/v1/token/${winner.token}/reply`)
    .send(payload(slots[1].id))
    .expect(200);
  await request(app)
    .post(`/v1/token/${loser.token}/reply`)
    .send(payload(slots[0].id))
    .expect(200);
  await request(app)
    .post(`/v1/token/${winner.token}/reply`)
    .send(payload(slots[0].id))
    .expect(409);
  await mutate(
    "post",
    `/admin/guests/${winner.id}/reply`,
    payload(slots[0].id),
  ).expect(409);
  assert.equal(
    (await db.collection("FoodItems").doc(slots[1].id).get()).data().claimedBy,
    winner.token,
  );
  assert.equal(
    (await request(app).get(`/v1/token/${winner.token}`)).body.items[0]
      .foodItemId,
    slots[1].id,
  );

  await request(app)
    .post(`/v1/token/${winner.token}/reply`)
    .send({ rsvp: "no", items: [] })
    .expect(200);
  await request(app)
    .post(`/v1/token/${loser.token}/reply`)
    .send({ rsvp: "yes", items: [] })
    .expect(200);
  available = (await request(app).get("/v1/food-items")).body.foodItems;
  assert.equal(
    available.filter((item) => item.name === "Baked chicken").length,
    3,
  );
});

test("shared login rate limits, logout and default-deny Firestore rules", async () => {
  let limited = false;
  for (let i = 0; i < 12; i += 1) {
    const result = await mutate(
      "post",
      "/admin/login",
      { username: config.username, password: "wrong" },
      request(app),
    );
    if (result.status === 429) {
      limited = true;
      assert.equal(result.headers["retry-after"], "900");
      break;
    }
  }
  assert.equal(limited, true);
  await mutate("post", "/admin/logout", {}).expect(204);
  await agent.get("/v1/admin/session").expect(401);
  const base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`;
  const read = await fetch(`${base}/InvitedGuests/${guest.id}`);
  assert.equal(read.status, 403);
  const write = await fetch(`${base}/FoodItems/unauthorized`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { name: { stringValue: "Bad" } } }),
  });
  assert.equal(write.status, 403);
});

test("seeding is repeatable and preserves member codes, edits and food claims", async () => {
  const { seedDatabase } = require("../../scripts/seed.cjs");
  const { memberNames, foodSlots } = require("../../scripts/seed-data.cjs");
  assert.deepEqual(await seedDatabase(db), {
    Churches: 1,
    InvitedGuests: 200,
    FoodItems: 150,
  });
  const stateRef = db.collection("SeedData").doc("gala-2026-members");
  const tokens = (await stateRef.get()).data().memberTokens;
  assert.equal(tokens.length, 200);
  assert.equal(new Set(tokens).size, 200);
  assert.ok(tokens.every((token) => /^[a-f0-9]{24}$/.test(token)));
  const invitation = (
    await request(app).get(`/v1/token/${tokens[0]}`).expect(200)
  ).body;
  assert.equal(invitation.name, memberNames[0]);
  assert.equal(
    (
      await db
        .collection("FoodItems")
        .where("name", "==", "Baked chicken")
        .get()
    ).size,
    6,
  );
  await request(app)
    .post(`/v1/token/${tokens[0]}/reply`)
    .send({
      rsvp: "yes",
      items: [{ foodItemId: foodSlots[0].id, quantity: 12 }],
    })
    .expect(200);
  await db
    .collection("InvitedGuests")
    .doc(tokens[0])
    .update({ name: "Member renamed in management" });
  assert.deepEqual(await seedDatabase(db), {
    Churches: 0,
    InvitedGuests: 0,
    FoodItems: 0,
  });
  assert.deepEqual((await stateRef.get()).data().memberTokens, tokens);
  assert.equal(
    (await db.collection("InvitedGuests").doc(tokens[0]).get()).data().name,
    "Member renamed in management",
  );
  assert.equal(
    (await db.collection("FoodItems").doc(foodSlots[0].id).get()).data()
      .claimedBy,
    tokens[0],
  );
});
