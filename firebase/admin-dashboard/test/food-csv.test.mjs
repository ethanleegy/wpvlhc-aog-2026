import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFoodCsv, foodImportBatches } from "../src/food-csv.js";

test("food CSV accepts BOM, commas, escaped quotes, multiline descriptions and repeated slots", () => {
  const items = parseFoodCsv('\uFEFFName,Unit,Description,Active\r\n Rice , servings ,"Homemade, ""warm""\r\nKeep covered",true\r\nRice,servings,,false\r\n\r\n');
  assert.deepEqual(items, [{ name: "Rice", unit: "servings", description: 'Homemade, "warm"\nKeep covered', active: true }, { name: "Rice", unit: "servings", description: "", active: false }]);
});
test("food catalogue exports can be imported as new unclaimed slots", () => {
  assert.deepEqual(parseFoodCsv('#,Item,Unit,Description,Status\n1,Chicken,servings,Cooked,Taken\n2,Water,bottles,,Available\n3,Old,pieces,,Inactive').map((item) => item.active), [true, true, false]);
  assert.deepEqual(parseFoodCsv("Name,Unit\nFruit juice,bottles"), [{ name: "Fruit juice", unit: "bottles", description: "", active: true }]);
});
test("invalid headers, malformed quoting, wrong column counts and invalid fields fail before importing", () => {
  for (const csv of ["", "Name,Unit", "Name\nRice", "Name,Item,Unit\nA,B,C", "Name,Unit,claimedBy\nA,B,x", "Name,Unit\n\"Rice,servings", 'Name,Unit\nRi"ce,servings', 'Name,Unit\n"Rice"x,servings', "Name,Unit\nRice,servings,extra", "Name,Unit\nRice,", "Name,Unit\n,servings", "Name,Unit,Active\nRice,servings,maybe", "Name,Unit,Status\nRice,servings,missing", "Name,Unit,Active,Status\nRice,servings,true,Available", `Name,Unit\n${"N".repeat(161)},servings`, `Name,Unit,Description\nRice,servings,${"x".repeat(501)}`]) assert.throws(() => parseFoodCsv(csv));
});
test("food CSV row and size limits are bounded and errors identify the line", () => {
  assert.equal(parseFoodCsv("Name,Unit\n" + Array.from({ length: 2000 }, () => "Rice,servings").join("\n")).length, 2000);
  assert.throws(() => parseFoodCsv("Name,Unit\n" + Array.from({ length: 2001 }, () => "Rice,servings").join("\n")), /2,000/);
  assert.throws(() => parseFoodCsv("x".repeat(8_000_001)), /8 MB/);
  assert.throws(() => parseFoodCsv("Name,Unit\nRice,servings\nWater,"), /line 3/);
});

test("import batches stay below the API byte limit even with JSON-escaped text", () => {
  const items = Array.from({ length: 25 }, () => ({ name: "\u0001".repeat(160), unit: "\u0001".repeat(40), description: "\u0001".repeat(500), active: true }));
  const batches = foodImportBatches(items);
  assert.deepEqual(batches.flatMap((batch) => batch.items), items);
  assert.equal(new Set(batches.map((batch) => batch.requestId)).size, batches.length);
  for (const batch of batches) {
    assert.ok(batch.items.length <= 10);
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) < 32 * 1024);
  }
});
