import { Tabs } from "@/components/ui";
export function ConfigTabs({ active }: { active: string }) {
  return (
    <Tabs active={active} tabs={[
      { key: "general", label: "Ajustes", href: "/configuracion" },
      { key: "roles", label: "Roles y permisos", href: "/configuracion/roles" },
      { key: "usuarios", label: "Usuarios", href: "/configuracion/usuarios" },
      { key: "reglas", label: "Reglas laborales", href: "/configuracion/reglas-laborales" },
      { key: "automatizaciones", label: "Automatizaciones", href: "/configuracion/automatizaciones" },
      { key: "importar", label: "Importar datos", href: "/configuracion/importar" },
      { key: "auditoria", label: "Auditoría", href: "/configuracion/auditoria" },
    ]} />
  );
}
