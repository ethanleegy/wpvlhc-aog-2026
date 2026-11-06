const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { createApp } = require("../src/app");

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith("demo-"))
  throw new Error("Registration integration tests require a demo project and Firestore emulator.");

let firebaseApp, db, app;
const config = {
  local: true, username: "testadmin", passwordHash: bcrypt.hashSync("integration-only", 4),
  jwtSecret: "registration-integration-only-".repeat(3), siteUrl: "http://localhost:3000/",
  origins: ["http://localhost:3000", "http://localhost:5173"],
};
const payload = (changes = {}) => ({
  requestId: randomUUID(), name: "John Henry", items: [{ foodItemId: "food-a", quantity: 12 }], ...changes,
});
const submit = (body) => request(app).post("/v1/registrations").send(body);
const admin = (agent, method, path, body) => agent[method](`/v1/admin${path}`).set("X-Admin-Request", "true").send(body);
async function counts() {
  const names = ["InvitedGuests", "FoodContributions", "PublicRegistrationRequests"];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, (await db.collection(name).get()).size])));
}
before(async () => {
  firebaseApp = initializeApp({ projectId: `${process.env.GCLOUD_PROJECT}-registrations` }, "registration-integration");
  db = getFirestore(firebaseApp);
  app = createApp({ getDb: () => db, getConfig: () => config, logger: { error() {} } });
});
beforeEach(async () => {
  const clear = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${firebaseApp.options.projectId}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(clear.status, 200);
  await db.collection("Churches").doc("wpvlhc-aog").set({ name: "WPVLHC AOG", active: true });
  for (const id of ["food-a", "food-b"])
    await db.collection("FoodItems").doc(id).set({ name: `Dish ${id}`, unit: "servings", description: "", active: true, hasContributions: false, claimedBy: null });
});
after(async () => { await db?.terminate(); if (firebaseApp) await deleteApp(firebaseApp); });

test("public registration atomically saves attendance and food without an admin session", async () => {
  const response = await submit(payload()).set("Origin", "http://localhost:3000").expect(201);
  const saved = response.body;
  assert.match(saved.token, /^[a-f0-9]{24}$/);
  assert.equal(saved.name, "John Henry"); assert.equal(saved.rsvp, "yes"); assert.equal(saved.churchId, "wpvlhc-aog");
  assert.deepEqual(saved.items, [{ foodItemId: "food-a", quantity: 12, notes: "", name: "Dish food-a", unit: "servings" }]);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:3000");
  assert.equal(response.headers["cache-control"], "private, no-store"); assert.equal(response.headers["set-cookie"], undefined);
  const guest = (await db.collection("InvitedGuests").doc(saved.token).get()).data();
  assert.equal(guest.registrationSource, "public"); assert.equal(guest.active, true); assert.ok(guest.respondedAt.toDate());
  assert.equal((await db.collection("FoodItems").doc("food-a").get()).data().claimedBy, saved.token);
  assert.equal((await db.collection("FoodItems").doc("food-a").get()).data().hasContributions, true);
  await request(app).get("/v1/admin/guests").expect(401);
});

