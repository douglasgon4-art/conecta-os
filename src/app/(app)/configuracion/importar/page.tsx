import { load } from "../../_lib/page";
import { can } from "@/server/ctx";
import { IMPORT_TEMPLATES, type ImportKind } from "@/server/services/importer";
import { Card, PageHeader } from "@/components/ui";
import { ConfigTabs } from "../nav";
import { ImportForm } from "./form";

export const metadata = { title: "Importar datos" };

export default async function ImportPage() {
  const d = await load(["clients.write", "employees.write", "leads.write"], async (ctx) => ({
    kinds: (Object.keys(IMPORT_TEMPLATES) as ImportKind[]).filter((k) => can(ctx, IMPORT_TEMPLATES[k].perm)).map((k) => ({ key: k, label: IMPORT_TEMPLATES[k].label, columns: IMPORT_TEMPLATES[k].columns, required: IMPORT_TEMPLATES[k].required })),
  }));
  return (
    <>
      <PageHeader title="Importar datos" subtitle="Carga tus clientes, colaboradores y prospectos actuales desde Excel/CSV" />
      <ConfigTabs active="importar" />
      <Card>
        <ImportForm kinds={d.kinds} />
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate-600">
          <li>Cada fila pasa por las mismas validaciones que la pantalla: se detectan duplicados y no se crea nada a medias.</li>
          <li>Los clientes importados como «activo» no generan tareas de incorporación. Sí se crean sus espacios del mes actual y del siguiente, incluida la cuenta por cobrar del mes en curso; anúlala si ya la facturaste por fuera.</li>
          <li>Usa primero «Vista previa» para revisar los errores sin guardar nada.</li>
        </ul>
      </Card>
    </>
  );
}
