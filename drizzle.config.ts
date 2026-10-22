import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL ?? "" },
});
