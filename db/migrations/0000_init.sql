CREATE TABLE "ai_action_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"instruction" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_input" jsonb NOT NULL,
	"status" text NOT NULL,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"result" jsonb,
	"affected" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"display" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"source" text DEFAULT 'ui' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"client_id" uuid,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_key" text NOT NULL,
	"run_key" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"triggered_by" text DEFAULT 'cron' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"period" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'NIO' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"phone" text,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"package_id" uuid,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"monthly_price" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'NIO' NOT NULL,
	"billing_day" integer DEFAULT 5 NOT NULL,
	"billing_frequency_months" integer DEFAULT 1 NOT NULL,
	"sessions_enabled" boolean DEFAULT true NOT NULL,
	"session_frequency_months" integer DEFAULT 1 NOT NULL,
	"coordination_lead_days" integer DEFAULT 10 NOT NULL,
	"designs_per_month" integer DEFAULT 6 NOT NULL,
	"reels_per_month" integer DEFAULT 6 NOT NULL,
	"include_profile_photo" boolean DEFAULT true NOT NULL,
	"include_cover" boolean DEFAULT true NOT NULL,
	"include_strategy" boolean DEFAULT true NOT NULL,
	"include_community" boolean DEFAULT true NOT NULL,
	"social_networks" text[] DEFAULT '{}'::text[] NOT NULL,
	"services_notes" text,
	"status" text DEFAULT 'vigente' NOT NULL,
	"document_asset_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_status_ck" CHECK ("client_contracts"."status" in ('vigente','finalizado','cancelado')),
	CONSTRAINT "contracts_billing_day_ck" CHECK ("client_contracts"."billing_day" between 1 and 28),
	CONSTRAINT "contracts_counts_ck" CHECK ("client_contracts"."designs_per_month" >= 0 and "client_contracts"."reels_per_month" >= 0),
	CONSTRAINT "contracts_freq_ck" CHECK ("client_contracts"."session_frequency_months" >= 1 and "client_contracts"."billing_frequency_months" >= 1),
	CONSTRAINT "contracts_price_ck" CHECK ("client_contracts"."monthly_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "client_offboarding_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"reason" text NOT NULL,
	"last_service_period" date NOT NULL,
	"responsible_id" uuid,
	"notes" text,
	"future_sessions_decision" text DEFAULT 'cancelar' NOT NULL,
	"pending_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"effective_date" date,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_workspaces" (
	"client_id" uuid NOT NULL,
	"module" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_workspaces_client_id_module_pk" PRIMARY KEY("client_id","module")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"legal_name" text,
	"tax_id" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"country" text DEFAULT 'Nicaragua' NOT NULL,
	"city" text,
	"address" text,
	"website" text,
	"social_links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'en_incorporacion' NOT NULL,
	"account_manager_id" uuid,
	"community_manager_id" uuid,
	"service_start_date" date,
	"service_end_date" date,
	"notes" text,
	"lead_id" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_status_ck" CHECK ("clients"."status" in ('prospecto','en_incorporacion','activo','en_pausa','en_proceso_baja','archivado','dado_de_baja'))
);
--> statement-breakpoint
CREATE TABLE "content_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"theme" text,
	"objective" text,
	"hook" text,
	"script" text,
	"central_idea" text,
	"references" text,
	"cta" text,
	"tentative_publish_date" date,
	"responsible_id" uuid,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"production_deliverable_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_items_kind_ck" CHECK ("content_plan_items"."kind" in ('reel','diseno'))
);
--> statement-breakpoint
CREATE TABLE "content_session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"contract_id" uuid,
	"expected_date" date NOT NULL,
	"coordination_start_date" date NOT NULL,
	"proposed_date" date,
	"confirmed_date" date,
	"completed_date" date,
	"start_time" time,
	"end_time" time,
	"status" text DEFAULT 'pendiente_coordinar' NOT NULL,
	"responsible_id" uuid,
	"location" text,
	"client_contact" text,
	"notes" text,
	"previous_session_id" uuid,
	"generation_key" text NOT NULL,
	"board_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_sessions_status_ck" CHECK ("content_sessions"."status" in ('pendiente_coordinar','contactar_cliente','esperando_respuesta','fecha_propuesta','confirmada','realizada','reprogramada','cancelada')),
	CONSTRAINT "content_sessions_done_ck" CHECK ("content_sessions"."status" <> 'realizada' or "content_sessions"."completed_date" is not null),
	CONSTRAINT "content_sessions_confirmed_ck" CHECK ("content_sessions"."status" <> 'confirmada' or "content_sessions"."confirmed_date" is not null)
);
--> statement-breakpoint
CREATE TABLE "daily_publication_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"scope" text NOT NULL,
	"planned" integer NOT NULL,
	"published" integer NOT NULL,
	"failed" integer NOT NULL,
	"pending" integer NOT NULL,
	"clients_planned" integer DEFAULT 0 NOT NULL,
	"clients_compliant" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverable_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"effective_date" date NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_salary_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"salary" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'NIO' NOT NULL,
	"effective_date" date NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_positive_ck" CHECK ("employee_salary_history"."salary" >= 0)
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"phone" text,
	"email" text,
	"position" text,
	"department_key" text,
	"hire_date" date,
	"start_date" date NOT NULL,
	"pay_frequency" text DEFAULT 'quincenal' NOT NULL,
	"contract_type" text DEFAULT 'indeterminado' NOT NULL,
	"work_schedule" text,
	"status" text DEFAULT 'activo' NOT NULL,
	"manager_id" uuid,
	"termination_date" date,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_status_ck" CHECK ("employees"."status" in ('activo','suspendido','baja')),
	CONSTRAINT "employees_pay_freq_ck" CHECK ("employees"."pay_frequency" in ('quincenal','mensual'))
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'operativo' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "expense_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_at" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"receipt_asset_id" uuid,
	"notes" text,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_payments_amount_ck" CHECK ("expense_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"supplier" text,
	"description" text,
	"amount" numeric(14, 2) NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'NIO' NOT NULL,
	"registered_at" date NOT NULL,
	"due_date" date,
	"accounting_date" date NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"payment_method" text,
	"receipt_asset_id" uuid,
	"client_id" uuid,
	"department" text,
	"notes" text,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"recurring_id" uuid,
	"source_key" text,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_status_ck" CHECK ("expenses"."status" in ('pendiente','parcial','pagado','anulado')),
	CONSTRAINT "expenses_amount_ck" CHECK ("expenses"."amount" > 0 and "expenses"."paid_amount" >= 0 and "expenses"."paid_amount" <= "expenses"."amount")
);
--> statement-breakpoint
CREATE TABLE "file_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"client_id" uuid,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_assets_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'NIO' NOT NULL,
	"paid_at" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"receipt_asset_id" uuid,
	"notes" text,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payments_amount_ck" CHECK ("invoice_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"client_id" uuid NOT NULL,
	"contract_id" uuid,
	"period" date,
	"concept" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'NIO' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"source_key" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_status_ck" CHECK ("invoices"."status" in ('pendiente','parcial','pagada','anulada')),
	CONSTRAINT "invoices_amount_ck" CHECK ("invoices"."amount" > 0 and "invoices"."paid_amount" >= 0 and "invoices"."paid_amount" <= "invoices"."amount"),
	CONSTRAINT "invoices_void_ck" CHECK ("invoices"."status" <> 'anulada' or ("invoices"."void_reason" is not null and "invoices"."voided_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "labor_benefit_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"benefit" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"days" numeric(8, 2),
	"currency" text DEFAULT 'NIO' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labor_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"country" text DEFAULT 'NI' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"params" jsonb NOT NULL,
	"sources" text NOT NULL,
	"validated" boolean DEFAULT false NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labor_rule_sets_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "lead_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"called_at" timestamp with time zone NOT NULL,
	"channel" text DEFAULT 'llamada' NOT NULL,
	"agent_id" uuid,
	"result" text NOT NULL,
	"answered_by" text,
	"response" text,
	"interest_level" text,
	"objections" text,
	"notes" text,
	"next_action" text,
	"next_followup_at" date,
	"status_after" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"phone_digits" text,
	"email" text,
	"country" text DEFAULT 'Nicaragua' NOT NULL,
	"city" text,
	"address" text,
	"business_type" text,
	"social_links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"website" text,
	"source" text,
	"owner_id" uuid,
	"status" text DEFAULT 'pendiente_contactar' NOT NULL,
	"last_contact_at" timestamp with time zone,
	"next_followup_at" date,
	"next_action" text,
	"notes" text,
	"lost_reason" text,
	"client_id" uuid,
	"converted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"reason" text NOT NULL,
	"authorized_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_content_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"contract_id" uuid,
	"period" date NOT NULL,
	"strategist_id" uuid,
	"due_date" date,
	"objectives" text,
	"target_audience" text,
	"pillars" text,
	"campaigns" text,
	"themes" text,
	"creative_concepts" text,
	"visual_references" text,
	"ctas" text,
	"notes" text,
	"status" text DEFAULT 'pendiente_planificacion' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"duplicated_from_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_period_first_day_ck" CHECK (extract(day from "monthly_content_plans"."period") = 1),
	CONSTRAINT "plans_status_ck" CHECK ("monthly_content_plans"."status" in ('pendiente_planificacion','en_planificacion','revision_interna','pendiente_aprobacion_cliente','cambios_solicitados','aprobada','en_produccion','completada'))
);
--> statement-breakpoint
CREATE TABLE "notification_rules" (
	"role_id" uuid NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_rules_role_id_type_pk" PRIMARY KEY("role_id","type")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"entity_type" text,
	"entity_id" uuid,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"concept" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"authorized_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_date" date NOT NULL,
	"frequency" text DEFAULT 'quincenal' NOT NULL,
	"status" text DEFAULT 'borrador' NOT NULL,
	"rule_set_id" uuid,
	"is_estimate" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_status_ck" CHECK ("payroll_periods"."status" in ('borrador','aprobada','contabilizada','pagada'))
);
--> statement-breakpoint
CREATE TABLE "payroll_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"base_salary" numeric(14, 2) NOT NULL,
	"gross_salary" numeric(14, 2) NOT NULL,
	"other_earnings" numeric(14, 2) DEFAULT 0 NOT NULL,
	"inss_employee" numeric(14, 2) DEFAULT 0 NOT NULL,
	"income_tax" numeric(14, 2) DEFAULT 0 NOT NULL,
	"other_deductions" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total_deductions" numeric(14, 2) DEFAULT 0 NOT NULL,
	"net_salary" numeric(14, 2) NOT NULL,
	"inss_employer" numeric(14, 2) DEFAULT 0 NOT NULL,
	"inatec" numeric(14, 2) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'NIO' NOT NULL,
	"worked_days" integer NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pay_status" text DEFAULT 'pendiente' NOT NULL,
	"paid_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"contract_id" uuid,
	"period" date NOT NULL,
	"designer_id" uuid,
	"editor_id" uuid,
	"due_date" date,
	"notes" text,
	"ready_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_period_first_day_ck" CHECK (extract(day from "production_boards"."period") = 1)
);
--> statement-breakpoint
CREATE TABLE "production_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"platform" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"script_ref" text,
	"counts_toward_progress" boolean DEFAULT true NOT NULL,
	"assignee_id" uuid,
	"due_date" date,
	"status" text NOT NULL,
	"final_file_url" text,
	"final_file_asset_id" uuid,
	"notes" text,
	"plan_item_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliverables_kind_ck" CHECK ("production_deliverables"."kind" in ('diseno','perfil','portada','reel')),
	CONSTRAINT "deliverables_status_ck" CHECK (("production_deliverables"."kind" = 'reel' and "production_deliverables"."status" in ('pendiente_material','material_recibido','en_edicion','revision_interna','pendiente_cambios','aprobado','editado'))
       or ("production_deliverables"."kind" <> 'reel' and "production_deliverables"."status" in ('pendiente','en_diseno','revision_interna','pendiente_cambios','aprobado','finalizado'))),
	CONSTRAINT "deliverables_final_file_ck" CHECK ("production_deliverables"."status" not in ('finalizado','editado') or "production_deliverables"."final_file_url" is not null or "production_deliverables"."final_file_asset_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"network" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"scheduled_time" time,
	"content_title" text NOT NULL,
	"caption" text,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"responsible_id" uuid,
	"evidence_url" text,
	"notes" text,
	"published_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"verification" text,
	"rescheduled_from_id" uuid,
	"rescheduled_to_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_status_ck" CHECK ("publications"."status" in ('pendiente','lista_programar','programada','publicada','fallida','reprogramada','no_aplica')),
	CONSTRAINT "publications_confirmed_ck" CHECK ("publications"."status" <> 'publicada' or ("publications"."confirmed_by" is not null and "publications"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"supplier" text,
	"description" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'NIO' NOT NULL,
	"day_of_month" integer DEFAULT 1 NOT NULL,
	"interval_months" integer DEFAULT 1 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'activa' NOT NULL,
	"payment_method" text,
	"client_id" uuid,
	"department" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_status_ck" CHECK ("recurring_expenses"."status" in ('activa','pausada','cancelada')),
	CONSTRAINT "recurring_day_ck" CHECK ("recurring_expenses"."day_of_month" between 1 and 28),
	CONSTRAINT "recurring_amount_ck" CHECK ("recurring_expenses"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sales_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"title" text NOT NULL,
	"package_id" uuid,
	"monthly_price" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'NIO' NOT NULL,
	"sent_at" date,
	"status" text DEFAULT 'borrador' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"monthly_price" numeric(14, 2),
	"currency" text DEFAULT 'NIO' NOT NULL,
	"sessions_enabled" boolean DEFAULT true NOT NULL,
	"session_frequency_months" integer DEFAULT 1 NOT NULL,
	"designs_per_month" integer DEFAULT 6 NOT NULL,
	"reels_per_month" integer DEFAULT 6 NOT NULL,
	"include_profile_photo" boolean DEFAULT true NOT NULL,
	"include_cover" boolean DEFAULT true NOT NULL,
	"include_strategy" boolean DEFAULT true NOT NULL,
	"include_community" boolean DEFAULT true NOT NULL,
	"social_networks" text[] DEFAULT '{facebook,instagram}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_packages_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"network" text NOT NULL,
	"handle" text,
	"url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"department" text,
	"assignee_id" uuid,
	"due_date" date,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"dedupe_key" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status_ck" CHECK ("tasks"."status" in ('pendiente','en_progreso','completada','cancelada'))
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"employee_id" uuid,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"status" text DEFAULT 'solicitada' NOT NULL,
	"reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vacation_status_ck" CHECK ("vacation_requests"."status" in ('solicitada','aprobada','rechazada','cancelada')),
	CONSTRAINT "vacation_days_ck" CHECK ("vacation_requests"."days" > 0 and "vacation_requests"."end_date" >= "vacation_requests"."start_date")
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_package_id_service_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."service_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_offboarding_records" ADD CONSTRAINT "client_offboarding_records_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_offboarding_records" ADD CONSTRAINT "client_offboarding_records_responsible_id_employees_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_status_history" ADD CONSTRAINT "client_status_history_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_workspaces" ADD CONSTRAINT "client_workspaces_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_account_manager_id_employees_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_community_manager_id_employees_id_fk" FOREIGN KEY ("community_manager_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_plan_id_monthly_content_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."monthly_content_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_responsible_id_employees_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_session_events" ADD CONSTRAINT "content_session_events_session_id_content_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."content_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_sessions" ADD CONSTRAINT "content_sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_sessions" ADD CONSTRAINT "content_sessions_contract_id_client_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."client_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_sessions" ADD CONSTRAINT "content_sessions_responsible_id_employees_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_deliverable_id_production_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."production_deliverables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_changes" ADD CONSTRAINT "employee_changes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salary_history" ADD CONSTRAINT "employee_salary_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_key_departments_key_fk" FOREIGN KEY ("department_key") REFERENCES "public"."departments"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_client_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."client_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_benefit_accruals" ADD CONSTRAINT "labor_benefit_accruals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_benefit_accruals" ADD CONSTRAINT "labor_benefit_accruals_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_calls" ADD CONSTRAINT "lead_calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_calls" ADD CONSTRAINT "lead_calls_agent_id_employees_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_employees_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_content_plans" ADD CONSTRAINT "monthly_content_plans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_content_plans" ADD CONSTRAINT "monthly_content_plans_contract_id_client_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."client_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_content_plans" ADD CONSTRAINT "monthly_content_plans_strategist_id_employees_id_fk" FOREIGN KEY ("strategist_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_rule_set_id_labor_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."labor_rule_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_boards" ADD CONSTRAINT "production_boards_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_boards" ADD CONSTRAINT "production_boards_contract_id_client_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."client_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_boards" ADD CONSTRAINT "production_boards_designer_id_employees_id_fk" FOREIGN KEY ("designer_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_boards" ADD CONSTRAINT "production_boards_editor_id_employees_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_deliverables" ADD CONSTRAINT "production_deliverables_board_id_production_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."production_boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_deliverables" ADD CONSTRAINT "production_deliverables_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_deliverables" ADD CONSTRAINT "production_deliverables_assignee_id_employees_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_deliverable_id_production_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."production_deliverables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_responsible_id_employees_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_proposals" ADD CONSTRAINT "sales_proposals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_proposals" ADD CONSTRAINT "sales_proposals_package_id_service_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."service_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_employees_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_requests" ADD CONSTRAINT "vacation_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_action_logs_user_idx" ON "ai_action_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_messages_conv_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_client_idx" ON "audit_logs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_run_key_uq" ON "automation_runs" USING btree ("run_key");--> statement-breakpoint
CREATE INDEX "automation_runs_job_idx" ON "automation_runs" USING btree ("job_key");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_uq" ON "budgets" USING btree ("category_id","period","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_one_active_uq" ON "client_contracts" USING btree ("client_id") WHERE "client_contracts"."status" = 'vigente';--> statement-breakpoint
CREATE INDEX "client_status_history_client_idx" ON "client_status_history" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_name_city_uq" ON "clients" USING btree ("normalized_name",coalesce(lower("city"), ''));--> statement-breakpoint
CREATE UNIQUE INDEX "clients_tax_id_uq" ON "clients" USING btree ("tax_id") WHERE "clients"."tax_id" is not null;--> statement-breakpoint
CREATE INDEX "clients_status_idx" ON "clients" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_items_uq" ON "content_plan_items" USING btree ("plan_id","kind","position");--> statement-breakpoint
CREATE INDEX "content_session_events_session_idx" ON "content_session_events" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_sessions_generation_uq" ON "content_sessions" USING btree ("generation_key");--> statement-breakpoint
CREATE INDEX "content_sessions_client_idx" ON "content_sessions" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_pub_snap_uq" ON "daily_publication_snapshots" USING btree ("day","scope");--> statement-breakpoint
CREATE INDEX "deliverable_events_deliverable_idx" ON "deliverable_events" USING btree ("deliverable_id");--> statement-breakpoint
CREATE INDEX "employee_changes_emp_idx" ON "employee_changes" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_history_emp_date_uq" ON "employee_salary_history" USING btree ("employee_id","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_email_uq" ON "employees" USING btree (lower("email")) WHERE "employees"."email" is not null;--> statement-breakpoint
CREATE INDEX "employees_normalized_name_idx" ON "employees" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "expense_payments_expense_idx" ON "expense_payments" USING btree ("expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_payments_idem_uq" ON "expense_payments" USING btree ("idempotency_key") WHERE "expense_payments"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_source_uq" ON "expenses" USING btree ("source_key") WHERE "expenses"."source_key" is not null;--> statement-breakpoint
CREATE INDEX "expenses_accounting_idx" ON "expenses" USING btree ("accounting_date");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_idem_uq" ON "invoice_payments" USING btree ("idempotency_key") WHERE "invoice_payments"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_source_uq" ON "invoices" USING btree ("source_key") WHERE "invoices"."source_key" is not null;--> statement-breakpoint
CREATE INDEX "invoices_client_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "benefit_accruals_uq" ON "labor_benefit_accruals" USING btree ("employee_id","period_id","benefit");--> statement-breakpoint
CREATE INDEX "lead_calls_lead_idx" ON "lead_calls" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_normalized_name_idx" ON "leads" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone_digits");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_client_period_uq" ON "monthly_content_plans" USING btree ("client_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_uq" ON "payroll_periods" USING btree ("period_start","period_end","frequency");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_records_uq" ON "payroll_records" USING btree ("period_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boards_client_period_uq" ON "production_boards" USING btree ("client_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "deliverables_uq" ON "production_deliverables" USING btree ("board_id","kind","position","platform");--> statement-breakpoint
CREATE INDEX "deliverables_assignee_idx" ON "production_deliverables" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "publications_date_idx" ON "publications" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "publications_client_idx" ON "publications" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_deliverable_network_uq" ON "publications" USING btree ("deliverable_id","network") WHERE "publications"."deliverable_id" is not null and "publications"."status" not in ('reprogramada','no_aplica');--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_client_network_uq" ON "social_accounts" USING btree ("client_id","network");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_dedupe_uq" ON "tasks" USING btree ("dedupe_key") WHERE "tasks"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_client_idx" ON "tasks" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_employee_uq" ON "users" USING btree ("employee_id") WHERE "users"."employee_id" is not null;