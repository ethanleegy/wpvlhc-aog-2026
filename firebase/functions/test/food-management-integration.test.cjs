const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createApp } = require("../src/app");

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith("demo-")) throw new Error("Food management tests require an isolated demo Firestore emulator.");
let firebaseApp, db, app, agent;
const token = "a".repeat(24);
const config = { local: true, username: "testadmin", passwordHash: bcrypt.hashSync("local-test", 4), jwtSecret: "food-management-only-".repeat(4), siteUrl: "http://localhost:3000/", origins: ["http://localhost:3000"] };
const mutate = (method, path, body = {}, client = agent) => client[method](`/v1/admin${path}`).set("X-Admin-Request", "true").send(body);
const imported = (items = [{ name: "New rice", unit: "servings" }]) => ({ requestId: randomUUID(), items });
before(async () => {
  firebaseApp = initializeApp({ projectId: `${process.env.GCLOUD_PROJECT}-food-management` }, "food-management");
  db = getFirestore(firebaseApp);
  app = createApp({ getDb: () => db, getConfig: () => config, logger: { error() {} } });
});
beforeEach(async () => {
  assert.equal((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${firebaseApp.options.projectId}/databases/(default)/documents`, { method: "DELETE" })).status, 200);
  await db.collection("Churches").doc("wpvlhc-aog").set({ name: "WPVLHC AOG", active: true });
  await db.collection("InvitedGuests").doc(token).set({ name: "Guest", personalizedName: "", churchId: "wpvlhc-aog", active: true, rsvp: "yes", plusOne: true, plusOneName: "Companion" });
  for (const id of ["rice", "juice", "cake"]) await db.collection("FoodItems").doc(id).set({ name: id, unit: "servings", description: "", active: true, claimedBy: id === "cake" ? null : token, hasContributions: id !== "cake" });
  await db.collection("FoodContributions").doc(token).set({ guestId: token, items: ["rice", "juice"].map((id) => ({ foodItemId: id, quantity: 4, notes: "Saved", name: id, unit: "servings" })) });
  agent = request.agent(app);
  await mutate("post", "/login", { username: config.username, password: "local-test" }).expect(200);
});
after(async () => { await db?.terminate(); if (firebaseApp) await deleteApp(firebaseApp); });

test("food mutations require admin authentication, mutation headers, JSON and valid bounded inputs", async () => {
  await mutate("delete", "/food-items/cake", {}, request(app)).expect(401);
  await mutate("post", "/food-items/import", imported(), request(app)).expect(401);
  await agent.delete("/v1/admin/food-items/cake").send({}).expect(403);
  await agent.delete("/v1/admin/food-items/cake").set("X-Admin-Request", "true").expect(415);
  await mutate("delete", "/food-items/cake").set("Origin", "https://invalid.test").expect(403);
  for (const body of [{ ids: [] }, { ids: ["cake", "cake"] }, { ids: ["bad/id"] }, { ids: Array.from({ length: 51 }, (_, i) => `item-${i}`) }, { ids: ["cake"], confirmation: "DELETE" }]) await mutate("post", "/food-items/bulk-delete", body).expect(400);
  for (const body of [imported([]), imported(Array.from({ length: 11 }, () => ({ name: "X", unit: "pieces" }))), { ...imported(), requestId: "guessable" }, imported([{ name: "X", unit: "pieces", claimedBy: token }])]) await mutate("post", "/food-items/import", body).expect(400);
  const cors = await request(app).options("/v1/admin/food-items/cake").set("Origin", "http://localhost:3000").set("Access-Control-Request-Method", "DELETE").set("Access-Control-Request-Headers", "content-type,x-admin-request").expect(204);
  assert.match(cors.headers["access-control-allow-methods"], /DELETE/);
  assert.equal((await db.collection("FoodItems").get()).size, 3);
});

test("unused food deletion and repeated deletes are safe without disturbing guest choices", async () => {
  const first = (await mutate("delete", "/food-items/cake").expect(200)).body;
  assert.deepEqual(first, { deletedIds: ["cake"], missingIds: [], affectedGuests: 0, removedChoices: 0 });
  assert.deepEqual((await mutate("delete", "/food-items/cake").expect(200)).body.missingIds, ["cake"]);
  assert.equal((await db.collection("FoodContributions").doc(token).get()).data().items.length, 2);
});

test("selected food deletion requires the exact confirmation and keeps a mixed batch atomic", async () => {
  const denied = await mutate("post", "/food-items/bulk-delete", { ids: ["cake", "rice"] }).expect(409);
  assert.equal(denied.body.error.code, "FOOD_DELETE_CONFIRMATION_REQUIRED");
  assert.equal((await db.collection("FoodItems").get()).size, 3);
  await mutate("delete", "/food-items/rice", { confirmation: "wrong" }).expect(400);
  const result = (await mutate("delete", "/food-items/rice", { confirmation: "delete" }).expect(200)).body;
  assert.equal(result.affectedGuests, 1); assert.equal(result.removedChoices, 1);
  const guest = (await request(app).get(`/v1/token/${token}`).expect(200)).body;
  assert.equal(guest.rsvp, "yes"); assert.equal(guest.plusOneName, "Companion"); assert.deepEqual(guest.items.map((item) => item.foodItemId), ["juice"]);
  const report = (await agent.get("/v1/admin/reports/summary").expect(200)).body;
  assert.equal(report.totals.attendingPeople, 2); assert.equal(report.totals.contributors, 1);
  assert.equal(report.contributions.length, 1); assert.equal(report.foodItems.some((food) => food.foodItemId === "rice"), false);
  await mutate("post", "/food-items/bulk-delete", { ids: ["juice", "cake"], confirmation: "delete" }).expect(200);
  const empty = (await agent.get("/v1/admin/reports/summary")).body;
  assert.equal(empty.totals.contributors, 0); assert.equal(empty.totals.attendingPeople, 2);
});

test("deletion also clears inactive and legacy references even when the claim field is missing", async () => {
  await db.collection("FoodItems").doc("rice").update({ claimedBy: null });
  await db.collection("InvitedGuests").doc(token).update({ active: false });
  await mutate("delete", "/food-items/rice").expect(409);
  await mutate("delete", "/food-items/rice", { confirmation: "delete" }).expect(200);
  assert.deepEqual((await db.collection("FoodContributions").doc(token).get()).data().items.map((item) => item.foodItemId), ["juice"]);
  await mutate("patch", `/guests/${token}`, { active: true }).expect(200);
  assert.equal((await request(app).get(`/v1/token/${token}`)).body.items.length, 1);
});

test("concurrent claiming and deletion cannot leave a dangling food selection", async () => {
  const reply = request(app).post(`/v1/token/${token}/reply`).send({ rsvp: "yes", items: [{ foodItemId: "cake", quantity: 3 }] });
  const [claimed, deleted] = await Promise.all([reply, mutate("delete", "/food-items/cake", { confirmation: "delete" })]);
  assert.ok([200, 404].includes(claimed.status)); assert.equal(deleted.status, 200);
  assert.equal((await db.collection("FoodItems").doc("cake").get()).exists, false);
  assert.equal((await db.collection("FoodContributions").doc(token).get()).data().items.some((item) => item.foodItemId === "cake"), false);
});

test("CSV batches create duplicate-name slots atomically and identical concurrent retries do not duplicate them", async () => {
  const body = imported([{ name: "Rice", unit: "servings" }, { name: "Rice", unit: "servings", description: "Second slot", active: false }]);
  const responses = await Promise.all([mutate("post", "/food-items/import", body), mutate("post", "/food-items/import", body)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  assert.deepEqual(responses[0].body, responses[1].body);
  assert.equal(responses[0].body.count, 2); assert.equal(new Set(responses[0].body.ids).size, 2);
  const replay = await mutate("post", "/food-items/import", { requestId: body.requestId.toUpperCase(), items: [{ active: true, description: "", unit: "servings", name: "Rice" }, { active: false, unit: "servings", name: "Rice", description: "Second slot" }] }).expect(200);
  assert.deepEqual(replay.body, responses[0].body);
  assert.equal((await db.collection("FoodItems").get()).size, 5); assert.equal((await db.collection("FoodImportRequests").get()).size, 1);
  for (const id of replay.body.ids) assert.equal((await db.collection("FoodItems").doc(id).get()).data().claimedBy, null);
  await mutate("post", "/food-items/import", { ...body, items: [{ name: "Changed", unit: "pieces" }] }).expect(409);
  await mutate("post", "/food-items/bulk-delete", { ids: replay.body.ids }).expect(200);
  assert.deepEqual((await mutate("post", "/food-items/import", body).expect(200)).body, replay.body);
  assert.equal((await db.collection("FoodItems").get()).size, 3);
});
