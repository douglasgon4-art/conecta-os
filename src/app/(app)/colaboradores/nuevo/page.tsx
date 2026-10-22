import { load } from "../../_lib/page";
import { can } from "@/server/ctx";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { EmployeeFields } from "@/components/forms/employee-fields";
import { createEmployeeAction } from "../actions";

export const metadata = { title: "Nuevo colaborador" };

export default async function NewEmployee() {
  const d = await load(["employees.write"], async (ctx) => ({ salary: can(ctx, "employees.salary") }));
  return (
    <>
      <PageHeader title="Nuevo colaborador" />
      <Card>
        <ActionForm action={createEmployeeAction}>
          <EmployeeFields isNew showSalary={d.salary} />
          <SubmitButton>Registrar colaborador</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
