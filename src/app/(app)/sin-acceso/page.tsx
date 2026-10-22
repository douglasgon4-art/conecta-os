import { Empty, PageHeader } from "@/components/ui";
export default function NoAccess() {
  return (
    <>
      <PageHeader title="Acceso restringido" />
      <Empty>Tu rol no tiene permiso para ver esta sección. Si lo necesitas, pide a Gerencia que ajuste tus permisos.</Empty>
    </>
  );
}
