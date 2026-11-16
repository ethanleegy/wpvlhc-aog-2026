import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(new URL("../firebase/admin-dashboard/package.json", import.meta.url));
const { defineConfig } = require("@playwright/test");

export default defineConfig({
  testDir: resolve(import.meta.dirname, "../firebase/admin-dashboard/test"),
  testMatch: "gallery-verification.spec.js", workers: 1, timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:5187", browserName: "chromium", channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    viewport: { width: 390, height: 844 }, trace: "retain-on-failure" },
  outputDir: resolve(import.meta.dirname, "../test-results/gallery-verification"),
  webServer: { command: "npm --prefix gallery-client run dev -- --port 5187 --strictPort", cwd: resolve(import.meta.dirname, ".."),
    url: "http://127.0.0.1:5187", reuseExistingServer: false },
});