test("identical retries and concurrent double submissions create one registration", async () => {
  const body = payload({ items: [{ foodItemId: "food-a", quantity: 2 }, { foodItemId: "food-b", quantity: 3 }] });
  const responses = await Promise.all([submit(body), submit(body)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
  assert.deepEqual(responses[0].body, responses[1].body);
  const repeated = await submit({ items: [{ notes: "", quantity: 3, foodItemId: "food-b" }, { notes: "", quantity: 2, foodItemId: "food-a" }], name: body.name, requestId: body.requestId.toUpperCase() }).expect(200);
  assert.deepEqual(repeated.body, responses[0].body);
  assert.deepEqual(await counts(), { InvitedGuests: 1, FoodContributions: 1, PublicRegistrationRequests: 1 });
});

test("a reused request ID with changed information cannot create or modify guests", async () => {
  const body = payload(); const saved = (await submit(body).expect(201)).body;
  for (const change of [{ name: "Other Person" }, { items: [] }, { items: [{ foodItemId: "food-a", quantity: 13 }] }]) {
    const conflict = await submit({ ...body, ...change }).expect(409);
    assert.equal(conflict.body.error.code, "REQUEST_CHANGED");
  }
  assert.equal((await db.collection("FoodContributions").doc(saved.token).get()).data().items[0].quantity, 12);
  assert.deepEqual(await counts(), { InvitedGuests: 1, FoodContributions: 1, PublicRegistrationRequests: 1 });
});

test("competing food claims leave no partial guest or contribution for the losing registration", async () => {
  const bodies = [payload(), payload({ name: "Second Guest" })];
  const responses = await Promise.all(bodies.map(submit));
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const loser = responses.find((r) => r.status === 409); assert.equal(loser.body.error.code, "FOOD_ITEM_TAKEN");
  assert.deepEqual(await counts(), { InvitedGuests: 1, FoodContributions: 1, PublicRegistrationRequests: 1 });
  // A conflict did not consume the request ID: the losing guest may choose another slot.
  const losingPayload = bodies[responses.findIndex((r) => r.status === 409)];
  await submit({ ...losingPayload, items: [{ foodItemId: "food-b", quantity: 3 }] }).expect(201);
  assert.deepEqual(await counts(), { InvitedGuests: 2, FoodContributions: 2, PublicRegistrationRequests: 2 });
});

test("missing or inactive foods and a missing or inactive default church roll back registration", async () => {
  const missing = await submit(payload({ items: [{ foodItemId: "missing", quantity: 1 }] })).expect(404);
  assert.equal(missing.body.error.code, "NOT_FOUND");
  await db.collection("FoodItems").doc("food-a").update({ active: false });
  assert.equal((await submit(payload()).expect(409)).body.error.code, "FOOD_ITEM_INACTIVE");
  await db.collection("Churches").doc("wpvlhc-aog").update({ active: false });
  assert.equal((await submit(payload({ items: [] })).expect(503)).body.error.code, "REGISTRATION_UNAVAILABLE");
  await db.collection("Churches").doc("wpvlhc-aog").delete();
  await submit(payload({ items: [] })).expect(503);
  assert.deepEqual(await counts(), { InvitedGuests: 0, FoodContributions: 0, PublicRegistrationRequests: 0 });
  assert.equal((await db.collection("FoodItems").doc("food-b").get()).data().claimedBy, null);
});

test("bringing nothing is valid and equal names are not used as identities", async () => {
  const body = payload({ items: [] });
  const first = (await submit(body).expect(201)).body;
  const second = (await submit({ ...body, requestId: randomUUID() }).expect(201)).body;
  assert.notEqual(first.token, second.token); assert.deepEqual(first.items, []);
  assert.equal((await counts()).InvitedGuests, 2);
});

test("public guests work with existing invitations, admin corrections, reports and exports", async () => {
  const body = payload(); const saved = (await submit(body).expect(201)).body;
  const guest = await request(app).get(`/v1/token/${saved.token}`).expect(200);
  assert.equal(guest.body.name, body.name); assert.equal(guest.body.items[0].quantity, 12);
  await request(app).get(`/v1/token/${saved.token}/status`).expect(200);
  const agent = request.agent(app);
  await admin(agent, "post", "/login", { username: config.username, password: "integration-only" }).expect(200);
  const listing = await agent.get("/v1/admin/guests?rsvp=yes&churchId=wpvlhc-aog").expect(200);
  assert.equal(listing.body.guests[0].token, saved.token);
  const report = (await agent.get("/v1/admin/reports/summary?churchId=wpvlhc-aog").expect(200)).body;
  assert.equal(report.totals.yes, 1); assert.equal(report.totals.contributors, 1);
  assert.equal(report.contributions[0].guestName, body.name);
  assert.match((await agent.get("/v1/admin/reports/guests.csv").expect(200)).text, /John Henry/);
  assert.match((await agent.get("/v1/admin/reports/food.csv").expect(200)).text, /John Henry/);
  await request(app).post(`/v1/token/${saved.token}/reply`).send({ rsvp: "no", items: [] }).expect(200);
  assert.equal((await db.collection("FoodItems").doc("food-a").get()).data().claimedBy, null);
  // Replaying the original POST returns its receipt without undoing a later decline.
  assert.deepEqual((await submit(body).expect(200)).body, saved);
  assert.equal((await request(app).get(`/v1/token/${saved.token}/status`)).body.rsvp, "no");
  assert.equal((await counts()).InvitedGuests, 1);
  await admin(agent, "post", `/guests/${saved.token}/reply`, { rsvp: "yes", items: [{ foodItemId: "food-b", quantity: 4 }] }).expect(200);
  await admin(agent, "patch", `/guests/${saved.token}`, { active: false }).expect(200);
  await request(app).get(`/v1/token/${saved.token}`).expect(410);
  assert.equal((await agent.get("/v1/admin/reports/summary")).body.totals.yes, 0);
});

test("registration enforces JSON, strict fields and the existing origin restrictions", async () => {
  await request(app).post("/v1/registrations").set("Content-Type", "text/plain").send("hello").expect(415);
  await request(app).post("/v1/registrations").set("Content-Type", "application/json").send('{"name":').expect(400);
  await submit(payload()).set("Origin", "https://untrusted.invalid").expect(403);
  const preflight = await request(app).options("/v1/registrations").set("Origin", "http://localhost:3000").set("Access-Control-Request-Method", "POST").set("Access-Control-Request-Headers", "content-type").expect(204);
  assert.equal(preflight.headers["access-control-allow-origin"], "http://localhost:3000");
  for (const changes of [{ requestId: "not-a-uuid" }, { name: "" }, { rsvp: "no" }, { churchId: "other" }, { active: false }, { token: "a".repeat(24) }])
    await submit(payload(changes)).expect(400);
  assert.deepEqual(await counts(), { InvitedGuests: 0, FoodContributions: 0, PublicRegistrationRequests: 0 });
});

test("registration rate limits use the observed IP and cannot be bypassed with forwarded headers", async () => {
  for (const ip of ["::ffff:127.0.0.1", "127.0.0.1", "::1"]) {
    const key = createHash("sha256").update(`registration:${ip}`).digest("hex");
    await db.collection("RateLimits").doc(key).set({ count: 500, expiresAt: Timestamp.fromMillis(Date.now() + 900_000) });
  }
  const response = await submit(payload()).set("X-Forwarded-For", "203.0.113.9").expect(429);
  assert.equal(response.body.error.code, "RATE_LIMITED"); assert.equal(response.headers["retry-after"], "900");
  assert.equal((await counts()).InvitedGuests, 0);
});
