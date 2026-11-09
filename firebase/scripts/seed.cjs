const path = require("node:path");
const { createRequire } = require("node:module");
const { menu, foodSlots } = require("./seed-data.cjs");
const backendRequire = createRequire(path.resolve(__dirname, "../functions/package.json"));
const { initializeApp } = backendRequire("firebase-admin/app");
const { getFirestore, FieldValue } = backendRequire("firebase-admin/firestore");

async function seedDatabase(db) {
  // FoodItems is the only collection written. Stable IDs make retries safe and
  // preserve any existing edits, claims or unit locks; no guests are generated.
  const refs = foodSlots.map(({ id }) => db.collection("FoodItems").doc(id));
  return db.runTransaction(async (tx) => {
    const existing = await tx.getAll(...refs);
    const timestamp = FieldValue.serverTimestamp();
    let created = 0;
    foodSlots.forEach(({ id, ...item }, index) => {
      if (existing[index].exists) return;
      tx.create(refs[index], { ...item, active: true, hasContributions: false, claimedBy: null, createdAt: timestamp, updatedAt: timestamp });
      created++;
    });
    return { FoodItems: created };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(["--project", "--production", "--dry-run"]);
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index])) throw new Error(`Unknown option: ${args[index]}`);
    if (args[index] === "--project") index++;
  }
  const projectIndex = args.indexOf("--project");
  const projectId = projectIndex === -1 ? "demo-wpvlhc" : args[projectIndex + 1];
  if (!projectId || projectId.startsWith("--")) throw new Error("Provide --project <project-id>");
  const production = args.includes("--production");
  if (production && (projectIndex === -1 || projectId.startsWith("demo-"))) throw new Error("Production seeding requires an explicit real --project ID");
  if (production && process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Unset FIRESTORE_EMULATOR_HOST before production seeding.");
  if (!production && !projectId.startsWith("demo-")) throw new Error("Use a demo- project for local seeding, or explicitly pass --production for a live project.");
  if (args.includes("--dry-run")) {
    console.log(`Food-only seed preview: ${menu.length} menu items, ${foodSlots.length} contribution slots. No database access.`);
    console.table(menu.map(({ name, slots, unit, description }) => ({ Item: name, Slots: slots, Unit: unit, Description: description })));
    return;
  }
  if (!production && !process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 for local seeding. For production, pass --production --project <project-id>.");
  const db = getFirestore(initializeApp({ projectId }));
  try {
    const created = await seedDatabase(db);
    console.log(`Created ${created.FoodItems} food slots in ${projectId}; ${foodSlots.length - created.FoodItems} existing seed slots preserved. No church, guest or contribution records were created or changed.`);
  } finally { await db.terminate(); }
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { seedDatabase };
