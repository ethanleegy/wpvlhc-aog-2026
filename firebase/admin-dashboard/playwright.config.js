import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  // This fixture suite owns a separate guest server and is run from the root.
  testIgnore: "gallery-verification.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 10000,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    env: {
      API_PROXY_TARGET: "http://127.0.0.1:5001/demo-wpvlhc/us-central1/api",
    },
  },
});
