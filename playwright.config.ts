import { defineConfig } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never" }]],
  testDir: "tests/e2e",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    channel: "chrome",
    trace: "retain-on-failure",
  },
});
