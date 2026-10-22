import { defineConfig } from "@playwright/test";

const DB = process.env.E2E_DATABASE_URL ?? "postgres://conecta_app:conecta_app@localhost:5432/conecta_e2e";
const PORT = 3200;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "es-NI",
    timezoneId: "America/Managua",
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" },
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    env: { DATABASE_URL: DB, CRON_SECRET: "e2e-secret", FILE_STORAGE_DIR: "./storage-e2e", ANTHROPIC_API_KEY: "" },
  },
});
