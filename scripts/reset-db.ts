import "./load-env";
import { Pool } from "pg";
import { runMigrations } from "./migrate";
import { seed } from "./seed";

export async function resetDatabase(url = process.env.DATABASE_OWNER_URL!, opts: { quiet?: boolean } = {}) {
  const pool = new Pool({ connectionString: url, max: 1 });
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await pool.end();
  await runMigrations(url);
  await seed(url, { quiet: opts.quiet });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resetDatabase()
    .then(() => console.log("✓ Base de datos reiniciada"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
