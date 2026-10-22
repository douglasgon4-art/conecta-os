export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "DUPLICATE"
  | "CONFLICT"
  | "CONFIRMATION_REQUIRED"
  | "NOT_CONFIGURED";

export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "No tienes permiso para realizar esta acción") => new AppError("FORBIDDEN", msg);
export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} no encontrado`);
export const invalid = (msg: string, details?: Record<string, unknown>) => new AppError("VALIDATION", msg, details);
export const conflict = (msg: string, details?: Record<string, unknown>) => new AppError("CONFLICT", msg, details);

/** Traduce errores de PostgreSQL (restricciones) a mensajes comprensibles. */
export function translateDbError(e: unknown): AppError | null {
  const err = e as { code?: string; constraint?: string; message?: string; cause?: unknown };
  const pg = (err?.code ? err : (err?.cause as typeof err)) ?? {};
  if (!pg.code) return null;
  if (pg.code === "23505") return new AppError("DUPLICATE", duplicateMessage(pg.constraint), { constraint: pg.constraint });
  if (pg.code === "23514") return new AppError("VALIDATION", checkMessage(pg.constraint), { constraint: pg.constraint });
  if (pg.code === "23503") return new AppError("VALIDATION", "Referencia inválida a un registro relacionado", { constraint: pg.constraint });
  if (pg.code === "42501") return forbidden("La base de datos denegó el acceso a estos datos (RLS)");
  if (pg.code === "P0001") return new AppError("CONFLICT", pg.message ?? "Operación no permitida");
  return null;
}

function duplicateMessage(c?: string) {
  const map: Record<string, string> = {
    clients_name_city_uq: "Ya existe un cliente con ese nombre en esa ciudad",
    clients_tax_id_uq: "Ya existe un cliente con ese RUC",
    contracts_one_active_uq: "El cliente ya tiene un contrato vigente",
    employees_email_uq: "Ya existe un colaborador con ese correo",
    users_email_uq: "Ya existe un usuario con ese correo",
    plans_client_period_uq: "Ya existe la planificación de ese cliente para ese mes",
    boards_client_period_uq: "Ya existe el tablero de ese cliente para ese mes",
    payroll_periods_uq: "Ya existe una nómina para ese período",
    salary_history_emp_date_uq: "Ya existe un cambio salarial con esa fecha efectiva",
  };
  return (c && map[c]) || "El registro ya existe";
}

function checkMessage(c?: string) {
  const map: Record<string, string> = {
    deliverables_final_file_ck: "No se puede marcar como terminado sin archivo final o enlace",
    content_sessions_done_ck: "Una sesión realizada requiere la fecha realizada",
    content_sessions_confirmed_ck: "Una sesión confirmada requiere la fecha confirmada",
    invoices_amount_ck: "El pago excede el saldo pendiente o el importe es inválido",
    expenses_amount_ck: "El pago excede el saldo pendiente o el importe es inválido",
    publications_confirmed_ck: "Una publicación publicada requiere quién y cuándo la confirmó",
  };
  return (c && map[c]) || "Los datos no cumplen las reglas del sistema";
}
