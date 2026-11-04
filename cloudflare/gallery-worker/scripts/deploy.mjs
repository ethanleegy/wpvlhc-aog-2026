import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
try {
  const review = JSON.parse(await readFile(process.env.GALLERY_COST_REVIEW_FILE || `${root}/.gallery-local/cloudflare-review.json`, "utf8"));
  const now = Date.now(), checked = Date.parse(review.checkedAt), start = Date.parse(review.billingStart), end = Date.parse(review.billingEnd);
  if (!/^[a-f0-9]{32}$/.test(review.accountId || "") || review.workersPlan !== "free" || review.r2StorageClass !== "Standard" || review.privateBucketsVerified !== true || review.sharedAllowanceProtected !== true)
    throw new Error("Verify the intended account, Workers Free, Standard storage, private buckets and protected shared allowances first.");
  if (!Number.isFinite(checked) || checked > now || now - checked > 86400000 || !(start <= now && now < end) || end - start > 31 * 86400000)
    throw new Error("The account review must be less than 24 hours old and cover the current billing period (at most 31 days).");
  for (const [field, reserve, free] of [["otherStorageBytes", 6_000_000_000, 10_000_000_000], ["otherClassAWrites", 100_000, 1_000_000], ["otherClassBReads", 3_300_000, 10_000_000]])
    if (!Number.isSafeInteger(review[field]) || review[field] < 0 || review[field] + reserve > free) throw new Error(`The reviewed account lacks free headroom for ${field}.`);
  const api = new URL(review.apiBase);
  if (api.protocol !== "https:" || api.username || api.password || !api.pathname.endsWith("/v1") || api.search || api.hash) throw new Error("Use the deployed HTTPS Firebase API base ending in /v1.");
  if (!Array.isArray(review.allowedOrigins) || !review.allowedOrigins.length || review.allowedOrigins.some(origin => new URL(origin).origin !== origin || !origin.startsWith("https://"))) throw new Error("Production origins must be exact HTTPS origins.");
  const directory = `${root}/.gallery-local`; await mkdir(directory, { recursive: true });
  const config = JSON.parse(await readFile(`${root}/cloudflare/gallery-worker/wrangler.jsonc`, "utf8"));
  config.account_id = review.accountId;
  config.main = `${root}/cloudflare/gallery-worker/src/worker.mjs`;
  config.vars = { API_BASE: review.apiBase, ALLOWED_ORIGINS: review.allowedOrigins.join(","), COST_APPROVAL_EXPIRES_AT: review.billingEnd };
  config.r2_buckets = config.r2_buckets.map(({ remote, ...binding }) => binding);
  const filename = `${directory}/wrangler.production.json`;
  await writeFile(filename, JSON.stringify(config, null, 2));
  const dry = process.argv.includes("--dry-run");
  const result = spawnSync(process.execPath, [`${root}/cloudflare/gallery-worker/node_modules/wrangler/bin/wrangler.js`, "deploy", "--config", filename, ...(dry ? ["--dry-run"] : [])], { cwd: root, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`Gallery deployment stopped: ${error.message}\nNo account review is inferred from local tests. See cloudflare/gallery-worker/README.md.`);
  process.exitCode = 1;
}
