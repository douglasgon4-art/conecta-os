import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth/session";
import { withCtx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { getFileForDownload } from "@/server/services/files";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const { row, data } = await withCtx(actor, (ctx) => getFileForDownload(ctx, id));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": row.mimeType,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
        "cache-control": "private, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "NOT_FOUND" ? 404 : 403 });
    throw e;
  }
}
