import type { Permission } from "@/server/auth/permissions";

export type NavItem = { href: string; label: string; icon: string; perms: Permission[] };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "General",
    items: [
      { href: "/", label: "Inicio", icon: "LayoutDashboard", perms: [] },
      { href: "/asistente", label: "Asistente de CONECTA", icon: "Sparkles", perms: ["agent.use"] },
      { href: "/tareas", label: "Tareas", icon: "CheckSquare", perms: ["tasks.read", "tasks.update_own"] },
    ],
  },
  {
    label: "Operaciones",
    items: [
      { href: "/clientes", label: "Clientes", icon: "Building2", perms: ["clients.read"] },
      { href: "/ventas", label: "Ventas", icon: "PhoneCall", perms: ["leads.read"] },
      { href: "/agenda", label: "Agenda de sesiones", icon: "CalendarDays", perms: ["sessions.read"] },
      { href: "/estrategia", label: "Estrategia y campañas", icon: "Lightbulb", perms: ["strategy.read"] },
      { href: "/produccion", label: "Producción mensual", icon: "Clapperboard", perms: ["production.read"] },
      { href: "/publicaciones", label: "Community Management", icon: "Megaphone", perms: ["publications.read"] },
    ],
  },
  {
    label: "Administración",
    items: [
      { href: "/colaboradores", label: "Colaboradores", icon: "Users", perms: ["employees.read"] },
      { href: "/nomina", label: "Nómina y prestaciones", icon: "Wallet", perms: ["payroll.read"] },
      { href: "/gastos", label: "Gastos del mes", icon: "Receipt", perms: ["expenses.read"] },
      { href: "/finanzas", label: "Finanzas y cobros", icon: "Landmark", perms: ["finance.read"] },
      { href: "/informes", label: "Informes", icon: "BarChart3", perms: ["reports.read"] },
      { href: "/configuracion", label: "Configuración", icon: "Settings", perms: ["settings.manage", "audit.read", "automations.run"] },
    ],
  },
];
