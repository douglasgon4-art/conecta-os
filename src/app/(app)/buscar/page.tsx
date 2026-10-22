import Link from "next/link";
import { ilike, or } from "drizzle-orm";
import { load, sp, type SP } from "../_lib/page";
import { can } from "@/server/ctx";
import { searchClients } from "@/server/services/clients";
import { employees, invoices, leads } from "@/server/db/schema";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { CLIENT_STATUSES, LEAD_STATUSES } from "@/lib/domain";

export const metadata = { title: "Búsqueda" };

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const term = (sp((await searchParams).q) ?? "").trim();
  const d = await load([], async (ctx) => {
    if (term.length < 2) return { clients: [], leads: [], employees: [], invoices: [] };
    const like = `%${term}%`;
    return {
      clients: can(ctx, "clients.read") ? await searchClients(ctx, term, 20) : [],
      leads: can(ctx, "leads.read") ? await ctx.tx.select({ id: leads.id, tradeName: leads.tradeName, status: leads.status, city: leads.city }).from(leads).where(or(ilike(leads.tradeName, like), ilike(leads.contactName, like), ilike(leads.phone, like))).limit(20) : [],
      employees: can(ctx, "employees.read") ? await ctx.tx.select({ id: employees.id, fullName: employees.fullName, position: employees.position }).from(employees).where(or(ilike(employees.fullName, like), ilike(employees.email, like))).limit(20) : [],
      invoices: can(ctx, "finance.read") ? await ctx.tx.select({ id: invoices.id, number: invoices.number, concept: invoices.concept }).from(invoices).where(or(ilike(invoices.number, like), ilike(invoices.concept, like))).limit(20) : [],
    };
  });
  const total = d.clients.length + d.leads.length + d.employees.length + d.invoices.length;
  return (
    <>
      <PageHeader title={`Resultados para "${term}"`} subtitle={`${total} coincidencia(s) en los módulos que puedes ver`} />
      {total === 0 ? <Empty>Sin resultados. Prueba con otro término (mínimo 2 caracteres).</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {d.clients.length > 0 && <Card title="Clientes"><ul className="space-y-1.5">{d.clients.map((c) => <li key={c.id} className="flex justify-between text-sm"><Link className="hover:underline" href={`/clientes/${c.id}`}>{c.tradeName} <span className="text-slate-400">{c.city}</span></Link><StatusBadge list={CLIENT_STATUSES} value={c.status} /></li>)}</ul></Card>}
          {d.leads.length > 0 && <Card title="Prospectos"><ul className="space-y-1.5">{d.leads.map((l) => <li key={l.id} className="flex justify-between text-sm"><Link className="hover:underline" href={`/ventas/${l.id}`}>{l.tradeName}</Link><StatusBadge list={LEAD_STATUSES} value={l.status} /></li>)}</ul></Card>}
          {d.employees.length > 0 && <Card title="Colaboradores"><ul className="space-y-1.5">{d.employees.map((e) => <li key={e.id} className="text-sm"><Link className="hover:underline" href={`/colaboradores/${e.id}`}>{e.fullName}</Link> <span className="text-slate-400">{e.position}</span></li>)}</ul></Card>}
          {d.invoices.length > 0 && <Card title="Facturas"><ul className="space-y-1.5">{d.invoices.map((i) => <li key={i.id} className="text-sm"><Link className="hover:underline" href={`/finanzas/facturas/${i.id}`}>{i.number}</Link> <span className="text-slate-400">{i.concept}</span></li>)}</ul></Card>}
        </div>
      )}
    </>
  );
}
