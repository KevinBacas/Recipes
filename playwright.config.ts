import { defineConfig, devices } from "@playwright/test";

try { process.loadEnvFile(".env.local"); } catch { /* CI supplies these variables. */ }
try { process.loadEnvFile(".env.e2e.local"); } catch { /* Never use the household account for tests. */ }
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, timeout: 90000,
  expect: { timeout: 15000 }, reporter: "list",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000", actionTimeout: 15000, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], viewport: { width: 1365, height: 900 } } }, { name: "safari-mobile", use: { ...devices["iPhone 13"] } }],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run start", url: "http://127.0.0.1:3000", reuseExistingServer: true, timeout: 60000 },
});
