import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runAutomations } from "@/server/automations";

/**
 * Punto de entrada para el cron del servidor (p. ej. Vercel Cron o crontab con curl).
 * Requiere `Authorization: Bearer <CRON_SECRET>`.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const jobs = req.nextUrl.searchParams.getAll("job");
  const results = await runAutomations({ triggeredBy: "cron", jobs: jobs.length ? jobs : undefined, force: req.nextUrl.searchParams.get("force") === "1" });
  const failed = results.some((r) => r.status === "failed");
  return NextResponse.json({ ok: !failed, results }, { status: failed ? 500 : 200 });
}
export const GET = handle;
export const POST = handle;
export const dynamic = "force-dynamic";
