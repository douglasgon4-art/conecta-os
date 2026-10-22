import { Field, Input, Select, Textarea } from "@/components/ui";

type Emp = { id: string; fullName: string };
type C = Partial<{ tradeName: string; legalName: string | null; taxId: string | null; contactName: string | null; phone: string | null; email: string | null; country: string; city: string | null; address: string | null; website: string | null; socialLinks: Record<string, string>; accountManagerId: string | null; communityManagerId: string | null; notes: string | null }>;

export function ClientFields({ employees, value = {} }: { employees: Emp[]; value?: C }) {
  const empSelect = (name: string, current?: string | null) => (
    <Select name={`client.${name}`} defaultValue={current ?? ""}>
      <option value="">— Sin asignar —</option>
      {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
    </Select>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Nombre comercial *"><Input name="client.tradeName" required defaultValue={value.tradeName} /></Field>
      <Field label="Razón social"><Input name="client.legalName" defaultValue={value.legalName ?? ""} /></Field>
      <Field label="RUC"><Input name="client.taxId" defaultValue={value.taxId ?? ""} /></Field>
      <Field label="Persona de contacto"><Input name="client.contactName" defaultValue={value.contactName ?? ""} /></Field>
      <Field label="Teléfono"><Input name="client.phone" defaultValue={value.phone ?? ""} /></Field>
      <Field label="Correo"><Input type="email" name="client.email" defaultValue={value.email ?? ""} /></Field>
      <Field label="País"><Input name="client.country" defaultValue={value.country ?? "Nicaragua"} /></Field>
      <Field label="Ciudad"><Input name="client.city" defaultValue={value.city ?? ""} /></Field>
      <Field label="Dirección"><Input name="client.address" defaultValue={value.address ?? ""} /></Field>
      <Field label="Sitio web"><Input name="client.website" defaultValue={value.website ?? ""} /></Field>
      <Field label="Facebook"><Input name="social.facebook" defaultValue={value.socialLinks?.facebook ?? ""} placeholder="https://facebook.com/…" /></Field>
      <Field label="Instagram"><Input name="social.instagram" defaultValue={value.socialLinks?.instagram ?? ""} /></Field>
      <Field label="TikTok"><Input name="social.tiktok" defaultValue={value.socialLinks?.tiktok ?? ""} /></Field>
      <Field label="Responsable de la cuenta">{empSelect("accountManagerId", value.accountManagerId)}</Field>
      <Field label="Community Manager">{empSelect("communityManagerId", value.communityManagerId)}</Field>
      <Field label="Observaciones" className="sm:col-span-3"><Textarea name="client.notes" defaultValue={value.notes ?? ""} rows={2} /></Field>
    </div>
  );
}
