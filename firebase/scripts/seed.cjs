const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createRequire } = require("node:module");
const { memberNames, foodSlots } = require("./seed-data.cjs");
const backendRequire = createRequire(
  path.resolve(__dirname, "../functions/package.json"),
);
const { initializeApp } = backendRequire("firebase-admin/app");
const { getFirestore, FieldValue } = backendRequire("firebase-admin/firestore");

async function seedDatabase(db) {
  // Persist random invitation codes once, so rerunning the seed never creates
  // duplicate people or replaces codes/names that management already edited.
  const stateRef = db.collection("SeedData").doc("gala-2026-members");
  const tokens = await db.runTransaction(async (tx) => {
    const state = await tx.get(stateRef);
    const existing = state.data()?.memberTokens || [];
    const values = [...existing];
    while (values.length < memberNames.length)
      values.push(randomBytes(12).toString("hex"));
    if (!state.exists || values.length !== existing.length) {
      tx.set(stateRef, { memberTokens: values }, { merge: true });
    }
    return values;
  });
  const timestamp = FieldValue.serverTimestamp();
  const records = [
    [
      "Churches",
      "wpvlhc-aog",
      {
        name: "World Prayer Vision Life Healing Center Assembly of God",
        active: true,
      },
    ],
    ...memberNames.map((name, index) => [
      "InvitedGuests",
      tokens[index],
      {
        name,
        personalizedName: "",
        churchId: "wpvlhc-aog",
        active: true,
        rsvp: "pending",
        respondedAt: null,
      },
    ]),
    ...foodSlots.map(({ id, ...item }) => [
      "FoodItems",
      id,
      {
        ...item,
        active: true,
        hasContributions: false,
        claimedBy: null,
      },
    ]),
  ];
  const created = { Churches: 0, InvitedGuests: 0, FoodItems: 0 };
  for (const [collection, id, data] of records) {
    try {
      await db
        .collection(collection)
        .doc(id)
        .create({ ...data, createdAt: timestamp, updatedAt: timestamp });
      created[collection] += 1;
    } catch (error) {
      if (error.code !== 6 && error.code !== "already-exists") throw error;
    }
  }
  return created;
}

async function main() {
  const args = process.argv.slice(2);
  const projectIndex = args.indexOf("--project");
  const projectId =
    projectIndex === -1 ? "demo-wpvlhc" : args[projectIndex + 1];
  if (!projectId || projectId.startsWith("--"))
    throw new Error("Provide --project <project-id>");
  if (args.includes("--dry-run")) {
    console.log(
      `Seed preview: 1 church, ${memberNames.length} sample members, ${foodSlots.length} food slots (${foodSlots.length / 3} menu items × 3). No database access.`,
    );
    return;
  }
  if (!process.env.FIRESTORE_EMULATOR_HOST && !args.includes("--production")) {
    throw new Error(
      "Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080. For production, explicitly pass --production --project <project-id>.",
    );
  }
  if (
    args.includes("--production") &&
    (projectIndex === -1 || projectId.startsWith("demo-"))
  ) {
    throw new Error(
      "Production seeding requires an explicit real --project ID",
    );
  }
  const db = getFirestore(initializeApp({ projectId }));
  try {
    const created = await seedDatabase(db);
    console.log(
      `Created ${created.Churches} churches, ${created.InvitedGuests} sample members and ${created.FoodItems} food slots in ${projectId}; existing records were preserved.`,
    );
  } finally {
    await db.terminate();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { seedDatabase };
