import { Field, Input, Select, Textarea } from "@/components/ui";
import { CONTRACT_TYPES, DEPARTMENTS, PAY_FREQUENCIES } from "@/lib/domain";

type E = Partial<{ fullName: string; phone: string | null; email: string | null; position: string | null; departmentKey: string | null; hireDate: string | null; startDate: string; payFrequency: string; contractType: string; workSchedule: string | null; notes: string | null }>;

export function EmployeeFields({ value = {}, isNew, showSalary }: { value?: E; isNew?: boolean; showSalary?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Nombre completo *"><Input name="fullName" required defaultValue={value.fullName} /></Field>
      <Field label="Teléfono"><Input name="phone" defaultValue={value.phone ?? ""} /></Field>
      <Field label="Correo"><Input type="email" name="email" defaultValue={value.email ?? ""} /></Field>
      <Field label="Cargo"><Input name="position" defaultValue={value.position ?? ""} /></Field>
      <Field label="Departamento"><Select name="departmentKey" defaultValue={value.departmentKey ?? ""}><option value="">—</option>{DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</Select></Field>
      <Field label="Jornada"><Input name="workSchedule" defaultValue={value.workSchedule ?? ""} placeholder="Lunes a viernes, 8 h" /></Field>
      {isNew && <Field label="Fecha de inicio *"><Input type="date" name="startDate" required defaultValue={value.startDate} /></Field>}
      <Field label="Fecha de contratación"><Input type="date" name="hireDate" defaultValue={value.hireDate ?? ""} /></Field>
      <Field label="Forma de pago"><Select name="payFrequency" defaultValue={value.payFrequency ?? "quincenal"}>{PAY_FREQUENCIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</Select></Field>
      <Field label="Tipo de contrato"><Select name="contractType" defaultValue={value.contractType ?? "indeterminado"}>{CONTRACT_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</Select></Field>
      {isNew && showSalary && (
        <>
          <Field label="Salario mensual bruto"><Input name="salary" inputMode="decimal" /></Field>
          <Field label="Moneda"><Select name="currency"><option value="NIO">Córdobas</option><option value="USD">Dólares</option></Select></Field>
        </>
      )}
      <Field label="Notas" className="sm:col-span-3"><Textarea name="notes" defaultValue={value.notes ?? ""} rows={2} /></Field>
    </div>
  );
}
