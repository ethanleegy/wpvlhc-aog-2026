import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "dashboard.spec.js",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5186",
    browserName: "chromium",
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5186",
    url: "http://127.0.0.1:5186",
    reuseExistingServer: false,
    // All API traffic in this suite is intercepted; a missing fixture cannot hit an emulator/live API.
    env: { API_PROXY_TARGET: "http://127.0.0.1:1" },
  },
});
