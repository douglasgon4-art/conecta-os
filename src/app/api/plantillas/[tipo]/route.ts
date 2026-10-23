import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { IMPORT_TEMPLATES, templateCSV, type ImportKind } from "@/server/services/importer";

export async function GET(_req: Request, { params }: { params: Promise<{ tipo: string }> }) {
  if (!(await getActor())) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { tipo } = await params;
  if (!(tipo in IMPORT_TEMPLATES)) return NextResponse.json({ error: "Plantilla desconocida" }, { status: 404 });
  return new NextResponse(templateCSV(tipo as ImportKind), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="plantilla-${tipo}.csv"` },
  });
}
