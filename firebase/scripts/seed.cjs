const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const YAML = require("yaml");
const backendRequire = createRequire(
  path.resolve(__dirname, "../functions/package.json"),
);
const { initializeApp } = backendRequire("firebase-admin/app");
const { getFirestore, FieldValue } = backendRequire("firebase-admin/firestore");

async function main() {
  const args = process.argv.slice(2);
  const projectIndex = args.indexOf("--project");
  const projectId =
    projectIndex === -1 ? "demo-wpvlhc" : args[projectIndex + 1];
  if (!projectId || projectId.startsWith("--"))
    throw new Error("Provide --project <project-id>");
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
  const items = YAML.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../_data/food_items.yml"),
      "utf8",
    ),
  );
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
    ...items.map((item) => [
      "FoodItems",
      `food-${item.number}`,
      {
        name: item.label,
        description: "",
        unit: "servings",
        active: true,
        hasContributions: false,
      },
    ]),
  ];
  let created = 0;
  for (const [collection, id, data] of records) {
    try {
      await db
        .collection(collection)
        .doc(id)
        .create({ ...data, createdAt: timestamp, updatedAt: timestamp });
      created += 1;
    } catch (error) {
      if (error.code !== 6 && error.code !== "already-exists") throw error;
    }
  }
  console.log(
    `Created ${created} records in ${projectId}; existing records were preserved. No guest invitations were generated.`,
  );
  await db.terminate();
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
