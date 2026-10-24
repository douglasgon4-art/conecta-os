"use server";
import { formToObject, isConfirmed, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/clients";
import { initializeClientWorkspace } from "@/server/services/workspace";

const splitClient = (o: Record<string, unknown>) => {
  const client = (o.client ?? {}) as Record<string, unknown>;
  client.socialLinks = o.social ?? {};
  return client;
};
const contractFrom = (o: Record<string, unknown>) => {
  const c = { ...((o.contract ?? {}) as Record<string, unknown>) };
  for (const k of ["sessionsEnabled", "includeProfilePhoto", "includeCover", "includeStrategy", "includeCommunity"]) c[k] = c[k] === "on" || c[k] === "true";
  c.socialNetworks = o.networks ? ([] as unknown[]).concat(o.networks) : [];
  c.postWeekdays = o.postDays ?? [];
  c.storyWeekdays = o.storyDays ?? [];
  return c;
};

export async function createClientAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.createClient(ctx, { client: splitClient(o), contract: contractFrom(o) }, { allowDuplicate: isConfirmed(o) || o.allowDuplicate === "1" }), {
    revalidate: ["/clientes", "/"],
    duplicateConfirm: true,
    redirectTo: (r) => `/clientes/${r.client.id}?creado=1`,
  });
}

export async function updateClientAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.updateClient(ctx, String(o.id), splitClient(o)), { revalidate: [`/clientes/${o.id}`], success: "Ficha actualizada" });
}

export async function updateContractAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.updateContract(ctx, String(o.id), contractFrom(o)), { revalidate: [`/clientes/${o.id}`], success: "Contrato actualizado. Los próximos períodos usarán estos valores." });
}

export async function setStatusAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.setClientStatus(ctx, String(o.id), o.status as "activo" | "en_pausa", String(o.reason ?? "")), { revalidate: [`/clientes/${o.id}`, "/clientes"], success: "Estado actualizado" });
}

export async function archiveAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (!isConfirmed(o)) return { ok: false, confirm: "Archivar retirará al cliente de los ciclos operativos (se conserva todo el historial). ¿Continuar?", at: Date.now() };
  return run((ctx) => svc.archiveClient(ctx, String(o.id), String(o.reason ?? "")), { revalidate: [`/clientes/${o.id}`, "/clientes", "/"], success: (r) => `Cliente archivado. Se cancelaron ${r.stats.boardsCancelled} tablero(s) futuros y ${r.stats.tasksCancelled} tarea(s).` });
}

export async function offboardAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (o.lastServicePeriodMonth) o.lastServicePeriod = `${o.lastServicePeriodMonth}-01`;
  if (!isConfirmed(o)) return { ok: false, confirm: "¿Confirmas la baja con las obligaciones pendientes mostradas? Las facturas, pagos y el historial se conservan.", at: Date.now() };
  return run((ctx) => svc.offboardClient(ctx, String(o.id), o), { revalidate: [`/clientes/${o.id}`, "/clientes", "/"], success: (r) => `Baja registrada (estado: ${r.client.status}).` });
}

export async function reactivateAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (!isConfirmed(o)) return { ok: false, confirm: "Se reactivará el cliente con el contrato, paquete, precio y fecha de inicio indicados. ¿Confirmas?", at: Date.now() };
  return run((ctx) => svc.reactivateClient(ctx, String(o.id), contractFrom(o), String(o.reason ?? "Reactivación")), { revalidate: [`/clientes/${o.id}`, "/clientes", "/"], success: "Cliente reactivado y espacios regenerados sin duplicar." });
}

export async function reinitializeAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run(
    async (ctx) => {
      const { requirePerm } = await import("@/server/ctx");
      requirePerm(ctx, "clients.write");
      return initializeClientWorkspace(ctx, String(o.id), { onboarding: false });
    },
    { revalidate: [`/clientes/${o.id}`], success: (r) => `Verificación completada: ${r.boards} tablero(s), ${r.plans} planificación(es), ${r.invoices} factura(s) y ${r.modules.length} módulo(s) faltantes creados (los existentes no se duplican).` },
  );
}
