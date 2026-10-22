import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth/session";
import { audit, requirePerm, withCtx } from "@/server/ctx";
import { DATASETS, reportRows, toCSV, type Dataset } from "@/server/services/reports";
import { AppError } from "@/server/errors";

export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const dataset = p.get("informe") as Dataset;
  if (!(dataset in DATASETS)) return NextResponse.json({ error: "Informe desconocido" }, { status: 400 });
  try {
    const csv = await withCtx(actor, async (ctx) => {
      requirePerm(ctx, "reports.export");
      const rows = await reportRows(ctx, dataset, { from: p.get("desde")!, to: p.get("hasta")!, clientId: p.get("cliente") ?? undefined, department: p.get("departamento") ?? undefined, responsibleId: p.get("responsable") ?? undefined, status: p.get("estado") ?? undefined });
      await audit(ctx, { action: "report.export", entityType: "report", summary: `Exportación CSV: ${DATASETS[dataset]} (${rows.length} filas)` });
      return toCSV(rows);
    });
    return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="conecta-${dataset}-${p.get("desde")}_${p.get("hasta")}.csv"` } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "FORBIDDEN" ? 403 : 400 });
    throw e;
  }
}
