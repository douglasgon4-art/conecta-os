import { Field, Input, Select, Textarea } from "@/components/ui";
import { SOCIAL_NETWORKS, WEEKDAYS } from "@/lib/domain";

type Contract = Partial<{
  packageId: string | null; name: string; startDate: string; endDate: string | null; monthlyPrice: number; currency: string; billingDay: number;
  billingFrequencyMonths: number; sessionsEnabled: boolean; sessionFrequencyMonths: number; coordinationLeadDays: number; designsPerMonth: number;
  reelsPerMonth: number; storiesPerMonth: number; postWeekdays: number[]; storyWeekdays: number[]; includeProfilePhoto: boolean; includeCover: boolean; includeStrategy: boolean; includeCommunity: boolean; socialNetworks: string[]; servicesNotes: string | null;
}>;

/** Campos del contrato/paquete. Valores por defecto = paquete estándar. */
export function ContractFields({ packages = [], value = {}, showFirstSession = true, showStart = true }: { packages?: { id: string; name: string }[]; value?: Contract; showFirstSession?: boolean; showStart?: boolean }) {
  const v = { designsPerMonth: 6, reelsPerMonth: 6, includeProfilePhoto: true, includeCover: true, includeStrategy: true, includeCommunity: true, sessionsEnabled: true, sessionFrequencyMonths: 1, billingDay: 5, billingFrequencyMonths: 1, storiesPerMonth: 0, postWeekdays: [] as number[], storyWeekdays: [] as number[], currency: "NIO", socialNetworks: ["facebook", "instagram"], ...value };
  const check = (name: string, label: string, on: boolean | undefined) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`contract.${name}`} defaultChecked={!!on} className="size-4" /> {label}</label>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {packages.length > 0 && (
          <Field label="Paquete base">
            <Select name="contract.packageId" defaultValue={v.packageId ?? packages[0]?.id}>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="">Personalizado</option>
            </Select>
          </Field>
        )}
        <Field label="Nombre del contrato" hint="Opcional"><Input name="contract.name" defaultValue={v.name} placeholder="Paquete estándar" /></Field>
        {showStart && <Field label="Inicio del servicio *"><Input type="date" name="contract.startDate" required defaultValue={v.startDate} /></Field>}
        <Field label="Fin (si aplica)"><Input type="date" name="contract.endDate" defaultValue={v.endDate ?? ""} /></Field>
        <Field label="Precio mensual *"><Input name="contract.monthlyPrice" inputMode="decimal" required defaultValue={v.monthlyPrice} /></Field>
        <Field label="Moneda"><Select name="contract.currency" defaultValue={v.currency}><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></Select></Field>
        <Field label="Día de pago" hint="1 a 31 (en meses cortos, el último día)"><Input type="number" min={1} max={31} name="contract.billingDay" defaultValue={v.billingDay} /></Field>
        <Field label="Facturar cada (meses)"><Input type="number" min={1} max={12} name="contract.billingFrequencyMonths" defaultValue={v.billingFrequencyMonths} /></Field>
      </div>
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold uppercase text-slate-500">Servicios incluidos</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Artes gráficos / mes"><Input type="number" min={0} name="contract.designsPerMonth" defaultValue={v.designsPerMonth} /></Field>
          <Field label="Reels / mes"><Input type="number" min={0} name="contract.reelsPerMonth" defaultValue={v.reelsPerMonth} /></Field>
          <Field label="Stories / mes" hint="Las hace Diseño"><Input type="number" min={0} name="contract.storiesPerMonth" defaultValue={v.storiesPerMonth} /></Field>
          <Field label="Sesión cada (meses)"><Input type="number" min={1} name="contract.sessionFrequencyMonths" defaultValue={v.sessionFrequencyMonths} /></Field>
          <Field label="Anticipación para coordinar (días)"><Input type="number" min={0} name="contract.coordinationLeadDays" defaultValue={v.coordinationLeadDays ?? 10} /></Field>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {check("sessionsEnabled", "Sesión de producción de contenido", v.sessionsEnabled)}
          {check("includeProfilePhoto", "Foto de perfil", v.includeProfilePhoto)}
          {check("includeCover", "Portada", v.includeCover)}
          {check("includeStrategy", "Planificación estratégica mensual", v.includeStrategy)}
          {check("includeCommunity", "Gestión de redes y calendario", v.includeCommunity)}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span className="font-medium text-slate-700">Redes gestionadas:</span>
          {SOCIAL_NETWORKS.map((n) => (
            <label key={n.value} className="flex items-center gap-1.5"><input type="checkbox" name="networks" value={n.value} defaultChecked={v.socialNetworks?.includes(n.value)} className="size-4" />{n.label}</label>
          ))}
        </div>
        {([["postDays", "Días de publicación de artes y reels", v.postWeekdays], ["storyDays", "Días de stories", v.storyWeekdays]] as const).map(([name, label, on]) => (
          <div key={name} className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="font-medium text-slate-700">{label}:</span>
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="flex items-center gap-1.5"><input type="checkbox" name={name} value={d.value} defaultChecked={on?.includes(Number(d.value))} className="size-4" />{d.label}</label>
            ))}
          </div>
        ))}
        {showFirstSession && <Field label="Fecha prevista de la primera sesión" className="mt-3 max-w-xs" hint="Por defecto, la fecha de inicio"><Input type="date" name="contract.firstSessionDate" /></Field>}
        <Field label="Observaciones del paquete" className="mt-3"><Textarea name="contract.servicesNotes" defaultValue={v.servicesNotes ?? ""} rows={2} /></Field>
      </fieldset>
    </div>
  );
}
