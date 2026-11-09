const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createApp } = require("../src/app");

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith("demo-")) throw new Error("People deletion tests require an isolated demo Firestore emulator.");
const a = "a".repeat(24), b = "b".repeat(24), c = "c".repeat(24);
let firebaseApp, db, app, agent;
const config = { local: true, username: "testadmin", passwordHash: bcrypt.hashSync("local-test", 4), jwtSecret: "people-management-only-".repeat(4), siteUrl: "http://localhost:3000/", origins: ["http://localhost:3000"] };
const mutate = (method, path, body = {}, client = agent) => client[method](`/v1/admin${path}`).set("X-Admin-Request", "true").send(body);
const remove = (id, body = { confirmation: "delete" }) => mutate("delete", `/guests/${id}`, body);
before(async () => {
  firebaseApp = initializeApp({ projectId: `${process.env.GCLOUD_PROJECT}-people-management` }, "people-management");
  db = getFirestore(firebaseApp); app = createApp({ getDb: () => db, getConfig: () => config, logger: { error() {} } });
});
beforeEach(async () => {
  assert.equal((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${firebaseApp.options.projectId}/databases/(default)/documents`, { method: "DELETE" })).status, 200);
  await db.collection("Churches").doc("wpvlhc-aog").set({ name: "WPVLHC AOG", active: true });
  for (const [id, name] of [[a, "Alice"], [b, "Ben"]]) await db.collection("InvitedGuests").doc(id).set({ name, personalizedName: "", churchId: "wpvlhc-aog", rsvp: "yes", active: true, plusOne: id === a, plusOneName: id === a ? "Companion" : "" });
  for (const [id, owner, active] of [["rice", a, true], ["juice", a, false], ["orphan", a, true], ["cake", b, true], ["water", null, true]])
    await db.collection("FoodItems").doc(id).set({ name: id, unit: "servings", active, description: "", claimedBy: owner, hasContributions: !!owner });
  for (const [id, foodIds] of [[a, ["rice", "juice"]], [b, ["cake"]]]) await db.collection("FoodContributions").doc(id).set({ guestId: id, items: foodIds.map((foodItemId) => ({ foodItemId, quantity: 5, name: foodItemId, unit: "servings", notes: "Saved choice" })) });
  agent = request.agent(app);
  await mutate("post", "/login", { username: config.username, password: "local-test" }).expect(200);
});
after(async () => { await db?.terminate(); if (firebaseApp) await deleteApp(firebaseApp); });

test("people deletion requires admin access, JSON, bounded guest IDs and the exact confirmation", async () => {
  await mutate("delete", `/guests/${a}`, { confirmation: "delete" }, request(app)).expect(401);
  await mutate("post", "/guests/bulk-delete", { ids: [a], confirmation: "delete" }, request(app)).expect(401);
  await agent.delete(`/v1/admin/guests/${a}`).send({ confirmation: "delete" }).expect(403);
  await agent.delete(`/v1/admin/guests/${a}`).set("X-Admin-Request", "true").expect(415);
  await remove(a).set("Origin", "https://invalid.test").expect(403);
  assert.equal((await remove(a, {}).expect(409)).body.error.code, "GUEST_DELETE_CONFIRMATION_REQUIRED");
  await remove(a, { confirmation: "DELETE" }).expect(400);
  for (const body of [{ ids: [] }, { ids: [a, a] }, { ids: ["name-only"] }, { ids: Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(24, "0")) }, { ids: [a], confirmation: "yes" }, { ids: [a], confirmation: "delete", all: true }]) await mutate("post", "/guests/bulk-delete", body).expect(400);
  await mutate("post", "/guests/bulk-delete", { ids: [a] }).expect(409);
  assert.equal((await db.collection("InvitedGuests").get()).size, 2);
});

test("deleting an attending person removes their companion and choices, releases slots and updates reports", async () => {
  const result = (await remove(a).expect(200)).body;
  assert.deepEqual(result, { deletedIds: [a], missingIds: [], releasedFoodSlots: 3, removedChoices: 2 });
  assert.equal((await db.collection("InvitedGuests").doc(a).get()).exists, false);
  assert.equal((await db.collection("FoodContributions").doc(a).get()).exists, false);
  for (const id of ["rice", "juice", "orphan"]) {
    const food = (await db.collection("FoodItems").doc(id).get()).data();
    assert.equal(food.claimedBy, null); assert.equal(food.hasContributions, true);
  }
  assert.equal((await db.collection("FoodItems").doc("juice").get()).data().active, false);
  assert.equal((await db.collection("FoodItems").doc("cake").get()).data().claimedBy, b);
  await request(app).get(`/v1/token/${a}`).expect(404);
  await request(app).get(`/v1/token/${a}/status`).expect(404);
  await request(app).post(`/v1/token/${a}/reply`).send({ rsvp: "yes", items: [] }).expect(404);
  await agent.get(`/v1/admin/guests/${a}`).expect(404);
  const report = (await agent.get("/v1/admin/reports/summary").expect(200)).body;
  assert.equal(report.totals.attendingPeople, 1); assert.equal(report.totals.plusOnes, 0); assert.equal(report.totals.contributors, 1);
  assert.deepEqual(report.contributions.map((item) => item.guestName), ["Ben"]);
  const available = (await request(app).get("/v1/food-items").expect(200)).body.foodItems.map((item) => item.id);
  assert.ok(available.includes("rice")); assert.ok(available.includes("orphan")); assert.equal(available.includes("juice"), false);
  assert.equal((await agent.get("/v1/admin/reports/guests.csv")).text.includes("Alice"), false);
});

test("bulk deletion covers pending and inactive guests, preserves catalogue records and permits safe retries", async () => {
  await db.collection("InvitedGuests").doc(a).update({ active: false });
  await db.collection("InvitedGuests").doc(c).set({ name: "Pending", churchId: "wpvlhc-aog", active: true, rsvp: "pending" });
  const result = (await mutate("post", "/guests/bulk-delete", { ids: [a, b, c], confirmation: "delete" }).expect(200)).body;
  assert.deepEqual(result.deletedIds, [a, b, c]); assert.equal(result.releasedFoodSlots, 4);
  assert.equal((await db.collection("InvitedGuests").get()).size, 0);
  assert.equal((await db.collection("FoodContributions").get()).size, 0);
  assert.equal((await db.collection("FoodItems").get()).size, 5);
  const repeated = (await mutate("post", "/guests/bulk-delete", { ids: [a, c], confirmation: "delete" }).expect(200)).body;
  assert.deepEqual(repeated, { deletedIds: [], missingIds: [a, c], releasedFoodSlots: 0, removedChoices: 0 });
});

test("public retry receipts are redacted and cannot recreate or reveal a deleted registration", async () => {
  const body = { requestId: randomUUID(), name: "Private Person", plusOne: true, plusOneName: "Private Companion", items: [{ foodItemId: "water", quantity: 2 }] };
  const saved = (await request(app).post("/v1/registrations").send(body).expect(201)).body;
  const receiptRef = (await db.collection("PublicRegistrationRequests").get()).docs[0].ref;
  const fingerprint = (await receiptRef.get()).data().fingerprint;
  await remove(saved.token).expect(200);
  const tombstone = (await receiptRef.get()).data();
  assert.deepEqual(Object.keys(tombstone).sort(), ["deletedAt", "fingerprint"]);
  assert.equal(tombstone.fingerprint, fingerprint); assert.ok(tombstone.deletedAt.toDate());
  const replay = await request(app).post("/v1/registrations").send(body).expect(410);
  assert.equal(replay.body.error.code, "REGISTRATION_DELETED");
  assert.equal(JSON.stringify(replay.body).includes("Private Person"), false);
  assert.equal((await db.collection("InvitedGuests").doc(saved.token).get()).exists, false);
  const fresh = (await request(app).post("/v1/registrations").send({ ...body, requestId: randomUUID() }).expect(201)).body;
  assert.notEqual(fresh.token, saved.token);
});

test("concurrent RSVP edits and deletion cannot retain orphan contributions or reservations", async () => {
  const response = request(app).post(`/v1/token/${a}/reply`).send({ rsvp: "yes", items: [{ foodItemId: "water", quantity: 2 }] });
  const [reply, deleted] = await Promise.all([response, remove(a)]);
  assert.ok([200, 404].includes(reply.status)); assert.equal(deleted.status, 200);
  assert.equal((await db.collection("FoodContributions").doc(a).get()).exists, false);
  assert.equal((await db.collection("FoodItems").where("claimedBy", "==", a).get()).size, 0);
  assert.equal((await db.collection("FoodItems").doc("cake").get()).data().claimedBy, b);
});

test("retrying a missing person still cleans orphan choices and reservations", async () => {
  await db.collection("InvitedGuests").doc(a).delete();
  const result = (await remove(a).expect(200)).body;
  assert.deepEqual(result.missingIds, [a]); assert.equal(result.removedChoices, 2); assert.equal(result.releasedFoodSlots, 3);
  assert.equal((await db.collection("FoodContributions").doc(a).get()).exists, false);
});

test("bulk deletion spans query groups and redacts every matching public receipt", async () => {
  const ids = [];
  for (let index = 0; index < 12; index++) ids.push((await request(app).post("/v1/registrations").send({ requestId: randomUUID(), name: `Public ${index}`, items: [] }).expect(201)).body.token);
  const result = (await mutate("post", "/guests/bulk-delete", { ids, confirmation: "delete" }).expect(200)).body;
  assert.deepEqual(result.deletedIds, ids);
  const receipts = (await db.collection("PublicRegistrationRequests").get()).docs;
  assert.equal(receipts.length, 12); assert.ok(receipts.every((doc) => doc.data().deletedAt && !doc.data().registration));
  assert.equal((await db.collection("InvitedGuests").get()).size, 2);
});
