// Catálogos de dominio compartidos por servidor e interfaz.
// Los valores se guardan en la BD (snake_case); las etiquetas son las que ve el usuario.

export type Tone = "green" | "yellow" | "red" | "gray" | "blue";

function catalog<const T extends readonly { value: string; label: string; tone: Tone }[]>(items: T) {
  return items;
}

export const CLIENT_STATUSES = catalog([
  { value: "prospecto", label: "Prospecto", tone: "gray" },
  { value: "en_incorporacion", label: "En incorporación", tone: "blue" },
  { value: "activo", label: "Activo", tone: "green" },
  { value: "en_pausa", label: "En pausa", tone: "yellow" },
  { value: "en_proceso_baja", label: "En proceso de baja", tone: "yellow" },
  { value: "archivado", label: "Archivado", tone: "gray" },
  { value: "dado_de_baja", label: "Dado de baja", tone: "red" },
] as const);
export type ClientStatus = (typeof CLIENT_STATUSES)[number]["value"];
/** Estados en los que el cliente recibe servicio y entra en los ciclos operativos. */
export const OPERATIVE_CLIENT_STATUSES: ClientStatus[] = ["en_incorporacion", "activo", "en_proceso_baja"];

export const LEAD_STATUSES = catalog([
  { value: "pendiente_contactar", label: "Pendiente de contactar", tone: "gray" },
  { value: "primer_contacto", label: "Primer contacto realizado", tone: "blue" },
  { value: "no_contesto", label: "No contestó", tone: "yellow" },
  { value: "volver_a_llamar", label: "Volver a llamar", tone: "yellow" },
  { value: "interesado", label: "Interesado", tone: "blue" },
  { value: "reunion_programada", label: "Reunión programada", tone: "blue" },
  { value: "propuesta_enviada", label: "Propuesta enviada", tone: "blue" },
  { value: "en_negociacion", label: "En negociación", tone: "blue" },
  { value: "seguimiento_pendiente", label: "Seguimiento pendiente", tone: "yellow" },
  { value: "seguimiento_proximo_mes", label: "Seguimiento el próximo mes", tone: "gray" },
  { value: "no_interesado", label: "No interesado", tone: "gray" },
  { value: "no_necesita", label: "No necesita el servicio", tone: "gray" },
  { value: "venta_ganada", label: "Venta ganada", tone: "green" },
  { value: "venta_perdida", label: "Venta perdida", tone: "red" },
] as const);
export type LeadStatus = (typeof LEAD_STATUSES)[number]["value"];
export const CLOSED_LEAD_STATUSES: LeadStatus[] = ["no_interesado", "no_necesita", "venta_ganada", "venta_perdida"];

export const CALL_RESULTS = catalog([
  { value: "contesto", label: "Contestó", tone: "green" },
  { value: "no_contesto", label: "No contestó", tone: "yellow" },
  { value: "buzon", label: "Buzón de voz", tone: "yellow" },
  { value: "numero_equivocado", label: "Número equivocado", tone: "red" },
  { value: "reunion", label: "Reunión realizada", tone: "blue" },
  { value: "mensaje", label: "Mensaje / WhatsApp", tone: "blue" },
] as const);

export const INTEREST_LEVELS = catalog([
  { value: "alto", label: "Alto", tone: "green" },
  { value: "medio", label: "Medio", tone: "yellow" },
  { value: "bajo", label: "Bajo", tone: "gray" },
  { value: "ninguno", label: "Ninguno", tone: "red" },
] as const);

export const SESSION_STATUSES = catalog([
  { value: "pendiente_coordinar", label: "Pendiente de coordinar", tone: "gray" },
  { value: "contactar_cliente", label: "Contactar al cliente", tone: "yellow" },
  { value: "esperando_respuesta", label: "Esperando respuesta", tone: "yellow" },
  { value: "fecha_propuesta", label: "Fecha propuesta", tone: "blue" },
  { value: "confirmada", label: "Confirmada", tone: "green" },
  { value: "realizada", label: "Realizada", tone: "green" },
  { value: "reprogramada", label: "Reprogramada", tone: "blue" },
  { value: "cancelada", label: "Cancelada", tone: "gray" },
] as const);
export type SessionStatus = (typeof SESSION_STATUSES)[number]["value"];
export const OPEN_SESSION_STATUSES: SessionStatus[] = [
  "pendiente_coordinar",
  "contactar_cliente",
  "esperando_respuesta",
  "fecha_propuesta",
  "confirmada",
  "reprogramada",
];

