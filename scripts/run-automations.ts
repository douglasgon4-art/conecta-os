import "./load-env";
import { runAutomations } from "../src/server/automations";
import { pool } from "../src/server/db";

// Uso: npm run cron [-- --force] [-- --job=session_alerts]
const force = process.argv.includes("--force");
const jobs = process.argv.filter((a) => a.startsWith("--job=")).map((a) => a.slice(6));

runAutomations({ triggeredBy: "script", force, jobs: jobs.length ? jobs : undefined })
  .then((r) => {
    for (const x of r) console.log(`${x.status.padEnd(9)} ${x.job}${x.stats ? " " + JSON.stringify(x.stats) : ""}${x.error ? " ERROR: " + x.error : ""}`);
    process.exitCode = r.some((x) => x.status === "failed") ? 1 : 0;
  })
  .finally(() => pool.end());
