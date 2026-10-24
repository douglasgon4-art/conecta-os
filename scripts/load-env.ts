import { existsSync, readFileSync } from "node:fs";

// Carga mínima de .env para scripts (Next.js carga .env por su cuenta).
const file = process.env.ENV_FILE ?? ".env";
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

/** Limpia espacios, saltos de línea y comillas pegadas por error al copiar en el panel del proveedor. */
export const cleanedEnv: string[] = [];
for (const key of ["DATABASE_URL", "DATABASE_OWNER_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"]) {
  const v = process.env[key];
  if (v === undefined) continue;
  const clean = v.trim().replace(/^["']|["']$/g, "").trim();
  if (clean !== v) {
    process.env[key] = clean;
    cleanedEnv.push(key);
  }
}
