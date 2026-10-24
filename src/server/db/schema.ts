import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  smallint,
  numeric,
  date,
  time,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });
const day = (name: string) => date(name, { mode: "string" });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const currency = () => text("currency").notNull().default("NIO");

// ───────────────────────── Organización y usuarios ─────────────────────────

export const departments = pgTable("departments", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
});

export const employees = pgTable(
  "employees",
  {
    id: id(),
    fullName: text("full_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    position: text("position"),
    departmentKey: text("department_key").references(() => departments.key),
    hireDate: day("hire_date"),
    startDate: day("start_date").notNull(),
    payFrequency: text("pay_frequency").notNull().default("quincenal"),
    contractType: text("contract_type").notNull().default("indeterminado"),
    workSchedule: text("work_schedule"),
    status: text("status").notNull().default("activo"),
    managerId: uuid("manager_id"),
    terminationDate: day("termination_date"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("employees_email_uq").on(sql`lower(${t.email})`).where(sql`${t.email} is not null`),
    index("employees_normalized_name_idx").on(t.normalizedName),
    check("employees_status_ck", sql`${t.status} in ('activo','suspendido','baja')`),
    check("employees_pay_freq_ck", sql`${t.payFrequency} in ('quincenal','mensual')`),
  ],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    employeeId: uuid("employee_id").references(() => employees.id),
    lastLoginAt: ts("last_login_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
    uniqueIndex("users_employee_uq").on(t.employeeId).where(sql`${t.employeeId} is not null`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash)],
);

export const roles = pgTable("roles", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
});

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  module: text("module").notNull(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

// ───────────────────────── Personal ─────────────────────────

export const employeeSalaryHistory = pgTable(
  "employee_salary_history",
  {
    id: id(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    salary: money("salary").notNull(),
    currency: currency(),
    effectiveDate: day("effective_date").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("salary_history_emp_date_uq").on(t.employeeId, t.effectiveDate),
    check("salary_positive_ck", sql`${t.salary} >= 0`),
  ],
);

export const employeeChanges = pgTable(
  "employee_changes",
  {
    id: id(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    effectiveDate: day("effective_date").notNull(),
    changedBy: uuid("changed_by"),
    createdAt: createdAt(),
  },
  (t) => [index("employee_changes_emp_idx").on(t.employeeId)],
);

// ───────────────────────── Clientes ─────────────────────────

export const clients = pgTable(
  "clients",
  {
    id: id(),
    tradeName: text("trade_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    legalName: text("legal_name"),
    taxId: text("tax_id"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    country: text("country").notNull().default("Nicaragua"),
    city: text("city"),
    address: text("address"),
    website: text("website"),
    socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
    status: text("status").notNull().default("en_incorporacion"),
    accountManagerId: uuid("account_manager_id").references(() => employees.id),
    communityManagerId: uuid("community_manager_id").references(() => employees.id),
    serviceStartDate: day("service_start_date"),
    serviceEndDate: day("service_end_date"),
    notes: text("notes"),
    leadId: uuid("lead_id"),
    archivedAt: ts("archived_at"),
    archivedBy: uuid("archived_by"),
    archiveReason: text("archive_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("clients_name_city_uq").on(t.normalizedName, sql`coalesce(lower(${t.city}), '')`),
    uniqueIndex("clients_tax_id_uq").on(t.taxId).where(sql`${t.taxId} is not null`),
    index("clients_status_idx").on(t.status),
    check(
      "clients_status_ck",
      sql`${t.status} in ('prospecto','en_incorporacion','activo','en_pausa','en_proceso_baja','archivado','dado_de_baja')`,
    ),
  ],
);

export const clientContacts = pgTable("client_contacts", {
  id: id(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id),
  name: text("name").notNull(),
  role: text("role"),
  phone: text("phone"),
  email: text("email"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: createdAt(),
});

/** Plantillas de paquete. Cada contrato copia sus valores y puede modificarlos. */
export const servicePackages = pgTable("service_packages", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description"),
  monthlyPrice: money("monthly_price"),
  currency: currency(),
  sessionsEnabled: boolean("sessions_enabled").notNull().default(true),
  sessionFrequencyMonths: integer("session_frequency_months").notNull().default(1),
  designsPerMonth: integer("designs_per_month").notNull().default(6),
  reelsPerMonth: integer("reels_per_month").notNull().default(6),
  includeProfilePhoto: boolean("include_profile_photo").notNull().default(true),
  includeCover: boolean("include_cover").notNull().default(true),
  includeStrategy: boolean("include_strategy").notNull().default(true),
  includeCommunity: boolean("include_community").notNull().default(true),
  socialNetworks: text("social_networks").array().notNull().default(sql`'{facebook,instagram}'::text[]`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const clientContracts = pgTable(
  "client_contracts",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    packageId: uuid("package_id").references(() => servicePackages.id),
    name: text("name").notNull(),
    startDate: day("start_date").notNull(),
    endDate: day("end_date"),
    monthlyPrice: money("monthly_price").notNull(),
    currency: currency(),
    billingDay: integer("billing_day").notNull().default(5),
    billingFrequencyMonths: integer("billing_frequency_months").notNull().default(1),
    sessionsEnabled: boolean("sessions_enabled").notNull().default(true),
    sessionFrequencyMonths: integer("session_frequency_months").notNull().default(1),
    coordinationLeadDays: integer("coordination_lead_days").notNull().default(10),
    designsPerMonth: integer("designs_per_month").notNull().default(6),
    reelsPerMonth: integer("reels_per_month").notNull().default(6),
    includeProfilePhoto: boolean("include_profile_photo").notNull().default(true),
    includeCover: boolean("include_cover").notNull().default(true),
    includeStrategy: boolean("include_strategy").notNull().default(true),
    includeCommunity: boolean("include_community").notNull().default(true),
    socialNetworks: text("social_networks").array().notNull().default(sql`'{}'::text[]`),
    storiesPerMonth: integer("stories_per_month").notNull().default(0),
    /** Días de la semana (1 = lunes … 7 = domingo) para artes y reels, y para stories. */
    postWeekdays: smallint("post_weekdays").array().notNull().default(sql`'{}'::smallint[]`),
    storyWeekdays: smallint("story_weekdays").array().notNull().default(sql`'{}'::smallint[]`),
    servicesNotes: text("services_notes"),
    status: text("status").notNull().default("vigente"),
    documentAssetId: uuid("document_asset_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contracts_one_active_uq").on(t.clientId).where(sql`${t.status} = 'vigente'`),
    check("contracts_status_ck", sql`${t.status} in ('vigente','finalizado','cancelado')`),
    check("contracts_billing_day_ck", sql`${t.billingDay} between 1 and 31`),
    check("contracts_counts_ck", sql`${t.designsPerMonth} >= 0 and ${t.reelsPerMonth} >= 0 and ${t.storiesPerMonth} >= 0`),
    check("contracts_weekdays_ck", sql`${t.postWeekdays} <@ '{1,2,3,4,5,6,7}'::smallint[] and ${t.storyWeekdays} <@ '{1,2,3,4,5,6,7}'::smallint[]`),
    check("contracts_freq_ck", sql`${t.sessionFrequencyMonths} >= 1 and ${t.billingFrequencyMonths} >= 1`),
    check("contracts_price_ck", sql`${t.monthlyPrice} >= 0`),
  ],
);

/** Registro de módulos inicializados por cliente (inicialización idempotente). */
export const clientWorkspaces = pgTable(
  "client_workspaces",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    module: text("module").notNull(),
    initializedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.module] })],
);

export const clientStatusHistory = pgTable(
  "client_status_history",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    effectiveDate: day("effective_date"),
    changedBy: uuid("changed_by"),
    createdAt: createdAt(),
  },
  (t) => [index("client_status_history_client_idx").on(t.clientId)],
);

export const clientOffboardingRecords = pgTable("client_offboarding_records", {
  id: id(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id),
  effectiveDate: day("effective_date").notNull(),
  reason: text("reason").notNull(),
  lastServicePeriod: day("last_service_period").notNull(),
  responsibleId: uuid("responsible_id").references(() => employees.id),
  notes: text("notes"),
  futureSessionsDecision: text("future_sessions_decision").notNull().default("cancelar"),
  pendingSummary: jsonb("pending_summary").notNull().default({}),
  completedAt: ts("completed_at"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    network: text("network").notNull(),
    handle: text("handle"),
    url: text("url"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("social_accounts_client_network_uq").on(t.clientId, t.network)],
);

// ───────────────────────── Ventas ─────────────────────────

export const leads = pgTable(
  "leads",
  {
    id: id(),
    tradeName: text("trade_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    phoneDigits: text("phone_digits"),
    email: text("email"),
    country: text("country").notNull().default("Nicaragua"),
    city: text("city"),
    address: text("address"),
    businessType: text("business_type"),
    socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
    website: text("website"),
    source: text("source"),
    ownerId: uuid("owner_id").references(() => employees.id),
    status: text("status").notNull().default("pendiente_contactar"),
    lastContactAt: ts("last_contact_at"),
    nextFollowupAt: day("next_followup_at"),
    nextAction: text("next_action"),
    notes: text("notes"),
    lostReason: text("lost_reason"),
    clientId: uuid("client_id").references(() => clients.id),
    convertedAt: ts("converted_at"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leads_status_idx").on(t.status),
    index("leads_normalized_name_idx").on(t.normalizedName),
    index("leads_phone_idx").on(t.phoneDigits),
  ],
);

export const leadCalls = pgTable(
  "lead_calls",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    calledAt: ts("called_at").notNull(),
    channel: text("channel").notNull().default("llamada"),
    agentId: uuid("agent_id").references(() => employees.id),
    result: text("result").notNull(),
    answeredBy: text("answered_by"),
    response: text("response"),
    interestLevel: text("interest_level"),
    objections: text("objections"),
    notes: text("notes"),
    nextAction: text("next_action"),
    nextFollowupAt: day("next_followup_at"),
    statusAfter: text("status_after"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("lead_calls_lead_idx").on(t.leadId)],
);

export const salesProposals = pgTable("sales_proposals", {
  id: id(),
  leadId: uuid("lead_id")
    .notNull()
    .references(() => leads.id),
  title: text("title").notNull(),
  packageId: uuid("package_id").references(() => servicePackages.id),
  monthlyPrice: money("monthly_price").notNull(),
  currency: currency(),
  sentAt: day("sent_at"),
  status: text("status").notNull().default("borrador"),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

// ───────────────────────── Tareas ─────────────────────────

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    clientId: uuid("client_id").references(() => clients.id),
    title: text("title").notNull(),
    description: text("description"),
    department: text("department"),
    assigneeId: uuid("assignee_id").references(() => employees.id),
    dueDate: day("due_date"),
    status: text("status").notNull().default("pendiente"),
    priority: text("priority").notNull().default("normal"),
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: uuid("source_id"),
    dedupeKey: text("dedupe_key"),
    completedAt: ts("completed_at"),
    completedBy: uuid("completed_by"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tasks_dedupe_uq").on(t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    index("tasks_assignee_idx").on(t.assigneeId, t.status),
    index("tasks_client_idx").on(t.clientId),
    check("tasks_status_ck", sql`${t.status} in ('pendiente','en_progreso','completada','cancelada')`),
  ],
);

// ───────────────────────── Agenda de sesiones ─────────────────────────

export const contentSessions = pgTable(
  "content_sessions",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    contractId: uuid("contract_id").references(() => clientContracts.id),
    expectedDate: day("expected_date").notNull(),
    coordinationStartDate: day("coordination_start_date").notNull(),
    proposedDate: day("proposed_date"),
    confirmedDate: day("confirmed_date"),
    completedDate: day("completed_date"),
    startTime: time("start_time"),
    endTime: time("end_time"),
    status: text("status").notNull().default("pendiente_coordinar"),
    responsibleId: uuid("responsible_id").references(() => employees.id),
    location: text("location"),
    clientContact: text("client_contact"),
    notes: text("notes"),
    previousSessionId: uuid("previous_session_id"),
    generationKey: text("generation_key").notNull(),
    boardId: uuid("board_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("content_sessions_generation_uq").on(t.generationKey),
    index("content_sessions_client_idx").on(t.clientId),
    check(
      "content_sessions_status_ck",
      sql`${t.status} in ('pendiente_coordinar','contactar_cliente','esperando_respuesta','fecha_propuesta','confirmada','realizada','reprogramada','cancelada')`,
    ),
    check(
      "content_sessions_done_ck",
      sql`${t.status} <> 'realizada' or ${t.completedDate} is not null`,
    ),
    check(
      "content_sessions_confirmed_ck",
      sql`${t.status} <> 'confirmada' or ${t.confirmedDate} is not null`,
    ),
  ],
);

export const contentSessionEvents = pgTable(
  "content_session_events",
  {
    id: id(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => contentSessions.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    changes: jsonb("changes").notNull().default({}),
    note: text("note"),
    userId: uuid("user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("content_session_events_session_idx").on(t.sessionId)],
);

// ───────────────────────── Estrategia ─────────────────────────

export const monthlyContentPlans = pgTable(
  "monthly_content_plans",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    contractId: uuid("contract_id").references(() => clientContracts.id),
    period: day("period").notNull(),
    strategistId: uuid("strategist_id").references(() => employees.id),
    dueDate: day("due_date"),
    objectives: text("objectives"),
    targetAudience: text("target_audience"),
    pillars: text("pillars"),
    campaigns: text("campaigns"),
    themes: text("themes"),
    creativeConcepts: text("creative_concepts"),
    visualReferences: text("visual_references"),
    ctas: text("ctas"),
    notes: text("notes"),
    status: text("status").notNull().default("pendiente_planificacion"),
    approvedAt: ts("approved_at"),
    approvedBy: uuid("approved_by"),
    duplicatedFromId: uuid("duplicated_from_id"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("plans_client_period_uq").on(t.clientId, t.period),
    check("plans_period_first_day_ck", sql`extract(day from ${t.period}) = 1`),
    check(
      "plans_status_ck",
      sql`${t.status} in ('pendiente_planificacion','en_planificacion','revision_interna','pendiente_aprobacion_cliente','cambios_solicitados','aprobada','en_produccion','completada')`,
    ),
  ],
);

export const contentPlanItems = pgTable(
  "content_plan_items",
  {
    id: id(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => monthlyContentPlans.id),
    kind: text("kind").notNull(),
    position: integer("position").notNull(),
    theme: text("theme"),
    objective: text("objective"),
    hook: text("hook"),
    script: text("script"),
    centralIdea: text("central_idea"),
    references: text("references"),
    cta: text("cta"),
    tentativePublishDate: day("tentative_publish_date"),
    responsibleId: uuid("responsible_id").references(() => employees.id),
    status: text("status").notNull().default("pendiente"),
    productionDeliverableId: uuid("production_deliverable_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("plan_items_uq").on(t.planId, t.kind, t.position),
    check("plan_items_kind_ck", sql`${t.kind} in ('reel','diseno')`),
  ],
);

// ───────────────────────── Producción ─────────────────────────

export const productionBoards = pgTable(
  "production_boards",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    contractId: uuid("contract_id").references(() => clientContracts.id),
    period: day("period").notNull(),
    designerId: uuid("designer_id").references(() => employees.id),
    editorId: uuid("editor_id").references(() => employees.id),
    dueDate: day("due_date"),
    notes: text("notes"),
    readyAt: ts("ready_at"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("boards_client_period_uq").on(t.clientId, t.period),
    check("boards_period_first_day_ck", sql`extract(day from ${t.period}) = 1`),
  ],
);

export const productionDeliverables = pgTable(
  "production_deliverables",
  {
    id: id(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => productionBoards.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    kind: text("kind").notNull(),
    position: integer("position").notNull(),
    platform: text("platform").notNull().default(""),
    title: text("title").notNull(),
    scriptRef: text("script_ref"),
    countsTowardProgress: boolean("counts_toward_progress").notNull().default(true),
    assigneeId: uuid("assignee_id").references(() => employees.id),
    dueDate: day("due_date"),
    status: text("status").notNull(),
    finalFileUrl: text("final_file_url"),
    finalFileAssetId: uuid("final_file_asset_id"),
    notes: text("notes"),
    planItemId: uuid("plan_item_id"),
    completedAt: ts("completed_at"),
    completedBy: uuid("completed_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("deliverables_uq").on(t.boardId, t.kind, t.position, t.platform),
    index("deliverables_assignee_idx").on(t.assigneeId),
    check("deliverables_kind_ck", sql`${t.kind} in ('diseno','perfil','portada','reel','story')`),
    check(
      "deliverables_status_ck",
      sql`(${t.kind} = 'reel' and ${t.status} in ('pendiente_material','material_recibido','en_edicion','revision_interna','pendiente_cambios','aprobado','editado'))
       or (${t.kind} <> 'reel' and ${t.status} in ('pendiente','en_diseno','revision_interna','pendiente_cambios','aprobado','finalizado'))`,
    ),
    // Regla de negocio crítica: nada se declara terminado sin archivo final.
    check(
      "deliverables_final_file_ck",
      sql`${t.status} not in ('finalizado','editado') or ${t.finalFileUrl} is not null or ${t.finalFileAssetId} is not null`,
    ),
  ],
);

export const deliverableEvents = pgTable(
  "deliverable_events",
  {
    id: id(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => productionDeliverables.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    changes: jsonb("changes").notNull().default({}),
    note: text("note"),
    userId: uuid("user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("deliverable_events_deliverable_idx").on(t.deliverableId)],
);

// ───────────────────────── Community Management ─────────────────────────

export const publications = pgTable(
  "publications",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    deliverableId: uuid("deliverable_id").references(() => productionDeliverables.id),
    network: text("network").notNull(),
    scheduledDate: day("scheduled_date").notNull(),
    scheduledTime: time("scheduled_time"),
    contentTitle: text("content_title").notNull(),
    caption: text("caption"),
    status: text("status").notNull().default("pendiente"),
    responsibleId: uuid("responsible_id").references(() => employees.id),
    evidenceUrl: text("evidence_url"),
    notes: text("notes"),
    publishedAt: ts("published_at"),
    confirmedBy: uuid("confirmed_by"),
    confirmedAt: ts("confirmed_at"),
    verification: text("verification"),
    rescheduledFromId: uuid("rescheduled_from_id"),
    rescheduledToId: uuid("rescheduled_to_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("publications_date_idx").on(t.scheduledDate),
    index("publications_client_idx").on(t.clientId),
    uniqueIndex("publications_deliverable_network_uq")
      .on(t.deliverableId, t.network)
      .where(sql`${t.deliverableId} is not null and ${t.status} not in ('reprogramada','no_aplica')`),
    check(
      "publications_status_ck",
      sql`${t.status} in ('pendiente','lista_programar','programada','publicada','fallida','reprogramada','no_aplica')`,
    ),
    check(
      "publications_confirmed_ck",
      sql`${t.status} <> 'publicada' or (${t.confirmedBy} is not null and ${t.confirmedAt} is not null)`,
    ),
  ],
);

/** Cierre diario inmutable del cumplimiento de publicaciones. */
export const dailyPublicationSnapshots = pgTable(
  "daily_publication_snapshots",
  {
    id: id(),
    day: day("day").notNull(),
    scope: text("scope").notNull(), // 'total' | 'network:<red>' | 'cm:<employeeId>' | 'client:<clientId>'
    planned: integer("planned").notNull(),
    published: integer("published").notNull(),
    failed: integer("failed").notNull(),
    pending: integer("pending").notNull(),
    clientsPlanned: integer("clients_planned").notNull().default(0),
    clientsCompliant: integer("clients_compliant").notNull().default(0),
    closedAt: createdAt(),
  },
  (t) => [uniqueIndex("daily_pub_snap_uq").on(t.day, t.scope)],
);

// ───────────────────────── Finanzas ─────────────────────────

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull().unique(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    contractId: uuid("contract_id").references(() => clientContracts.id),
    period: day("period"),
    concept: text("concept").notNull(),
    amount: money("amount").notNull(),
    paidAmount: money("paid_amount").notNull().default(0),
    currency: currency(),
    issueDate: day("issue_date").notNull(),
    dueDate: day("due_date").notNull(),
    status: text("status").notNull().default("pendiente"),
    sourceKey: text("source_key"),
    voidedAt: ts("voided_at"),
    voidedBy: uuid("voided_by"),
    voidReason: text("void_reason"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_source_uq").on(t.sourceKey).where(sql`${t.sourceKey} is not null`),
    index("invoices_client_idx").on(t.clientId),
    check("invoices_status_ck", sql`${t.status} in ('pendiente','parcial','pagada','anulada')`),
    check("invoices_amount_ck", sql`${t.amount} > 0 and ${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.amount}`),
    check("invoices_void_ck", sql`${t.status} <> 'anulada' or (${t.voidReason} is not null and ${t.voidedBy} is not null)`),
  ],
);

export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: money("amount").notNull(),
    currency: currency(),
    paidAt: day("paid_at").notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    receiptAssetId: uuid("receipt_asset_id"),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoice_payments_invoice_idx").on(t.invoiceId),
    uniqueIndex("invoice_payments_idem_uq").on(t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    check("invoice_payments_amount_ck", sql`${t.amount} > 0`),
  ],
);

export const expenseCategories = pgTable("expense_categories", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("operativo"), // operativo | nomina | impuesto | directo
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: id(),
    name: text("name").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    supplier: text("supplier"),
    description: text("description"),
    amount: money("amount").notNull(),
    currency: currency(),
    dayOfMonth: integer("day_of_month").notNull().default(1),
    intervalMonths: integer("interval_months").notNull().default(1),
    startDate: day("start_date").notNull(),
    endDate: day("end_date"),
    status: text("status").notNull().default("activa"),
    paymentMethod: text("payment_method"),
    clientId: uuid("client_id").references(() => clients.id),
    department: text("department"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("recurring_status_ck", sql`${t.status} in ('activa','pausada','cancelada')`),
    check("recurring_day_ck", sql`${t.dayOfMonth} between 1 and 28`),
    check("recurring_amount_ck", sql`${t.amount} > 0`),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    name: text("name").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    supplier: text("supplier"),
    description: text("description"),
    amount: money("amount").notNull(),
    paidAmount: money("paid_amount").notNull().default(0),
    currency: currency(),
    registeredAt: day("registered_at").notNull(),
    dueDate: day("due_date"),
    accountingDate: day("accounting_date").notNull(),
    status: text("status").notNull().default("pendiente"),
    paymentMethod: text("payment_method"),
    receiptAssetId: uuid("receipt_asset_id"),
    clientId: uuid("client_id").references(() => clients.id),
    department: text("department"),
    notes: text("notes"),
    sourceType: text("source_type").notNull().default("manual"), // manual | recurrente | nomina
    recurringId: uuid("recurring_id").references(() => recurringExpenses.id),
    sourceKey: text("source_key"),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("expenses_source_uq").on(t.sourceKey).where(sql`${t.sourceKey} is not null`),
    index("expenses_accounting_idx").on(t.accountingDate),
    check("expenses_status_ck", sql`${t.status} in ('pendiente','parcial','pagado','anulado')`),
    check("expenses_amount_ck", sql`${t.amount} > 0 and ${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.amount}`),
  ],
);

export const expensePayments = pgTable(
  "expense_payments",
  {
    id: id(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id),
    amount: money("amount").notNull(),
    paidAt: day("paid_at").notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    receiptAssetId: uuid("receipt_asset_id"),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("expense_payments_expense_idx").on(t.expenseId),
    uniqueIndex("expense_payments_idem_uq").on(t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    check("expense_payments_amount_ck", sql`${t.amount} > 0`),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    period: day("period").notNull(),
    amount: money("amount").notNull(),
    currency: currency(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("budgets_uq").on(t.categoryId, t.period, t.currency)],
);

// ───────────────────────── Nómina y prestaciones ─────────────────────────

export type LaborRuleParams = {
  inssEmployeeRate: number;
  inssEmployerRate: number;
  inatecRate: number;
  /** Tabla anual: desde, hasta (null = sin límite), cuota fija, tasa sobre el exceso de "desde". */
  irBrackets: { from: number; to: number | null; base: number; rate: number }[];
  irDeductInss: boolean;
  aguinaldoMonthsPerYear: number;
  aguinaldoPeriodStartMonth: number; // 12 = diciembre
  aguinaldoBase: "ultimo_salario" | "promedio_12_meses" | "mayor_ultimos_6_meses";
  vacationDaysPerMonth: number;
  payrollCurrency: string;
};

export const laborRuleSets = pgTable(
  "labor_rule_sets",
  {
    id: id(),
    version: text("version").notNull().unique(),
    country: text("country").notNull().default("NI"),
    effectiveFrom: day("effective_from").notNull(),
    effectiveTo: day("effective_to"),
    params: jsonb("params").$type<LaborRuleParams>().notNull(),
    sources: text("sources").notNull(),
    validated: boolean("validated").notNull().default(false),
    validatedBy: uuid("validated_by"),
    validatedAt: ts("validated_at"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
);

export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: id(),
    periodStart: day("period_start").notNull(),
    periodEnd: day("period_end").notNull(),
    payDate: day("pay_date").notNull(),
    frequency: text("frequency").notNull().default("quincenal"),
    status: text("status").notNull().default("borrador"),
    ruleSetId: uuid("rule_set_id").references(() => laborRuleSets.id),
    isEstimate: boolean("is_estimate").notNull().default(true),
    approvedBy: uuid("approved_by"),
    approvedAt: ts("approved_at"),
    postedBy: uuid("posted_by"),
    postedAt: ts("posted_at"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payroll_periods_uq").on(t.periodStart, t.periodEnd, t.frequency),
    check("payroll_status_ck", sql`${t.status} in ('borrador','aprobada','contabilizada','pagada')`),
  ],
);

export const payrollRecords = pgTable(
  "payroll_records",
  {
    id: id(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payrollPeriods.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    baseSalary: money("base_salary").notNull(),
    grossSalary: money("gross_salary").notNull(),
    otherEarnings: money("other_earnings").notNull().default(0),
    inssEmployee: money("inss_employee").notNull().default(0),
    incomeTax: money("income_tax").notNull().default(0),
    otherDeductions: money("other_deductions").notNull().default(0),
    totalDeductions: money("total_deductions").notNull().default(0),
    netSalary: money("net_salary").notNull(),
    inssEmployer: money("inss_employer").notNull().default(0),
    inatec: money("inatec").notNull().default(0),
    currency: currency(),
    workedDays: integer("worked_days").notNull(),
    detail: jsonb("detail").notNull().default({}),
    payStatus: text("pay_status").notNull().default("pendiente"),
    paidAt: day("paid_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payroll_records_uq").on(t.periodId, t.employeeId)],
);

export const payrollAdjustments = pgTable("payroll_adjustments", {
  id: id(),
  periodId: uuid("period_id")
    .notNull()
    .references(() => payrollPeriods.id),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  type: text("type").notNull(), // percepcion | deduccion
  concept: text("concept").notNull(),
  amount: money("amount").notNull(),
  authorizedBy: uuid("authorized_by"),
  createdAt: createdAt(),
});

export const laborBenefitAccruals = pgTable(
  "labor_benefit_accruals",
  {
    id: id(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payrollPeriods.id),
    benefit: text("benefit").notNull(), // aguinaldo | vacaciones
    amount: money("amount").notNull(),
    days: numeric("days", { precision: 8, scale: 2, mode: "number" }),
    currency: currency(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("benefit_accruals_uq").on(t.employeeId, t.periodId, t.benefit)],
);

export const vacationRequests = pgTable(
  "vacation_requests",
  {
    id: id(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    startDate: day("start_date").notNull(),
    endDate: day("end_date").notNull(),
    days: numeric("days", { precision: 6, scale: 2, mode: "number" }).notNull(),
    status: text("status").notNull().default("solicitada"),
    reason: text("reason"),
    decidedBy: uuid("decided_by"),
    decidedAt: ts("decided_at"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    check("vacation_status_ck", sql`${t.status} in ('solicitada','aprobada','rechazada','cancelada')`),
    check("vacation_days_ck", sql`${t.days} > 0 and ${t.endDate} >= ${t.startDate}`),
  ],
);

export const leaveAdjustments = pgTable("leave_adjustments", {
  id: id(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  days: numeric("days", { precision: 6, scale: 2, mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  authorizedBy: uuid("authorized_by").notNull(),
  createdAt: createdAt(),
});

// ───────────────────────── Sistema ─────────────────────────

export const fileAssets = pgTable("file_assets", {
  id: id(),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  clientId: uuid("client_id").references(() => clients.id),
  uploadedBy: uuid("uploaded_by"),
  createdAt: createdAt(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey),
    index("notifications_user_idx").on(t.userId, t.readAt),
  ],
);

export const notificationRules = pgTable(
  "notification_rules",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.type] })],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    jobKey: text("job_key").notNull(),
    runKey: text("run_key").notNull(),
    status: text("status").notNull(), // running | succeeded | failed
    attempts: integer("attempts").notNull().default(1),
    triggeredBy: text("triggered_by").notNull().default("cron"),
    stats: jsonb("stats").notNull().default({}),
    error: text("error"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [uniqueIndex("automation_runs_run_key_uq").on(t.runKey), index("automation_runs_job_idx").on(t.jobKey)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    userId: uuid("user_id"),
    source: text("source").notNull().default("ui"), // ui | agent | automation | system
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    clientId: uuid("client_id"),
    summary: text("summary").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_client_idx").on(t.clientId),
    index("audit_created_idx").on(t.createdAt),
  ],
);

export const aiConversations = pgTable("ai_conversations", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: jsonb("content").notNull(), // bloques del proveedor
    display: text("display"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_messages_conv_idx").on(t.conversationId, t.createdAt)],
);

export const aiActionLogs = pgTable(
  "ai_action_logs",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    conversationId: uuid("conversation_id"),
    instruction: text("instruction").notNull(),
    toolName: text("tool_name").notNull(),
    toolInput: jsonb("tool_input").notNull(),
    status: text("status").notNull(), // pendiente_confirmacion | ejecutada | fallida | rechazada | denegada
    requiresConfirmation: boolean("requires_confirmation").notNull().default(false),
    confirmedAt: ts("confirmed_at"),
    result: jsonb("result"),
    affected: jsonb("affected"),
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("ai_action_logs_user_idx").on(t.userId, t.createdAt)],
);
