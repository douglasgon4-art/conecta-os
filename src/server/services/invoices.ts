import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, invoicePayments, invoices } from "../db/schema";
import { audit, requirePerm, type Ctx } from "../ctx";
import { AppError, conflict, notFound } from "../errors";
import { parse, zCurrency, zPositiveMoney, zRequiredDate, zRequiredText, zText, zUuid } from "../validation";
import { addDays, firstOfMonth, formatPeriod, maxDate, monthsBetween, withDay } from "@/lib/dates";
import { PAYMENT_METHODS, values, type InvoiceStatus } from "@/lib/domain";
import { round2 } from "@/lib/money";
import type { Client, Contract } from "./workspace";
import type { Settings } from "./settings";

type Invoice = typeof invoices.$inferSelect;

/** Estado operativo derivado: "vencida" se calcula con la fecha, nunca se guarda desactualizado. */
export function invoiceStatus(inv: Pick<Invoice, "status" | "amount" | "paidAmount" | "dueDate">, today: string): { status: InvoiceStatus; partial: boolean; balance: number; overdue: boolean } {
  const balance = round2(inv.amount - inv.paidAmount);
  if (inv.status === "anulada") return { status: "anulada", partial: false, balance: 0, overdue: false };
  if (balance <= 0) return { status: "pagada", partial: false, balance: 0, overdue: false };
  const overdue = inv.dueDate < today;
  const partial = inv.paidAmount > 0;
  return { status: overdue ? "vencida" : partial ? "parcial" : "pendiente", partial, balance, overdue };
}

async function nextInvoiceNumber(ctx: Ctx, issueDate: string) {
  const r = await ctx.tx.execute<{ n: string }>(sql`select nextval('invoice_number_seq') as n`);
  return `CON-${issueDate.slice(0, 4)}-${String(r.rows[0].n).padStart(4, "0")}`;
}

/** Fechas de emisión y vencimiento de la factura de un período según las condiciones del contrato. */
export function contractInvoiceDates(contract: Pick<Contract, "startDate" | "billingDay">, period: string, issueDaysBefore: number) {
  let due = withDay(period, contract.billingDay);
  if (due < contract.startDate) due = contract.startDate;
  const issue = maxDate(addDays(due, -issueDaysBefore), contract.startDate < period ? period : contract.startDate)!;
  return { issueDate: issue > due ? due : issue, dueDate: due };
}

/**
 * Genera la cuenta por cobrar del período facturable del contrato (si corresponde y ya llegó la fecha de emisión).
 * Nunca la marca como pagada. Idempotente por source_key.
 */
