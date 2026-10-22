"use server";
import { formToObject, isConfirmed, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/invoices";

export async function createInvoiceAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.createInvoice(ctx, o, { allowDuplicate: isConfirmed(o) }), { revalidate: ["/finanzas"], duplicateConfirm: true, redirectTo: (i) => `/finanzas/facturas/${i.id}` });
}
export async function invoicePaymentAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (!isConfirmed(o)) return { ok: false, confirm: `¿Registrar el cobro de ${o.amount}? Los cobros no se eliminan.`, at: Date.now() };
  return run((ctx) => svc.recordInvoicePayment(ctx, String(o.id), o), { revalidate: [`/finanzas/facturas/${o.id}`, "/finanzas"], success: (r) => `Cobro registrado. Estado: ${r.invoice.status}` });
}
export async function voidInvoiceAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (!isConfirmed(o)) return { ok: false, confirm: "Anular la factura la conserva en el historial con estado Anulado. ¿Confirmas?", at: Date.now() };
  return run((ctx) => svc.voidInvoice(ctx, String(o.id), String(o.reason ?? "")), { revalidate: [`/finanzas/facturas/${o.id}`, "/finanzas"], success: "Factura anulada" });
}
