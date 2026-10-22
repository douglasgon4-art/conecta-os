import { and, desc, eq } from "drizzle-orm";
import { fileAssets } from "../db/schema";
import { audit, can, requirePerm, type Ctx } from "../ctx";
import { AppError, forbidden, notFound } from "../errors";
import type { Permission } from "../auth/permissions";
import { storage } from "../files/storage";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpeg|webp|gif|svg\+xml)|video\/(mp4|quicktime|webm)|application\/pdf|application\/zip|application\/vnd\.openxmlformats-officedocument\.[a-z.]+|application\/msword|text\/plain)$/;

/** Permiso requerido para leer y para subir según el tipo de entidad. */
const RULES: Record<string, { read: Permission[]; write: Permission[] }> = {
  client_document: { read: ["clients.read"], write: ["clients.write"] },
  deliverable: { read: ["production.read", "publications.read"], write: ["production.manage", "production.update_own"] },
  expense_receipt: { read: ["expenses.read"], write: ["expenses.write", "expenses.pay"] },
  invoice_receipt: { read: ["finance.read"], write: ["invoices.pay"] },
};

export async function uploadFile(ctx: Ctx, input: { entityType: string; entityId?: string | null; clientId?: string | null; file: File }) {
  const rule = RULES[input.entityType];
  if (!rule) throw new AppError("VALIDATION", "Tipo de archivo no admitido");
  requirePerm(ctx, ...rule.write);
  const f = input.file;
  if (!f || !f.size) throw new AppError("VALIDATION", "Selecciona un archivo");
  if (f.size > MAX_BYTES) throw new AppError("VALIDATION", "El archivo supera 20 MB. Para videos pesados usa un enlace (Drive, Dropbox…).");
  if (!ALLOWED.test(f.type)) throw new AppError("VALIDATION", `Formato no permitido (${f.type || "desconocido"})`);
  const key = await storage.save(Buffer.from(await f.arrayBuffer()), f.name);
  const [row] = await ctx.tx
    .insert(fileAssets)
    .values({ storageKey: key, originalName: f.name.slice(0, 200), mimeType: f.type, sizeBytes: f.size, entityType: input.entityType, entityId: input.entityId ?? null, clientId: input.clientId ?? null, uploadedBy: ctx.actor.userId })
    .returning();
  await audit(ctx, { action: "file.upload", entityType: input.entityType, entityId: input.entityId ?? row.id, clientId: input.clientId, summary: `Archivo subido: ${row.originalName}` });
  return row;
}

export async function getFileForDownload(ctx: Ctx, id: string) {
  const [row] = await ctx.tx.select().from(fileAssets).where(eq(fileAssets.id, id));
  if (!row) throw notFound("Archivo");
  const rule = RULES[row.entityType];
  if (!rule || !rule.read.some((p) => can(ctx, p))) throw forbidden("No tienes acceso a este archivo");
  return { row, data: await storage.read(row.storageKey) };
}

export async function listFiles(ctx: Ctx, entityType: string, entityId: string) {
  const rule = RULES[entityType];
  if (!rule || !rule.read.some((p) => can(ctx, p))) return [];
  return ctx.tx.select().from(fileAssets).where(and(eq(fileAssets.entityType, entityType), eq(fileAssets.entityId, entityId))).orderBy(desc(fileAssets.createdAt));
}
