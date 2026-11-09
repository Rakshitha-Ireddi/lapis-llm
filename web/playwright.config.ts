import { defineConfig, devices } from "@playwright/test";

// Locally you can reuse an installed browser instead of downloading one:
//   PW_CHANNEL=msedge npm run test:e2e      (or chrome)
const channel = process.env.PW_CHANNEL || undefined;
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    channel,
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /screenshots\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel },
    },
    {
      name: "mobile",
      testIgnore: /screenshots\.spec\.ts/,
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["Pixel 7"], channel },
    },
    {
      name: "screenshots",
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
