"use server";
import { formToObject, isConfirmed, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/leads";

export async function createLeadAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.createLead(ctx, o, { allowDuplicate: isConfirmed(o) }), { revalidate: ["/ventas"], duplicateConfirm: true, success: (l) => `Prospecto "${l.tradeName}" agregado a la lista.` });
}
export async function updateLeadAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  const id = String(o.id);
  delete o.id;
  return run((ctx) => svc.updateLead(ctx, id, o), { revalidate: [`/ventas/${id}`, "/ventas"], success: "Prospecto actualizado" });
}
export async function logCallAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.logCall(ctx, String(o.leadId), o), { revalidate: [`/ventas/${o.leadId}`, "/ventas"], success: (r) => `Llamada registrada. Estado: ${r.lead.status}` });
}
export async function proposalAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.createProposal(ctx, String(o.leadId), o), { revalidate: [`/ventas/${o.leadId}`], success: "Propuesta registrada" });
}
export async function loseLeadAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.loseLead(ctx, String(o.leadId), o.status as "venta_perdida", String(o.reason ?? "")), { revalidate: [`/ventas/${o.leadId}`, "/ventas"], success: "Prospecto cerrado" });
}
export async function convertLeadAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  const contract = { ...((o.contract ?? {}) as Record<string, unknown>) };
  for (const k of ["sessionsEnabled", "includeProfilePhoto", "includeCover", "includeStrategy", "includeCommunity"]) contract[k] = contract[k] === "on";
  contract.socialNetworks = o.networks ? ([] as unknown[]).concat(o.networks) : [];
  if (!isConfirmed(o)) return { ok: false, confirm: "Se marcará la venta como ganada: se creará (o vinculará) el cliente, su contrato, espacios de trabajo y la cuenta por cobrar. ¿Confirmas?", at: Date.now() };
  return run(
    (ctx) =>
      svc.convertLead(ctx, String(o.leadId), {
        contract,
        linkClientId: (o.linkClientId as string) || undefined,
        allowDuplicate: o.allowDuplicate === "on",
        client: { accountManagerId: (o.accountManagerId as string) || undefined, communityManagerId: (o.communityManagerId as string) || undefined },
      }),
    { revalidate: ["/ventas", "/clientes", "/"], redirectTo: (r) => `/clientes/${r.clientId}?creado=1` },
  );
}
