import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("deployment stops without a fresh verified free account and sufficient allowance", async () => {
  const directory = await mkdtemp(`${tmpdir()}/gallery-review-test-`), filename = `${directory}/review.json`;
  const run = () => spawnSync(process.execPath, [resolve(import.meta.dirname, "../scripts/deploy.mjs"), "--dry-run"], { encoding: "utf8", env: { ...process.env, GALLERY_COST_REVIEW_FILE: filename } });
  try {
    assert.equal(run().status, 1);
    const review = { accountId: "a".repeat(32), workersPlan: "paid", r2StorageClass: "Standard", privateBucketsVerified: true, sharedAllowanceProtected: true, checkedAt: new Date().toISOString(), billingStart: new Date(Date.now()-1000).toISOString(), billingEnd: new Date(Date.now()+86400000).toISOString(), otherStorageBytes: 0, otherClassAWrites: 0, otherClassBReads: 0 };
    await writeFile(filename, JSON.stringify(review)); assert.match(run().stderr, /Workers Free/);
    await writeFile(filename, JSON.stringify({ ...review, workersPlan: "free", otherStorageBytes: 9_000_000_000 })); assert.match(run().stderr, /lacks free headroom/);
    await writeFile(filename, JSON.stringify({ ...review, workersPlan: "free", checkedAt: "2020-01-01T00:00:00Z" })); assert.match(run().stderr, /less than 24 hours/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
