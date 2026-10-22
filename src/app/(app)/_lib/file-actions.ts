"use server";
import { run, type ActionState } from "./action";
import { uploadFile } from "@/server/services/files";
import { updateDeliverable } from "@/server/services/production";

export async function uploadClientDocumentAction(_: ActionState, fd: FormData) {
  const clientId = String(fd.get("clientId"));
  return run((ctx) => uploadFile(ctx, { entityType: "client_document", entityId: clientId, clientId, file: fd.get("file") as File }), { revalidate: [`/clientes/${clientId}`], success: (f) => `Documento "${f.originalName}" guardado` });
}

/** Sube el archivo final y lo asocia al entregable (con los mismos permisos de actualización del entregable). */
export async function uploadDeliverableFileAction(_: ActionState, fd: FormData) {
  const id = String(fd.get("id"));
  const boardId = String(fd.get("boardId"));
  return run(
    async (ctx) => {
      const f = await uploadFile(ctx, { entityType: "deliverable", entityId: id, clientId: (fd.get("clientId") as string) || null, file: fd.get("file") as File });
      return updateDeliverable(ctx, id, { finalFileAssetId: f.id, finalFileUrl: `/api/archivos/${f.id}` });
    },
    { revalidate: [`/produccion/${boardId}`], success: (d) => `Archivo final cargado en ${d.title}` },
  );
}