export async function ensureContractInvoice(ctx: Ctx, client: Client, contract: Contract, period: string, settings: Settings) {
  const idx = monthsBetween(firstOfMonth(contract.startDate), period);
  if (idx < 0 || idx % contract.billingFrequencyMonths !== 0) return null;
  if (contract.monthlyPrice <= 0) return null;
  const { issueDate, dueDate } = contractInvoiceDates(contract, period, settings.invoice_issue_days_before);
  if (issueDate > ctx.today && idx > 0) return null; // la primera se emite al registrar el contrato
  const sourceKey = `contract:${contract.id}:${period}`;
  return ctx.elevate(async () => {
    const [existing] = await ctx.tx.select().from(invoices).where(eq(invoices.sourceKey, sourceKey));
    if (existing) return { invoice: existing, created: false };
    const months = contract.billingFrequencyMonths;
    const concept = months > 1 ? `Servicios de marketing digital — ${months} meses desde ${formatPeriod(period)}` : `Servicios de marketing digital — ${formatPeriod(period)}`;
    const [invoice] = await ctx.tx
      .insert(invoices)
      .values({
        number: await nextInvoiceNumber(ctx, issueDate),
        clientId: client.id,
        contractId: contract.id,
        period,
        concept,
        amount: round2(contract.monthlyPrice * months),
        currency: contract.currency,
        issueDate: issueDate > ctx.today ? ctx.today : issueDate,
        dueDate,
        sourceKey,
        createdBy: ctx.actor.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (!invoice) return { invoice: (await ctx.tx.select().from(invoices).where(eq(invoices.sourceKey, sourceKey)))[0], created: false };
    await audit(ctx, {
      action: "invoice.create",
      entityType: "invoice",
      entityId: invoice.id,
      clientId: client.id,
      summary: `Cuenta por cobrar ${invoice.number} generada: ${client.tradeName} · ${concept} · ${invoice.amount} ${invoice.currency} (vence ${dueDate})`,
      after: invoice,
    });
    return { invoice, created: true };
  });
}

export const invoiceInput = z.object({
  clientId: z.uuid(),
  concept: zRequiredText(300),
  amount: zPositiveMoney(),
  currency: zCurrency(),
  issueDate: zRequiredDate(),
  dueDate: zRequiredDate(),
  period: z.preprocess((v) => (v === "" ? undefined : v), zRequiredDate().optional()),
  notes: zText(2000),
});

export async function createInvoice(ctx: Ctx, raw: z.input<typeof invoiceInput>, opts: { allowDuplicate?: boolean } = {}) {
  requirePerm(ctx, "invoices.write");
  const input = parse(invoiceInput, raw);
  if (input.dueDate < input.issueDate) throw new AppError("VALIDATION", "El vencimiento no puede ser anterior a la emisión");
  const [client] = await ctx.tx.select().from(clients).where(eq(clients.id, input.clientId));
  if (!client) throw notFound("Cliente");
  if (!opts.allowDuplicate) {
    const dup = await ctx.tx
      .select({ id: invoices.id, number: invoices.number })
      .from(invoices)
      .where(
        and(
          eq(invoices.clientId, input.clientId),
          eq(invoices.amount, input.amount),
          eq(invoices.currency, input.currency),
          sql`${invoices.status} <> 'anulada'`,
          input.period ? eq(invoices.period, firstOfMonth(input.period)) : eq(invoices.issueDate, input.issueDate),
        ),
      );
    if (dup.length) throw new AppError("DUPLICATE", `Ya existe una cuenta por cobrar similar (${dup.map((d) => d.number).join(", ")})`, { candidates: dup });
  }
  const [invoice] = await ctx.tx
    .insert(invoices)
    .values({
      number: await nextInvoiceNumber(ctx, input.issueDate),
      clientId: input.clientId,
      concept: input.concept,
      amount: input.amount,
      currency: input.currency,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      period: input.period ? firstOfMonth(input.period) : null,
      notes: input.notes ?? null,
      createdBy: ctx.actor.userId,
    })
    .returning();
  await audit(ctx, { action: "invoice.create", entityType: "invoice", entityId: invoice.id, clientId: client.id, summary: `Cuenta por cobrar ${invoice.number}: ${client.tradeName} · ${invoice.concept} · ${invoice.amount} ${invoice.currency}`, after: invoice });
  return invoice;
}

export const paymentInput = z.object({
  amount: zPositiveMoney(),
  paidAt: zRequiredDate(),
  method: z.enum(values(PAYMENT_METHODS)),
  reference: zText(200),
  receiptAssetId: zUuid(),
  notes: zText(1000),
  idempotencyKey: zText(100),
});

/** Registra un cobro (total o parcial). Bloquea la fila para evitar cobros dobles concurrentes. */
export async function recordInvoicePayment(ctx: Ctx, invoiceId: string, raw: z.input<typeof paymentInput>) {
  requirePerm(ctx, "invoices.pay");
  const input = parse(paymentInput, raw);
  if (input.idempotencyKey) {
    const [prev] = await ctx.tx.select().from(invoicePayments).where(eq(invoicePayments.idempotencyKey, input.idempotencyKey));
    if (prev) return { payment: prev, invoice: (await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)))[0], duplicate: true };
  }
  const [inv] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
  if (!inv) throw notFound("Factura");
  if (inv.status === "anulada") throw conflict("La factura está anulada");
  const balance = round2(inv.amount - inv.paidAmount);
  if (balance <= 0) throw conflict(`La factura ${inv.number} ya está pagada`);
  if (input.amount > balance) throw new AppError("VALIDATION", `El pago (${input.amount}) excede el saldo pendiente (${balance} ${inv.currency})`);
  const [payment] = await ctx.tx
    .insert(invoicePayments)
    .values({ invoiceId, amount: input.amount, currency: inv.currency, paidAt: input.paidAt, method: input.method, reference: input.reference ?? null, receiptAssetId: input.receiptAssetId ?? null, notes: input.notes ?? null, idempotencyKey: input.idempotencyKey ?? null, createdBy: ctx.actor.userId })
    .returning();
  const paid = round2(inv.paidAmount + input.amount);
  const [after] = await ctx.tx
    .update(invoices)
    .set({ paidAmount: paid, status: paid >= inv.amount ? "pagada" : "parcial" })
    .where(eq(invoices.id, invoiceId))
    .returning();
  await audit(ctx, {
    action: "invoice.payment",
    entityType: "invoice",
    entityId: invoiceId,
    clientId: inv.clientId,
    summary: `Cobro registrado en ${inv.number}: ${input.amount} ${inv.currency} (${input.method}). Saldo: ${round2(after.amount - after.paidAmount)}`,
    before: inv,
    after: { invoice: after, payment },
  });
  return { payment, invoice: after, duplicate: false };
}

