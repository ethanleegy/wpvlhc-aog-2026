import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(new URL("../firebase/admin-dashboard/package.json", import.meta.url));
const { defineConfig } = require("@playwright/test");
export default defineConfig({
  testDir: resolve(import.meta.dirname, "../firebase/admin-dashboard/test"), testMatch: "gallery.spec.js", workers: 1, timeout: 90_000,
  use: { browserName: "chromium", channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", viewport: { width: 1280, height: 900 }, actionTimeout: 10_000, trace: "retain-on-failure" },
  outputDir: resolve(import.meta.dirname, "../test-results/gallery"),
  webServer: { command: "node scripts/gallery-local.mjs", cwd: resolve(import.meta.dirname, ".."), url: "http://127.0.0.1:5999/v1/ready", reuseExistingServer: true, timeout: 90_000 },
});