export const PLAN_STATUSES = catalog([
  { value: "pendiente_planificacion", label: "Pendiente de planificación", tone: "gray" },
  { value: "en_planificacion", label: "En planificación", tone: "blue" },
  { value: "revision_interna", label: "En revisión interna", tone: "blue" },
  { value: "pendiente_aprobacion_cliente", label: "Pendiente de aprobación del cliente", tone: "yellow" },
  { value: "cambios_solicitados", label: "Cambios solicitados", tone: "yellow" },
  { value: "aprobada", label: "Aprobada", tone: "green" },
  { value: "en_produccion", label: "En producción", tone: "blue" },
  { value: "completada", label: "Completada", tone: "green" },
] as const);
export type PlanStatus = (typeof PLAN_STATUSES)[number]["value"];

export const DESIGN_STATUSES = catalog([
  { value: "pendiente", label: "Pendiente", tone: "gray" },
  { value: "en_diseno", label: "En diseño", tone: "blue" },
  { value: "revision_interna", label: "En revisión interna", tone: "blue" },
  { value: "pendiente_cambios", label: "Pendiente de cambios", tone: "yellow" },
  { value: "aprobado", label: "Aprobado", tone: "blue" },
  { value: "finalizado", label: "Finalizado y listo para publicar", tone: "green" },
] as const);

export const VIDEO_STATUSES = catalog([
  { value: "pendiente_material", label: "Pendiente de material", tone: "gray" },
  { value: "material_recibido", label: "Material recibido", tone: "blue" },
  { value: "en_edicion", label: "En edición", tone: "blue" },
  { value: "revision_interna", label: "En revisión interna", tone: "blue" },
  { value: "pendiente_cambios", label: "Pendiente de cambios", tone: "yellow" },
  { value: "aprobado", label: "Aprobado", tone: "blue" },
  { value: "editado", label: "Editado y listo para publicar", tone: "green" },
] as const);

export const DELIVERABLE_KINDS = catalog([
  { value: "diseno", label: "Arte gráfico", tone: "blue" },
  { value: "perfil", label: "Foto de perfil", tone: "blue" },
  { value: "portada", label: "Portada", tone: "blue" },
  { value: "reel", label: "Reel", tone: "blue" },
  { value: "story", label: "Story", tone: "blue" },
] as const);
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number]["value"];
export const COMPLETED_DELIVERABLE_STATUSES = ["finalizado", "editado"] as const;

export function deliverableStatuses(kind: DeliverableKind) {
  return kind === "reel" ? VIDEO_STATUSES : DESIGN_STATUSES;
}
export function initialDeliverableStatus(kind: DeliverableKind) {
  return kind === "reel" ? "pendiente_material" : "pendiente";
}
export function completedStatusFor(kind: DeliverableKind) {
  return kind === "reel" ? "editado" : "finalizado";
}

export const BOARD_STATUSES = catalog([
  { value: "pendiente", label: "Pendiente", tone: "gray" },
  { value: "en_produccion", label: "En producción", tone: "blue" },
  { value: "en_revision", label: "En revisión", tone: "blue" },
  { value: "produccion_incompleta", label: "Producción incompleta", tone: "red" },
  { value: "listo_para_publicar", label: "Listo para publicar", tone: "green" },
  { value: "con_retraso", label: "Con retraso", tone: "red" },
] as const);
export type BoardStatus = (typeof BOARD_STATUSES)[number]["value"];

export const PUBLICATION_STATUSES = catalog([
  { value: "pendiente", label: "Pendiente", tone: "gray" },
  { value: "lista_programar", label: "Lista para programar", tone: "blue" },
  { value: "programada", label: "Programada", tone: "blue" },
  { value: "publicada", label: "Publicada", tone: "green" },
  { value: "fallida", label: "Fallida", tone: "red" },
  { value: "reprogramada", label: "Reprogramada", tone: "yellow" },
  { value: "no_aplica", label: "No aplica", tone: "gray" },
] as const);
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]["value"];

export const SOCIAL_NETWORKS = catalog([
  { value: "facebook", label: "Facebook", tone: "blue" },
  { value: "instagram", label: "Instagram", tone: "blue" },
  { value: "tiktok", label: "TikTok", tone: "blue" },
  { value: "linkedin", label: "LinkedIn", tone: "blue" },
  { value: "youtube", label: "YouTube", tone: "blue" },
] as const);
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]["value"];

export const TASK_STATUSES = catalog([
  { value: "pendiente", label: "Pendiente", tone: "gray" },
  { value: "en_progreso", label: "En progreso", tone: "blue" },
  { value: "completada", label: "Completada", tone: "green" },
  { value: "cancelada", label: "Cancelada", tone: "gray" },
] as const);

