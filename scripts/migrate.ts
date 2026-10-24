import "./load-env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { describeConnection, explainDbError } from "./db-diagnose";

export async function runMigrations(url = process.env.DATABASE_OWNER_URL!) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(describeConnection("DATABASE_OWNER_URL", process.env.DATABASE_OWNER_URL));
  console.log(describeConnection("DATABASE_URL", process.env.DATABASE_URL));
  runMigrations()
    .then(() => console.log("✓ Migraciones aplicadas"))
    .catch((e) => {
      console.error(explainDbError(e));
      process.exit(1);
    });
}
