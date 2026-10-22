import { resetDatabase } from "../scripts/reset-db";

export default async function setup() {
  await resetDatabase(process.env.TEST_DATABASE_OWNER_URL ?? "postgres://conecta_owner:conecta_owner@localhost:5432/conecta_test", { quiet: true });
}