export async function voidInvoice(ctx: Ctx, invoiceId: string, reason: string) {
  requirePerm(ctx, "invoices.void");
  if (!reason?.trim()) throw new AppError("VALIDATION", "Indica el motivo de la anulación");
  const [inv] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
  if (!inv) throw notFound("Factura");
  if (inv.status === "anulada") throw conflict("La factura ya está anulada");
  if (inv.paidAmount > 0) throw conflict("No se puede anular una factura con cobros registrados");
  const [after] = await ctx.tx
    .update(invoices)
    .set({ status: "anulada", voidedAt: new Date(), voidedBy: ctx.actor.userId, voidReason: reason })
    .where(eq(invoices.id, invoiceId))
    .returning();
  await audit(ctx, { action: "invoice.void", entityType: "invoice", entityId: invoiceId, clientId: inv.clientId, summary: `Factura ${inv.number} anulada. Motivo: ${reason}`, before: inv, after });
  return after;
}

export async function listInvoices(ctx: Ctx, f: { clientId?: string; status?: string; from?: string; to?: string; currency?: string } = {}) {
  requirePerm(ctx, "finance.read");
  const conds = [];
  if (f.clientId) conds.push(eq(invoices.clientId, f.clientId));
  if (f.from) conds.push(gte(invoices.issueDate, f.from));
  if (f.to) conds.push(lte(invoices.issueDate, f.to));
  if (f.currency) conds.push(eq(invoices.currency, f.currency));
  if (f.status === "abiertas") conds.push(inArray(invoices.status, ["pendiente", "parcial"]));
  const rows = await ctx.tx
    .select({ invoice: invoices, clientName: clients.tradeName })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(invoices.issueDate), desc(invoices.number));
  return rows
    .map((r) => ({ ...r.invoice, clientName: r.clientName, ...invoiceStatus(r.invoice, ctx.today) }))
    .filter((r) => !f.status || f.status === "abiertas" || r.status === f.status);
}

export async function getInvoice(ctx: Ctx, id: string) {
  requirePerm(ctx, "finance.read");
  const [row] = await ctx.tx.select({ invoice: invoices, clientName: clients.tradeName }).from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId)).where(eq(invoices.id, id));
  if (!row) throw notFound("Factura");
  const payments = await ctx.tx.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, id)).orderBy(asc(invoicePayments.paidAt));
  return { ...row.invoice, clientName: row.clientName, payments, ...invoiceStatus(row.invoice, ctx.today) };
}
