import { eq, ilike, or } from "drizzle-orm";
import { clients, employees, leads } from "../db/schema";
import { can, type Ctx } from "../ctx";
import { AppError } from "../errors";
import type { Permission } from "../auth/permissions";
import { normalizeName } from "@/lib/text";
import { firstOfMonth } from "@/lib/dates";
import * as clientsSvc from "../services/clients";
import * as employeesSvc from "../services/employees";
import * as expensesSvc from "../services/expenses";
import * as leadsSvc from "../services/leads";
import * as sessionsSvc from "../services/sessions";
import * as strategySvc from "../services/strategy";
import * as productionSvc from "../services/production";
import * as invoicesSvc from "../services/invoices";
import * as publicationsSvc from "../services/publications";
import * as tasksSvc from "../services/tasks";
import * as reportsSvc from "../services/reports";

type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[] };
type Input = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ToolResult = { summary: string; data?: unknown; affected?: { type: string; id: string; label?: string }[] };

export type ToolDef = {
  name: string;
  description: string;
  input_schema: JsonSchema;
  /** El usuario necesita al menos uno de estos permisos para que el agente vea la herramienta. */
  perms: Permission[];
  /** Acciones sensibles: siempre requieren confirmación explícita del usuario antes de ejecutarse. */
  sensitive?: boolean | ((input: Input) => boolean);
  run(ctx: Ctx, input: Input, opts: { confirmed: boolean }): Promise<ToolResult>;
};

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const date = (description: string) => ({ type: "string", description: `${description} (AAAA-MM-DD)` });

// ───────────────────────── Resolución de referencias ─────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveClient(ctx: Ctx, ref: string) {
  if (!ref) throw new AppError("VALIDATION", "Indica el cliente");
  const rows = UUID.test(ref)
    ? await ctx.tx.select().from(clients).where(eq(clients.id, ref))
    : await ctx.tx.select().from(clients).where(or(eq(clients.normalizedName, normalizeName(ref)), ilike(clients.tradeName, `%${ref}%`)));
  const exact = rows.filter((r) => r.normalizedName === normalizeName(ref));
  const list = exact.length ? exact : rows;
  if (!list.length) throw new AppError("NOT_FOUND", `No encontré ningún cliente que coincida con "${ref}"`);
  if (list.length > 1) throw new AppError("VALIDATION", `"${ref}" coincide con varios clientes: ${list.map((c) => `${c.tradeName} (${c.city ?? "sin ciudad"}, id ${c.id})`).join("; ")}. ¿Cuál?`);
  return list[0];
}

async function resolveEmployee(ctx: Ctx, ref: string | undefined | null) {
  if (!ref) return null;
  const rows = UUID.test(ref)
    ? await ctx.tx.select().from(employees).where(eq(employees.id, ref))
    : await ctx.tx.select().from(employees).where(or(eq(employees.normalizedName, normalizeName(ref)), ilike(employees.fullName, `%${ref}%`)));
  const exact = rows.filter((r) => r.normalizedName === normalizeName(ref));
  const list = exact.length ? exact : rows;
  if (!list.length) throw new AppError("NOT_FOUND", `No encontré ningún colaborador que coincida con "${ref}"`);
  if (list.length > 1) throw new AppError("VALIDATION", `"${ref}" coincide con varios colaboradores: ${list.map((e) => `${e.fullName} (id ${e.id})`).join("; ")}. ¿Cuál?`);
  return list[0];
}

async function resolveLead(ctx: Ctx, ref: string) {
  const rows = UUID.test(ref)
    ? await ctx.tx.select().from(leads).where(eq(leads.id, ref))
    : await ctx.tx.select().from(leads).where(or(eq(leads.normalizedName, normalizeName(ref)), ilike(leads.tradeName, `%${ref}%`)));
  if (!rows.length) throw new AppError("NOT_FOUND", `No encontré ningún prospecto que coincida con "${ref}"`);
  if (rows.length > 1) throw new AppError("VALIDATION", `"${ref}" coincide con varios prospectos: ${rows.map((l) => `${l.tradeName} (id ${l.id})`).join("; ")}. ¿Cuál?`);
  return rows[0];
}

const contractSchema = {
  type: "object",
  description: "Contrato y paquete. Si no se indican cantidades se usa el paquete estándar (6 artes, perfil, portada, 6 reels, sesión mensual, estrategia y gestión de redes).",
  properties: {
    startDate: date("Inicio del servicio"),
    monthlyPrice: num("Precio mensual"),
    currency: { type: "string", enum: ["NIO", "USD"] },
    billingDay: num("Día de pago (1-28)"),
    designsPerMonth: num("Artes gráficos al mes"),
    reelsPerMonth: num("Reels al mes"),
    includeProfilePhoto: bool("Incluye foto de perfil"),
    includeCover: bool("Incluye portada"),
    sessionsEnabled: bool("Incluye sesión de contenido"),
    sessionFrequencyMonths: num("Cada cuántos meses hay sesión"),
    includeStrategy: bool("Incluye planificación estratégica"),
    includeCommunity: bool("Incluye gestión de redes"),
    socialNetworks: { type: "array", items: { type: "string", enum: ["facebook", "instagram", "tiktok", "linkedin", "youtube"] } },
    firstSessionDate: date("Fecha prevista de la primera sesión"),
  },
  required: ["startDate", "monthlyPrice", "currency"],
};

