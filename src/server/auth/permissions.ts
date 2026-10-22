// Catálogo de permisos y roles sembrados. Los roles son configurables desde la app.

export const PERMISSIONS = {
  "dashboard.global": ["gerencia", "Ver indicadores globales de la agencia"],
  "clients.read": ["clientes", "Consultar clientes"],
  "clients.write": ["clientes", "Crear y editar clientes y contratos"],
  "clients.archive": ["clientes", "Archivar, dar de baja y reactivar clientes"],
  "leads.read": ["ventas", "Consultar prospectos"],
  "leads.write": ["ventas", "Gestionar prospectos y llamadas"],
  "leads.convert": ["ventas", "Convertir ventas ganadas en clientes"],
  "sessions.read": ["agenda", "Consultar la agenda de sesiones"],
  "sessions.write": ["agenda", "Programar y actualizar sesiones"],
  "strategy.read": ["estrategia", "Consultar planificaciones"],
  "strategy.write": ["estrategia", "Editar planificaciones"],
  "strategy.approve": ["estrategia", "Aprobar planificaciones"],
  "production.read": ["produccion", "Consultar producción"],
  "production.manage": ["produccion", "Gestionar todos los entregables y asignaciones"],
  "production.update_own": ["produccion", "Actualizar entregables asignados"],
  "production.bulk": ["produccion", "Acciones grupales en entregables"],
  "publications.read": ["community", "Consultar publicaciones"],
  "publications.manage": ["community", "Gestionar todas las publicaciones"],
  "publications.update_own": ["community", "Actualizar publicaciones asignadas"],
  "tasks.read": ["tareas", "Consultar todas las tareas"],
  "tasks.write": ["tareas", "Crear y asignar tareas"],
  "tasks.update_own": ["tareas", "Actualizar tareas propias"],
  "employees.read": ["personal", "Consultar colaboradores"],
  "employees.write": ["personal", "Crear y editar colaboradores"],
  "employees.salary": ["personal", "Ver y modificar salarios"],
  "payroll.read": ["nomina", "Consultar nómina y prestaciones"],
  "payroll.write": ["nomina", "Preparar nóminas"],
  "payroll.approve": ["nomina", "Aprobar y contabilizar nóminas"],
  "leave.read": ["nomina", "Consultar vacaciones"],
  "leave.write": ["nomina", "Registrar solicitudes de vacaciones"],
  "leave.approve": ["nomina", "Aprobar vacaciones y ajustes"],
  "expenses.read": ["gastos", "Consultar gastos"],
  "expenses.write": ["gastos", "Registrar y editar gastos"],
  "expenses.pay": ["gastos", "Registrar pagos de gastos"],
  "finance.read": ["finanzas", "Consultar facturación, cobros e informes financieros"],
  "invoices.write": ["finanzas", "Crear cuentas por cobrar"],
  "invoices.pay": ["finanzas", "Registrar cobros"],
  "invoices.void": ["finanzas", "Anular facturas"],
  "reports.read": ["informes", "Consultar informes"],
  "reports.export": ["informes", "Exportar informes"],
  "agent.use": ["asistente", "Usar el Asistente de CONECTA"],
  "audit.read": ["sistema", "Consultar auditoría"],
  "settings.manage": ["sistema", "Administrar roles, permisos y configuración"],
  "automations.run": ["sistema", "Ejecutar automatizaciones manualmente"],
} as const satisfies Record<string, readonly [string, string]>;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const base: Permission[] = ["agent.use", "tasks.update_own", "clients.read"];

export const SEED_ROLES: { key: string; name: string; description: string; permissions: Permission[] }[] = [
  { key: "gerencia", name: "Gerencia", description: "Visión y control total de la agencia", permissions: ALL_PERMISSIONS },
  {
    key: "administracion",
    name: "Administración",
    description: "Clientes, contratos, personal, nómina, pagos y documentación",
    permissions: [
      ...base, "dashboard.global", "clients.write", "clients.archive", "leads.read", "leads.convert",
      "sessions.read", "sessions.write", "strategy.read", "production.read", "publications.read",
      "tasks.read", "tasks.write", "employees.read", "employees.write", "employees.salary",
      "payroll.read", "payroll.write", "leave.read", "leave.write", "leave.approve",
      "expenses.read", "expenses.write", "expenses.pay", "finance.read", "invoices.write", "invoices.pay",
      "reports.read", "reports.export",
    ],
  },
  {
    key: "ventas",
    name: "Ventas",
    description: "Prospectos, llamadas, seguimientos y conversión",
    permissions: [...base, "leads.read", "leads.write", "leads.convert", "sessions.read"],
  },
  {
    key: "estrategia",
    name: "Estrategia",
    description: "Planificación mensual, campañas y agenda",
    permissions: [
      ...base, "strategy.read", "strategy.write", "sessions.read", "sessions.write", "production.read",
      "publications.read",
    ],
  },
  {
    key: "disenador",
    name: "Diseñador",
    description: "Actualiza sus entregables de diseño",
    permissions: [...base, "production.read", "production.update_own", "strategy.read"],
  },
  {
    key: "editor_video",
    name: "Editor de video",
    description: "Actualiza los reels asignados",
    permissions: [...base, "production.read", "production.update_own", "strategy.read", "sessions.read"],
  },
  {
    key: "community_manager",
    name: "Community Manager",
    description: "Publicaciones y control diario",
    permissions: [...base, "publications.read", "publications.update_own", "production.read", "strategy.read"],
  },
  {
    key: "contabilidad",
    name: "Contabilidad",
    description: "Facturación, cobros, gastos, nómina e informes financieros",
    permissions: [
      ...base, "finance.read", "invoices.write", "invoices.pay", "invoices.void", "expenses.read",
      "expenses.write", "expenses.pay", "payroll.read", "payroll.write", "employees.read", "employees.salary",
      "leave.read", "reports.read", "reports.export",
    ],
  },
];