export const WEEKDAYS = catalog([
  { value: "1", label: "Lunes", tone: "gray" },
  { value: "2", label: "Martes", tone: "gray" },
  { value: "3", label: "Miércoles", tone: "gray" },
  { value: "4", label: "Jueves", tone: "gray" },
  { value: "5", label: "Viernes", tone: "gray" },
  { value: "6", label: "Sábado", tone: "gray" },
  { value: "7", label: "Domingo", tone: "gray" },
] as const);
export const weekdayNames = (days: readonly number[]) => days.map((d) => WEEKDAYS[d - 1]?.label.toLowerCase()).filter(Boolean).join(", ");

export const DEPARTMENTS = catalog([
  { value: "gerencia", label: "Gerencia", tone: "blue" },
  { value: "administracion", label: "Administración", tone: "blue" },
  { value: "ventas", label: "Ventas", tone: "blue" },
  { value: "produccion", label: "Producción", tone: "blue" },
  { value: "diseno", label: "Diseño", tone: "blue" },
  { value: "video", label: "Video", tone: "blue" },
  { value: "estrategia", label: "Estrategia y Campañas", tone: "blue" },
  { value: "community", label: "Community Management", tone: "blue" },
  { value: "contabilidad", label: "Contabilidad y Finanzas", tone: "blue" },
] as const);

export const CURRENCIES = catalog([
  { value: "NIO", label: "Córdobas (C$)", tone: "gray" },
  { value: "USD", label: "Dólares (US$)", tone: "gray" },
] as const);
export type Currency = (typeof CURRENCIES)[number]["value"];

export const INVOICE_STATUSES = catalog([
  { value: "pendiente", label: "Pendiente", tone: "gray" },
  { value: "parcial", label: "Parcialmente pagado", tone: "yellow" },
  { value: "pagada", label: "Pagado", tone: "green" },
  { value: "vencida", label: "Vencido", tone: "red" },
  { value: "anulada", label: "Anulado", tone: "gray" },
] as const);
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]["value"];

export const EXPENSE_STATUSES = catalog([
  { value: "pendiente", label: "Pendiente", tone: "gray" },
  { value: "parcial", label: "Pago parcial", tone: "yellow" },
  { value: "pagado", label: "Pagado", tone: "green" },
  { value: "vencido", label: "Vencido", tone: "red" },
  { value: "anulado", label: "Anulado", tone: "gray" },
] as const);

export const PAYMENT_METHODS = catalog([
  { value: "efectivo", label: "Efectivo", tone: "gray" },
  { value: "transferencia", label: "Transferencia", tone: "gray" },
  { value: "tarjeta", label: "Tarjeta", tone: "gray" },
  { value: "cheque", label: "Cheque", tone: "gray" },
  { value: "deposito", label: "Depósito", tone: "gray" },
  { value: "otro", label: "Otro", tone: "gray" },
] as const);

export const EMPLOYEE_STATUSES = catalog([
  { value: "activo", label: "Activo", tone: "green" },
  { value: "suspendido", label: "Suspendido", tone: "yellow" },
  { value: "baja", label: "Baja", tone: "gray" },
] as const);

export const CONTRACT_TYPES = catalog([
  { value: "indeterminado", label: "Tiempo indeterminado", tone: "gray" },
  { value: "determinado", label: "Tiempo determinado", tone: "gray" },
  { value: "servicios_profesionales", label: "Servicios profesionales", tone: "gray" },
  { value: "medio_tiempo", label: "Medio tiempo", tone: "gray" },
] as const);

export const PAY_FREQUENCIES = catalog([
  { value: "quincenal", label: "Salario mensual, la mitad cada quincena", tone: "gray" },
  { value: "mensual", label: "Salario mensual, todo a fin de mes", tone: "gray" },
] as const);

export const PAYROLL_STATUSES = catalog([
  { value: "borrador", label: "Borrador", tone: "gray" },
  { value: "aprobada", label: "Aprobada", tone: "blue" },
  { value: "contabilizada", label: "Contabilizada", tone: "green" },
  { value: "pagada", label: "Pagada", tone: "green" },
] as const);

export const VACATION_STATUSES = catalog([
  { value: "solicitada", label: "Solicitada", tone: "yellow" },
  { value: "aprobada", label: "Aprobada", tone: "green" },
  { value: "rechazada", label: "Rechazada", tone: "red" },
  { value: "cancelada", label: "Cancelada", tone: "gray" },
] as const);

export function labelOf(list: readonly { value: string; label: string }[], value: string | null | undefined) {
  if (!value) return "—";
  return list.find((i) => i.value === value)?.label ?? value;
}
export function toneOf(list: readonly { value: string; tone: Tone }[], value: string | null | undefined): Tone {
  return list.find((i) => i.value === value)?.tone ?? "gray";
}
export function values<T extends readonly { value: string }[]>(list: T) {
  return list.map((i) => i.value) as unknown as [T[number]["value"], ...T[number]["value"][]];
}
