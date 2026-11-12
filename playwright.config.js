import { defineConfig, devices } from "@playwright/test";

const DB = process.env.TEST_DATABASE_URL || "postgres://tk:tk@localhost:54329/tk";
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.js",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", locale: "th-TH", timezoneId: "Asia/Bangkok" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node server.js",
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT), POSTGRES_URL: DB, PGSSLMODE: "disable" },
  },
});