const pick = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// ───────────────────────── Herramientas ─────────────────────────

export const TOOLS: ToolDef[] = [
  // Clientes
  {
    name: "search_clients",
    description: "Busca clientes por nombre (incluye archivados). Úsala antes de crear o modificar clientes.",
    input_schema: { type: "object", properties: { query: str("Nombre o parte del nombre") }, required: ["query"] },
    perms: ["clients.read"],
    async run(ctx, i) {
      const rows = await clientsSvc.searchClients(ctx, i.query, 15);
      return { summary: `${rows.length} cliente(s) encontrados`, data: rows };
    },
  },
  {
    name: "get_client",
    description: "Ficha completa de un cliente: contrato vigente, estado, responsables e historial de estados.",
    input_schema: { type: "object", properties: { client: str("Nombre o id del cliente") }, required: ["client"] },
    perms: ["clients.read"],
    async run(ctx, i) {
      const c = await resolveClient(ctx, i.client);
      const detail = await clientsSvc.getClient(ctx, c.id);
      const data = can(ctx, "finance.read") ? detail : { ...detail, contract: detail.contract ? { ...detail.contract, monthlyPrice: undefined } : null };
      return { summary: `Ficha de ${c.tradeName}`, data };
    },
  },
  {
    name: "create_client",
    description: "Crea un cliente con su contrato y genera automáticamente sus espacios (agenda, estrategia, producción, publicaciones, facturación). Busca duplicados antes. No inventes datos que el usuario no dio.",
    input_schema: {
      type: "object",
      properties: {
        tradeName: str("Nombre comercial"),
        contactName: str("Persona de contacto"),
        phone: str("Teléfono"),
        email: str("Correo"),
        city: str("Ciudad"),
        country: str("País (por defecto Nicaragua)"),
        address: str("Dirección"),
        accountManager: str("Responsable de la cuenta (nombre o id de colaborador)"),
        communityManager: str("Community Manager (nombre o id)"),
        notes: str("Observaciones"),
        contract: contractSchema,
        allowDuplicate: bool("Solo true si el usuario confirmó que NO es duplicado de un registro existente"),
      },
      required: ["tradeName", "contract"],
    },
    perms: ["clients.write"],
    async run(ctx, i) {
      const am = await resolveEmployee(ctx, i.accountManager);
      const cm = await resolveEmployee(ctx, i.communityManager);
      const r = await clientsSvc.createClient(
        ctx,
        { client: { ...pick(i, ["tradeName", "contactName", "phone", "email", "city", "country", "address", "notes"]), accountManagerId: am?.id, communityManagerId: cm?.id }, contract: i.contract },
        { allowDuplicate: !!i.allowDuplicate },
      );
      const verified = await clientsSvc.getClient(ctx, r.client.id);
      return {
        summary: `Cliente ${verified.tradeName} creado (estado: ${verified.status}). Espacios: ${verified.workspaces.join(", ")}. Tableros: ${r.workspace.boards}, planificaciones: ${r.workspace.plans}, cuentas por cobrar: ${r.workspace.invoices}, tareas de incorporación: ${r.workspace.onboardingTasks}.`,
        data: { id: verified.id, workspace: r.workspace },
        affected: [{ type: "client", id: verified.id, label: verified.tradeName }],
      };
    },
  },
  {
    name: "update_client",
    description: "Actualiza datos de la ficha de un cliente (contacto, teléfono, correo, ciudad, responsables, observaciones).",
    input_schema: {
      type: "object",
      properties: { client: str("Nombre o id"), contactName: str(""), phone: str(""), email: str(""), city: str(""), address: str(""), website: str(""), notes: str(""), accountManager: str("Nombre o id del colaborador"), communityManager: str("Nombre o id del colaborador") },
      required: ["client"],
    },
    perms: ["clients.write"],
    async run(ctx, i) {
      const c = await resolveClient(ctx, i.client);
      const patch: Record<string, unknown> = pick(i, ["contactName", "phone", "email", "city", "address", "website", "notes"]);
      if (i.accountManager) patch.accountManagerId = (await resolveEmployee(ctx, i.accountManager))!.id;
      if (i.communityManager) patch.communityManagerId = (await resolveEmployee(ctx, i.communityManager))!.id;
      const after = await clientsSvc.updateClient(ctx, c.id, patch);
      return { summary: `Ficha de ${after.tradeName} actualizada`, affected: [{ type: "client", id: c.id, label: c.tradeName }] };
    },
  },
  {
    name: "archive_client",
    description: "Archiva un cliente: lo retira de los ciclos operativos sin borrar su historial. Requiere motivo.",
    input_schema: { type: "object", properties: { client: str("Nombre o id"), reason: str("Motivo") }, required: ["client", "reason"] },
    perms: ["clients.archive"],
    sensitive: true,
    async run(ctx, i) {
      const c = await resolveClient(ctx, i.client);
      const r = await clientsSvc.archiveClient(ctx, c.id, i.reason);
      return { summary: `${c.tradeName} archivado. Se cancelaron ${r.stats.boardsCancelled} tablero(s) futuros, ${r.stats.tasksCancelled} tarea(s) y ${r.stats.sessionsCancelled} sesión(es). El historial y las facturas se conservan.`, affected: [{ type: "client", id: c.id, label: c.tradeName }] };
    },
  },
  {
    name: "reactivate_client",
    description: "Reactiva un cliente archivado o dado de baja con un nuevo contrato (confirma paquete, precio y fecha de inicio con el usuario).",
    input_schema: { type: "object", properties: { client: str("Nombre o id"), contract: contractSchema, reason: str("Motivo") }, required: ["client", "contract"] },
    perms: ["clients.archive"],
    sensitive: true,
    async run(ctx, i) {
      const c = await resolveClient(ctx, i.client);
      const r = await clientsSvc.reactivateClient(ctx, c.id, i.contract, i.reason);
      return { summary: `${c.tradeName} reactivado (estado: ${r.client.status}).`, data: r.workspace, affected: [{ type: "client", id: c.id, label: c.tradeName }] };
    },
  },
  // Colaboradores
  {
    name: "search_employees",
    description: "Busca colaboradores por nombre, correo o cargo.",
    input_schema: { type: "object", properties: { query: str("Texto a buscar (vacío = todos)") } },
    perms: ["employees.read", "tasks.write", "production.manage"],
    async run(ctx, i) {
      const rows = can(ctx, "employees.read") ? await employeesSvc.listEmployees(ctx, { q: i.query, includeSalary: true }) : await employeesSvc.listAssignableEmployees(ctx);
      return { summary: `${rows.length} colaborador(es)`, data: rows };
    },
  },
  {
    name: "create_employee",
    description: "Registra un colaborador. Obligatorios: nombre completo y fecha de inicio. El salario es mensual bruto. Busca duplicados antes; no inventes datos personales.",
    input_schema: {
      type: "object",
      properties: {
        fullName: str("Nombre completo"),
        startDate: date("Fecha de inicio"),
        salary: num("Salario mensual bruto"),
        currency: { type: "string", enum: ["NIO", "USD"], description: "córdobas = NIO, dólares = USD" },
        position: str("Cargo"),
        departmentKey: { type: "string", enum: ["gerencia", "administracion", "ventas", "produccion", "diseno", "video", "estrategia", "community", "contabilidad"] },
        phone: str("Teléfono"),
        email: str("Correo"),
        payFrequency: { type: "string", enum: ["quincenal", "mensual"] },
        contractType: { type: "string", enum: ["indeterminado", "determinado", "servicios_profesionales", "medio_tiempo"] },
        allowDuplicate: bool("Solo true si el usuario confirmó que NO es la misma persona que un registro existente"),
      },
      required: ["fullName", "startDate"],
    },
    perms: ["employees.write"],
    async run(ctx, i) {
      const { allowDuplicate, ...data } = i;
      const emp = await employeesSvc.createEmployee(ctx, data, { allowDuplicate: !!allowDuplicate });
      const v = await employeesSvc.getEmployee(ctx, emp.id);
      return {
        summary: `Colaborador registrado: ${v.fullName}, inicio ${v.startDate}${v.currentSalary || v.salaryHistory?.length ? `, salario ${v.salaryHistory![0].salary} ${v.salaryHistory![0].currency}` : ""}.`,
        data: { id: v.id },
        affected: [{ type: "employee", id: v.id, label: v.fullName }],
      };
    },
  },
  {
    name: "update_employee",
    description: "Actualiza cargo, departamento, jornada, estado o datos de contacto de un colaborador, con fecha efectiva.",
    input_schema: {
      type: "object",
      properties: { employee: str("Nombre o id"), position: str(""), departmentKey: str(""), workSchedule: str(""), status: { type: "string", enum: ["activo", "suspendido", "baja"] }, terminationDate: date("Fecha de terminación si es baja"), phone: str(""), email: str(""), effectiveDate: date("Fecha efectiva") },
      required: ["employee"],
    },
    perms: ["employees.write"],
    sensitive: (i) => i.status === "baja",
    async run(ctx, i) {
      const e = (await resolveEmployee(ctx, i.employee))!;
      const after = await employeesSvc.updateEmployee(ctx, e.id, pick(i, ["position", "departmentKey", "workSchedule", "status", "terminationDate", "phone", "email", "effectiveDate"]));
      return { summary: `Colaborador ${after.fullName} actualizado`, affected: [{ type: "employee", id: e.id, label: e.fullName }] };
    },
  },
  {
    name: "change_salary",
    description: "Registra un cambio salarial con fecha efectiva (conserva el historial).",
    input_schema: { type: "object", properties: { employee: str("Nombre o id"), salary: num("Nuevo salario mensual bruto"), currency: { type: "string", enum: ["NIO", "USD"] }, effectiveDate: date("Fecha efectiva"), reason: str("Motivo") }, required: ["employee", "salary", "effectiveDate"] },
    perms: ["employees.salary"],
    sensitive: true,
    async run(ctx, i, { confirmed }) {
      const e = (await resolveEmployee(ctx, i.employee))!;
      const row = await employeesSvc.changeSalary(ctx, e.id, pick(i, ["salary", "currency", "effectiveDate", "reason"]), { confirmRetroactive: confirmed });
      return { summary: `Salario de ${e.fullName}: ${row.salary} ${row.currency} desde ${row.effectiveDate}`, affected: [{ type: "employee", id: e.id, label: e.fullName }] };
    },
  },
  // Gastos
  {
    name: "create_expense",
    description: "Registra un gasto. Categorías (clave): alquiler_vehiculos, transporte, ia, software, alquiler_local, electricidad, agua, internet, impuestos, dgi, alcaldia, equipos, produccion_foto, produccion_video, diseno_recursos, publicidad, servicios_profesionales, comisiones, otros. Si el usuario dice que ya está pagado, después registra el pago con record_expense_payment.",
    input_schema: {
      type: "object",
      properties: { name: str("Concepto"), category: str("Clave de categoría"), amount: num("Importe"), currency: { type: "string", enum: ["NIO", "USD"] }, supplier: str("Proveedor"), dueDate: date("Vencimiento"), accountingDate: date("Fecha contable (por defecto hoy)"), client: str("Cliente relacionado (opcional)"), notes: str(""), allowDuplicate: bool("Solo si el usuario confirmó que no es duplicado") },
      required: ["name", "category", "amount", "currency"],
    },
    perms: ["expenses.write"],
    async run(ctx, i) {
      const clientId = i.client ? (await resolveClient(ctx, i.client)).id : undefined;
      const e = await expensesSvc.createExpense(ctx, { ...pick(i, ["name", "category", "amount", "currency", "supplier", "dueDate", "accountingDate", "notes"]), clientId }, { allowDuplicate: !!i.allowDuplicate });
      return { summary: `Gasto registrado: ${e.name} · ${e.categoryName} · ${e.amount} ${e.currency} (pendiente de pago)`, data: { id: e.id }, affected: [{ type: "expense", id: e.id, label: e.name }] };
    },
  },
  {
    name: "find_open_expenses",
    description: "Busca gastos pendientes o con pago parcial por nombre, proveedor o categoría (p. ej. 'alquiler del local').",
    input_schema: { type: "object", properties: { query: str("Texto") }, required: ["query"] },
    perms: ["expenses.read"],
    async run(ctx, i) {
      const rows = await expensesSvc.findOpenExpenses(ctx, i.query);
      return { summary: `${rows.length} gasto(s) abiertos`, data: rows.map((r) => pick(r, ["id", "name", "categoryName", "amount", "paidAmount", "balance", "currency", "dueDate", "status"])) };
    },
  },
  {
    name: "record_expense_payment",
    description: "Registra el pago (total o parcial) de un gasto existente. Sin importe paga el saldo pendiente.",
    input_schema: { type: "object", properties: { expenseId: str("Id del gasto"), amount: num("Importe (opcional)"), paidAt: date("Fecha de pago"), method: { type: "string", enum: ["efectivo", "transferencia", "tarjeta", "cheque", "deposito", "otro"] }, reference: str("Referencia") }, required: ["expenseId", "paidAt", "method"] },
    perms: ["expenses.pay"],
    sensitive: true,
    async run(ctx, i) {
      const r = await expensesSvc.recordExpensePayment(ctx, i.expenseId, pick(i, ["amount", "paidAt", "method", "reference"]));
      return { summary: `Pago registrado en "${r.expense.name}": ${r.payment.amount} ${r.expense.currency}. Estado: ${r.expense.status}, saldo ${Math.round((r.expense.amount - r.expense.paidAmount) * 100) / 100}.`, affected: [{ type: "expense", id: r.expense.id, label: r.expense.name }] };
    },
  },
  {
    name: "get_expenses_summary",
    description: "Resumen de gastos del mes: total, pagado, pendiente, vencido, por categoría y comparación con el mes anterior.",
    input_schema: { type: "object", properties: { month: date("Cualquier fecha del mes (por defecto el actual)") } },
    perms: ["expenses.read"],
    async run(ctx, i) {
      const s = await expensesSvc.expensesSummary(ctx, i.month ?? ctx.today);
      return { summary: "Resumen de gastos", data: { ...s, upcoming: s.upcoming.map((u) => pick(u, ["name", "balance", "currency", "dueDate"])) } };
    },
  },
  // Ventas
  {
    name: "search_leads",
    description: "Busca prospectos por nombre, contacto, ciudad o teléfono, o lista una lista de trabajo (hoy, pendientes, volver, interesados, propuestas, proximo_mes, ganadas, cerrados).",
    input_schema: { type: "object", properties: { query: str("Texto"), list: str("Lista") } },
    perms: ["leads.read"],
    async run(ctx, i) {
      const rows = await leadsSvc.listLeads(ctx, { q: i.query, list: i.list });
      return { summary: `${rows.length} prospecto(s)`, data: rows.slice(0, 40).map((r) => ({ ...pick(r.lead, ["id", "tradeName", "contactName", "phone", "city", "status", "nextFollowupAt", "nextAction"]), owner: r.owner })) };
    },
  },
  {
    name: "create_lead",
    description: "Crea un prospecto (por defecto en 'pendiente de contactar'). Si hay que llamar en una fecha, usa nextFollowupAt.",
    input_schema: {
      type: "object",
      properties: { tradeName: str("Nombre del negocio"), contactName: str(""), phone: str(""), email: str(""), city: str(""), country: str(""), businessType: str("Tipo de negocio"), source: str("Fuente"), status: str("Estado inicial"), nextFollowupAt: date("Próximo seguimiento"), nextAction: str("Próxima acción"), notes: str(""), allowDuplicate: bool("Solo si el usuario confirmó que no es duplicado") },
      required: ["tradeName"],
    },
    perms: ["leads.write"],
    async run(ctx, i) {
      const { allowDuplicate, ...data } = i;
      const l = await leadsSvc.createLead(ctx, data, { allowDuplicate: !!allowDuplicate });
      return { summary: `Prospecto ${l.tradeName} creado en "${l.status}"${l.nextFollowupAt ? `, seguimiento el ${l.nextFollowupAt}` : ""}`, data: { id: l.id }, affected: [{ type: "lead", id: l.id, label: l.tradeName }] };
    },
  },
  {
    name: "update_lead",
    description: "Actualiza estado, próximo seguimiento o datos de un prospecto. Para venta ganada usa convert_lead.",
    input_schema: { type: "object", properties: { lead: str("Nombre o id"), status: str(""), nextFollowupAt: date(""), nextAction: str(""), phone: str(""), contactName: str(""), notes: str("") }, required: ["lead"] },
    perms: ["leads.write"],
    async run(ctx, i) {
      const l = await resolveLead(ctx, i.lead);
      const after = await leadsSvc.updateLead(ctx, l.id, pick(i, ["status", "nextFollowupAt", "nextAction", "phone", "contactName", "notes"]));
      return { summary: `Prospecto ${after.tradeName} actualizado (${after.status})`, affected: [{ type: "lead", id: l.id, label: l.tradeName }] };
    },
  },
  {
    name: "log_call",
    description: "Registra una llamada o contacto con un prospecto.",
    input_schema: {
      type: "object",
      properties: { lead: str("Nombre o id"), result: { type: "string", enum: ["contesto", "no_contesto", "buzon", "numero_equivocado", "reunion", "mensaje"] }, answeredBy: str(""), response: str(""), interestLevel: { type: "string", enum: ["alto", "medio", "bajo", "ninguno"] }, objections: str(""), notes: str(""), nextAction: str(""), nextFollowupAt: date(""), statusAfter: str("Nuevo estado") },
      required: ["lead", "result"],
    },
    perms: ["leads.write"],
    async run(ctx, i) {
      const l = await resolveLead(ctx, i.lead);
      const r = await leadsSvc.logCall(ctx, l.id, pick(i, ["result", "answeredBy", "response", "interestLevel", "objections", "notes", "nextAction", "nextFollowupAt", "statusAfter"]));
      return { summary: `Llamada registrada con ${l.tradeName}. Estado: ${r.lead.status}`, affected: [{ type: "lead", id: l.id, label: l.tradeName }] };
    },
  },
  {
    name: "convert_lead",
    description: "Marca una venta como ganada: crea (o vincula) el cliente, registra el contrato y genera espacios y cuenta por cobrar.",
    input_schema: { type: "object", properties: { lead: str("Nombre o id"), contract: contractSchema, linkClient: str("Cliente existente a vincular (si ya era cliente)") }, required: ["lead", "contract"] },
    perms: ["leads.convert"],
    sensitive: true,
    async run(ctx, i) {
      const l = await resolveLead(ctx, i.lead);
      const linkClientId = i.linkClient ? (await resolveClient(ctx, i.linkClient)).id : undefined;
      const r = await leadsSvc.convertLead(ctx, l.id, { contract: i.contract, linkClientId });
      return { summary: `Venta ganada: ${l.tradeName} → ${r.created ? "cliente creado" : "vinculado a cliente existente"}.`, data: r.workspace, affected: [{ type: "client", id: r.clientId, label: l.tradeName }] };
    },
  },
  // Agenda
  {
    name: "get_sessions_attention",
    description: "Sesiones de contenido que requieren atención (por coordinar, sin confirmar, vencidas) y próximas sesiones de un cliente.",
    input_schema: { type: "object", properties: { client: str("Cliente (opcional)") } },
    perms: ["sessions.read"],
    async run(ctx, i) {
      if (i.client) {
        const c = await resolveClient(ctx, i.client);
        const s = await sessionsSvc.clientSessions(ctx, c.id);
        return { summary: `Sesiones de ${c.tradeName}`, data: { last: s.last, next: s.next } };
      }
      const rows = await sessionsSvc.sessionsNeedingAttention(ctx);
      return { summary: `${rows.length} sesión(es) requieren atención`, data: rows.map((r) => ({ id: r.id, client: r.clientName, date: r.date, status: r.status, alert: r.alert.label })) };
    },
  },
  {
    name: "schedule_content_session",
    description: "Programa (o reprograma) la sesión de contenido de un cliente. Si ya tiene una sesión abierta la actualiza, no crea otra.",
    input_schema: { type: "object", properties: { client: str("Nombre o id"), date: date("Fecha"), confirmed: bool("true si el cliente ya confirmó; false si es solo propuesta"), startTime: str("HH:MM"), endTime: str("HH:MM"), location: str(""), responsible: str("Colaborador responsable") }, required: ["client", "date"] },
    perms: ["sessions.write"],
    async run(ctx, i) {
      const c = await resolveClient(ctx, i.client);
      const resp = await resolveEmployee(ctx, i.responsible);
      const r = await sessionsSvc.scheduleSession(ctx, { clientId: c.id, date: i.date, confirmed: i.confirmed ?? true, startTime: i.startTime, endTime: i.endTime, location: i.location, responsibleId: resp?.id });
      return { summary: `Sesión de ${c.tradeName} ${r.session.status === "confirmada" ? "confirmada" : "propuesta"} para el ${r.session.confirmedDate ?? r.session.proposedDate}${r.created ? " (nueva)" : " (sesión existente actualizada)"}`, affected: [{ type: "content_session", id: r.session.id, label: c.tradeName }] };
    },
  },
  {
    name: "update_content_session",
    description: "Cambia el estado de coordinación, fecha propuesta/confirmada, horario, lugar o responsable de una sesión. Para 'realizada' usa complete_content_session.",
    input_schema: { type: "object", properties: { sessionId: str("Id de la sesión"), status: { type: "string", enum: ["pendiente_coordinar", "contactar_cliente", "esperando_respuesta", "fecha_propuesta", "confirmada", "reprogramada"] }, proposedDate: date(""), confirmedDate: date(""), startTime: str(""), endTime: str(""), location: str(""), notes: str("") }, required: ["sessionId"] },
    perms: ["sessions.write"],
    async run(ctx, i) {
      const s = await sessionsSvc.updateSession(ctx, i.sessionId, pick(i, ["status", "proposedDate", "confirmedDate", "startTime", "endTime", "location", "notes"]));
      return { summary: `Sesión actualizada: ${s.status}${s.confirmedDate ? ` · ${s.confirmedDate}` : ""}`, affected: [{ type: "content_session", id: s.id }] };
    },
  },
  {
    name: "complete_content_session",
    description: "Registra que una sesión ya se realizó (con la fecha real). Calcula la siguiente fecha prevista.",
    input_schema: { type: "object", properties: { sessionId: str("Id"), completedDate: date("Fecha en que se realizó"), notes: str("") }, required: ["sessionId", "completedDate"] },
    perms: ["sessions.write"],
    async run(ctx, i) {
      const r = await sessionsSvc.completeSession(ctx, i.sessionId, { completedDate: i.completedDate, notes: i.notes });
      return { summary: `Sesión registrada como realizada el ${i.completedDate}.${r.next ? ` Próxima prevista: ${r.next.expectedDate}.` : ""}`, affected: [{ type: "content_session", id: r.session.id }] };
    },
  },
  // Estrategia y producción
  {
    name: "create_monthly_content_plan",
    description: "Crea la planificación mensual de un cliente (con sus reels y diseños vacíos). No duplica si ya existe.",
    input_schema: { type: "object", properties: { client: str("Nombre o id"), month: date("Cualquier fecha del mes") }, required: ["client", "month"] },
    perms: ["strategy.write"],
    async run(ctx, i) {
      const c = await resolveClient(ctx, i.client);
      const r = await strategySvc.createMonthlyPlan(ctx, c.id, i.month);
      return { summary: r.created ? `Planificación de ${c.tradeName} para ${firstOfMonth(i.month)} creada` : `La planificación de ${c.tradeName} para ese mes ya existía (no se duplicó)`, data: { id: r.plan.id, link: `/estrategia/${r.plan.id}` }, affected: [{ type: "content_plan", id: r.plan.id, label: c.tradeName }] };
    },
  },
  {
    name: "get_production_status",
    description: "Avance de producción del mes: por cliente, diseños X/6, perfil y portada X/2, reels X/6, porcentaje, estado y retrasos. Úsalo para '¿qué clientes tienen sus reels editados?' o 'listos para publicar'.",
    input_schema: { type: "object", properties: { month: date("Cualquier fecha del mes (por defecto actual)"), client: str("Cliente (opcional)"), delayedOnly: bool("Solo con retraso") } },
    perms: ["production.read"],
    async run(ctx, i) {
      const clientId = i.client ? (await resolveClient(ctx, i.client)).id : undefined;
      const rows = await productionSvc.productionOverview(ctx, { period: i.month ?? ctx.today, clientId, delayedOnly: i.delayedOnly });
      return {
        summary: `${rows.length} tablero(s)`,
        data: rows.map((r) => ({ boardId: r.id, client: r.clientName, designs: `${r.designs.done}/${r.designs.total}`, profileCover: `${r.profileCover.done}/${r.profileCover.total}`, reels: `${r.reels.done}/${r.reels.total}`, progress: Math.round(r.progress * 1000) / 10 + "%", status: r.status, delayed: r.delayed, designer: r.designer, editor: r.editor, dueDate: r.dueDate })),
      };
    },
  },
  {
    name: "get_board",
    description: "Detalle de un tablero mensual con todos sus entregables (ids, estado, responsable, archivo).",
    input_schema: { type: "object", properties: { boardId: str("Id del tablero"), client: str("O cliente…"), month: date("…y mes") } },
    perms: ["production.read"],
    async run(ctx, i) {
      const b = i.boardId ? await productionSvc.getBoard(ctx, i.boardId) : await productionSvc.getBoardByClientPeriod(ctx, (await resolveClient(ctx, i.client)).id, i.month ?? ctx.today);
      if (!b) throw new AppError("NOT_FOUND", "No existe tablero para ese cliente y mes");
      return { summary: `Tablero ${b.clientName} ${b.period}: ${b.done}/${b.total}`, data: { id: b.id, status: b.status, deliverables: b.deliverables.map((d) => pick(d, ["id", "kind", "position", "title", "status", "assignee", "dueDate", "finalFileUrl"])) } };
    },
  },
  {
    name: "update_deliverable_status",
    description: "Cambia el estado de un entregable. Diseños: pendiente, en_diseno, revision_interna, pendiente_cambios, aprobado, finalizado. Reels: pendiente_material, material_recibido, en_edicion, revision_interna, pendiente_cambios, aprobado, editado. Finalizado/editado exige enlace al archivo final.",
    input_schema: { type: "object", properties: { deliverableId: str("Id"), status: str("Nuevo estado"), finalFileUrl: str("Enlace al archivo final"), notes: str("") }, required: ["deliverableId"] },
    perms: ["production.manage", "production.update_own"],
    async run(ctx, i) {
      const d = await productionSvc.updateDeliverable(ctx, i.deliverableId, pick(i, ["status", "finalFileUrl", "notes"]));
      return { summary: `${d.title}: ${d.status}`, affected: [{ type: "deliverable", id: d.id, label: d.title }] };
    },
  },
  {
    name: "bulk_complete_deliverables",
    description: "Marca como terminados los seis diseños o los seis reels de un tablero (solo los que tienen archivo final).",
    input_schema: { type: "object", properties: { boardId: str("Id del tablero"), group: { type: "string", enum: ["disenos", "reels"] } }, required: ["boardId", "group"] },
    perms: ["production.bulk"],
    sensitive: true,
    async run(ctx, i) {
      const r = await productionSvc.bulkCompleteDeliverables(ctx, i.boardId, i.group, { confirm: true });
      return { summary: `Completados: ${r.completed.length}. Sin archivo final (no completados): ${r.skippedMissingFile.join(", ") || "ninguno"}.` };
    },
  },
  {
    name: "assign_board",
    description: "Asigna el diseñador y/o el editor de video de un tablero mensual (se propaga a sus entregables).",
    input_schema: { type: "object", properties: { boardId: str("Id del tablero"), designer: str("Diseñador (nombre o id)"), editor: str("Editor (nombre o id)") }, required: ["boardId"] },
    perms: ["production.manage"],
    async run(ctx, i) {
      const designer = await resolveEmployee(ctx, i.designer);
      const editor = await resolveEmployee(ctx, i.editor);
      await productionSvc.updateBoard(ctx, i.boardId, { ...(designer ? { designerId: designer.id } : {}), ...(editor ? { editorId: editor.id } : {}) });
      return { summary: `Tablero asignado${designer ? ` · diseño: ${designer.fullName}` : ""}${editor ? ` · video: ${editor.fullName}` : ""}`, affected: [{ type: "production_board", id: i.boardId }] };
    },
  },
  // Tareas
  {
    name: "create_task",
    description: "Crea una tarea asignada a un colaborador.",
    input_schema: { type: "object", properties: { title: str(""), description: str(""), client: str("Cliente (opcional)"), assignee: str("Colaborador"), dueDate: date(""), priority: { type: "string", enum: ["baja", "normal", "alta"] } }, required: ["title"] },
    perms: ["tasks.write"],
    async run(ctx, i) {
      const clientId = i.client ? (await resolveClient(ctx, i.client)).id : undefined;
      const assignee = await resolveEmployee(ctx, i.assignee);
      const t = await tasksSvc.createTask(ctx, { title: i.title, description: i.description, clientId, assigneeId: assignee?.id, dueDate: i.dueDate, priority: i.priority });
      return { summary: `Tarea creada: ${t.title}${assignee ? ` → ${assignee.fullName}` : ""}`, affected: [{ type: "task", id: t.id, label: t.title }] };
    },
  },
  {
    name: "assign_task",
    description: "Asigna tareas existentes a un colaborador.",
    input_schema: { type: "object", properties: { taskIds: { type: "array", items: { type: "string" } }, assignee: str("Colaborador") }, required: ["taskIds", "assignee"] },
    perms: ["tasks.write"],
    async run(ctx, i) {
      const e = (await resolveEmployee(ctx, i.assignee))!;
      const rows = await tasksSvc.assignTasks(ctx, i.taskIds, e.id);
      return { summary: `${rows.length} tarea(s) asignada(s) a ${e.fullName}` };
    },
  },
  {
    name: "list_tasks",
    description: "Lista tareas abiertas (propias o de todo el equipo), opcionalmente solo atrasadas.",
    input_schema: { type: "object", properties: { scope: { type: "string", enum: ["mias", "todas"] }, overdue: bool("Solo atrasadas") } },
    perms: ["tasks.read", "tasks.update_own"],
    async run(ctx, i) {
      const rows = await tasksSvc.listTasks(ctx, { scope: i.scope ?? "todas", overdue: i.overdue });
      return { summary: `${rows.length} tarea(s)`, data: rows.slice(0, 50).map((r) => ({ id: r.task.id, title: r.task.title, client: r.clientName, assignee: r.assignee, dueDate: r.task.dueDate, status: r.task.status })) };
    },
  },
  // Finanzas
  {
    name: "list_invoices",
    description: "Facturas / cuentas por cobrar. status: abiertas, pendiente, parcial, vencida, pagada, anulada.",
    input_schema: { type: "object", properties: { status: str(""), client: str("") } },
    perms: ["finance.read"],
    async run(ctx, i) {
      const clientId = i.client ? (await resolveClient(ctx, i.client)).id : undefined;
      const rows = await invoicesSvc.listInvoices(ctx, { status: i.status ?? "abiertas", clientId });
      return { summary: `${rows.length} factura(s)`, data: rows.slice(0, 50).map((r) => pick(r, ["id", "number", "clientName", "concept", "amount", "paidAmount", "balance", "currency", "dueDate", "status"])) };
    },
  },
  {
    name: "create_invoice",
    description: "Crea una cuenta por cobrar manual (las mensuales del contrato se generan solas).",
    input_schema: { type: "object", properties: { client: str(""), concept: str(""), amount: num(""), currency: { type: "string", enum: ["NIO", "USD"] }, issueDate: date(""), dueDate: date("") }, required: ["client", "concept", "amount", "currency", "issueDate", "dueDate"] },
    perms: ["invoices.write"],
    async run(ctx, i) {
      const c = await resolveClient(ctx, i.client);
      const inv = await invoicesSvc.createInvoice(ctx, { clientId: c.id, ...pick(i, ["concept", "amount", "currency", "issueDate", "dueDate"]) });
      return { summary: `Cuenta por cobrar ${inv.number} creada para ${c.tradeName}: ${inv.amount} ${inv.currency}, vence ${inv.dueDate}`, affected: [{ type: "invoice", id: inv.id, label: inv.number }] };
    },
  },
  {
    name: "record_invoice_payment",
    description: "Registra un cobro (total o parcial) de una factura.",
    input_schema: { type: "object", properties: { invoiceId: str(""), amount: num(""), paidAt: date(""), method: { type: "string", enum: ["efectivo", "transferencia", "tarjeta", "cheque", "deposito", "otro"] }, reference: str("") }, required: ["invoiceId", "amount", "paidAt", "method"] },
    perms: ["invoices.pay"],
    sensitive: true,
    async run(ctx, i) {
      const r = await invoicesSvc.recordInvoicePayment(ctx, i.invoiceId, pick(i, ["amount", "paidAt", "method", "reference"]));
      return { summary: `Cobro registrado en ${r.invoice.number}: ${r.payment.amount} ${r.invoice.currency}. Estado: ${r.invoice.status}.`, affected: [{ type: "invoice", id: r.invoice.id, label: r.invoice.number }] };
    },
  },
  {
    name: "get_financial_summary",
    description: "Resumen financiero del mes: facturado, reconocido, cobrado, por cobrar, vencido, gastos, cuentas por pagar, nómina, flujo de caja y resultado operativo estimado.",
    input_schema: { type: "object", properties: { month: date("Cualquier fecha del mes") } },
    perms: ["finance.read"],
    async run(ctx, i) {
      return { summary: "Resumen financiero", data: await reportsSvc.financialSummary(ctx, i.month ?? ctx.today) };
    },
  },
  // Publicaciones
  {
    name: "get_publication_status",
    description: "Cumplimiento de publicaciones de un día (por cliente, red social y Community Manager).",
    input_schema: { type: "object", properties: { date: date("Fecha (por defecto hoy)") } },
    perms: ["publications.read"],
    async run(ctx, i) {
      const d = await publicationsSvc.dailyCompliance(ctx, i.date ?? ctx.today);
      return { summary: `Publicaciones del ${d.date}: ${d.total.published}/${d.total.planned}`, data: d };
    },
  },
];

export function toolsFor(ctx: Ctx) {
  return TOOLS.filter((t) => t.perms.some((p) => can(ctx, p)));
}

export function isSensitive(tool: ToolDef, input: Input) {
  return typeof tool.sensitive === "function" ? tool.sensitive(input) : !!tool.sensitive;
}

