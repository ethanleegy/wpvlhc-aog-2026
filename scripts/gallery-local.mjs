import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, ".."), require = createRequire(`${root}/firebase/functions/package.json`);
const bcrypt = require("bcryptjs");
const directory = `${root}/.gallery-local`;
await mkdir(directory, { recursive: true });
const ticket = randomBytes(48).toString("hex"), internal = randomBytes(48).toString("hex"), claim = randomBytes(48).toString("hex");
const start = new Date(Date.now() - 60_000).toISOString(), end = new Date(Date.now() + 7 * 86400000).toISOString();
const env = { ...process.env, LOCAL_DEVELOPMENT: "true", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", GCLOUD_PROJECT: "demo-wpvlhc", ADMIN_USERNAME: "localadmin", ADMIN_PASSWORD_HASH: bcrypt.hashSync("local-gallery-only", 8), ADMIN_JWT_SECRET: randomBytes(48).toString("hex"), PUBLIC_SITE_URL: "http://127.0.0.1:5174/", ALLOWED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:5174", GALLERY_ENABLED: "true", GALLERY_TICKET_SECRET: ticket, GALLERY_INTERNAL_SECRET: internal, GALLERY_CLAIM_SECRET: claim, GALLERY_WORKER_URL: "http://127.0.0.1:8787", GALLERY_BILLING_START: start, GALLERY_BILLING_END: end, API_PROXY_TARGET: "http://127.0.0.1:5999", PORT: "5999" };
if (process.platform === "darwin") {
  try {
    env.JAVA_HOME = execFileSync("/usr/libexec/java_home", ["-v", "21"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    env.PATH = `${env.JAVA_HOME}/bin:${env.PATH}`;
  } catch { /* The emulator reports a missing Java 21 installation clearly. */ }
}
const vars = `${directory}/worker.vars`;
await writeFile(vars, `TICKET_SECRET=${ticket}\nINTERNAL_SECRET=${internal}\nCLAIM_SECRET=${claim}\nCOST_APPROVAL_EXPIRES_AT=${end}\n`, { mode: 0o600 });
const children = [];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill("SIGTERM"); process.exitCode = code; }
process.on("SIGINT", () => stop()); process.on("SIGTERM", () => stop());
function run(command, args, cwd = root) {
  const child = spawn(command, args, { cwd, env, stdio: "inherit" }); children.push(child);
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code || 1); });
  return child;
}
async function ready(url, timeout = 60_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until && !stopping) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Local service did not start: ${url}`);
}
try {
  // Only demo Firestore and local R2 are used; production credentials are ignored.
  run(process.execPath, ["node_modules/firebase-tools/lib/bin/firebase.js", "emulators:start", "--project", "demo-wpvlhc", "--only", "firestore"], `${root}/firebase`);
  await ready("http://127.0.0.1:8080/");
  run(process.execPath, ["--watch", "firebase/functions/src/dev.js"]);
  await ready("http://127.0.0.1:5999/v1/ready");
  run(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--ip", "127.0.0.1", "--port", "8787", "--persist-to", `${directory}/r2`, "--env-file", vars], `${root}/cloudflare/gallery-worker`);
  await ready("http://127.0.0.1:8787/ready");
  run(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5174", "--strictPort"], `${root}/gallery-client`);
  run(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], `${root}/firebase/admin-dashboard`);
  await ready("http://127.0.0.1:5174/");
  console.log("\nLocal gallery: http://127.0.0.1:5174/\nManagement: http://127.0.0.1:5173/\nLocal demo login: localadmin / local-gallery-only\nNo Cloudflare resources are used. Stop with Ctrl+C.\n");
} catch (error) { console.error(error.message); stop(1); }
