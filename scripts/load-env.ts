import { existsSync, readFileSync } from "node:fs";

// Carga mínima de .env para scripts (Next.js carga .env por su cuenta).
const file = process.env.ENV_FILE ?? ".env";
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
