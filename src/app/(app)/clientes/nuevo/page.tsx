import { load } from "../../_lib/page";
import { listPackages } from "@/server/services/clients";
import { listAssignableEmployees } from "@/server/services/employees";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ClientFields } from "@/components/forms/client-fields";
import { ContractFields } from "@/components/forms/contract-fields";
import { createClientAction } from "../actions";

export const metadata = { title: "Nuevo cliente" };

export default async function NewClient() {
  const d = await load(["clients.write"], async (ctx) => ({ packages: await listPackages(ctx), employees: await listAssignableEmployees(ctx) }));
  return (
    <>
      <PageHeader title="Nuevo cliente" subtitle="Al guardar se crean automáticamente su agenda, planificación, tableros de producción, publicaciones, tareas de incorporación y cuenta por cobrar." />
      <ActionForm action={createClientAction}>
        <Card title="Ficha del cliente"><ClientFields employees={d.employees} /></Card>
        <Card title="Contrato y paquete"><ContractFields packages={d.packages} /></Card>
        <div className="flex justify-end"><SubmitButton>Crear cliente y generar espacios</SubmitButton></div>
      </ActionForm>
    </>
  );
}
