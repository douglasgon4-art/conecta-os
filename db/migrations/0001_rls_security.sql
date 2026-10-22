-- ═══════════════════════════════════════════════════════════════════════════
-- Seguridad a nivel de base de datos (defensa en profundidad)
--
-- El servidor fija, en cada transacción (set_config(..., true)):
--   app.user_id  → usuario autenticado
--   app.perms    → lista de permisos efectivos separada por comas
--   app.system   → 'on' solo para automatizaciones u orquestaciones internas auditadas
-- Sin contexto, ninguna fila es visible ni modificable.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_system() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.system', true), '') = 'on' $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.in_ctx() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT app.is_system() OR app.user_id() IS NOT NULL $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.has_perm(p text) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT app.is_system()
       OR (app.user_id() IS NOT NULL
           AND p = ANY (string_to_array(coalesce(current_setting('app.perms', true), ''), ','))) $$;
--> statement-breakpoint

-- ─── Privilegios del rol de aplicación ───
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conecta_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public, app TO conecta_app';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO conecta_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO conecta_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO conecta_app';
    -- DELETE solo donde borrar no destruye historial operativo o financiero.
    EXECUTE 'GRANT DELETE ON sessions, notifications, user_roles, role_permissions, notification_rules,
             client_contacts, budgets, payroll_adjustments, ai_conversations, ai_messages TO conecta_app';
    -- Tablas de solo inserción (historial inmutable).
    EXECUTE 'REVOKE UPDATE ON audit_logs, client_status_history, deliverable_events, content_session_events,
             employee_changes, daily_publication_snapshots, invoice_payments, expense_payments,
             employee_salary_history FROM conecta_app';
  END IF;
END $$;
--> statement-breakpoint

-- ─── Activar y forzar RLS en todas las tablas ───
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
--> statement-breakpoint

-- ─── Política general: cualquier contexto autenticado (la autorización fina vive en los servicios) ───
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'departments','employees','users','sessions','roles','permissions','role_permissions','user_roles',
    'app_settings','employee_changes','clients','client_contacts','service_packages','client_contracts',
    'client_workspaces','client_status_history','client_offboarding_records','social_accounts','leads',
    'lead_calls','sales_proposals','tasks','content_sessions','content_session_events','monthly_content_plans',
    'content_plan_items','production_boards','production_deliverables','deliverable_events','publications',
    'daily_publication_snapshots','expense_categories','labor_rule_sets','vacation_requests','leave_adjustments',
    'file_assets','notification_rules','automation_runs'
  ] LOOP
    EXECUTE format('CREATE POLICY ctx_all ON public.%I FOR ALL USING (app.in_ctx()) WITH CHECK (app.in_ctx())', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ─── Salarios: solo con permiso employees.salary ───
CREATE POLICY salary_read ON employee_salary_history FOR SELECT USING (app.has_perm('employees.salary'));
--> statement-breakpoint
CREATE POLICY salary_write ON employee_salary_history FOR INSERT WITH CHECK (app.has_perm('employees.salary'));
--> statement-breakpoint

-- ─── Nómina y prestaciones ───
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_periods','payroll_records','payroll_adjustments','labor_benefit_accruals'] LOOP
    EXECUTE format('CREATE POLICY payroll_read ON public.%I FOR SELECT USING (app.has_perm(''payroll.read''))', t);
    EXECUTE format('CREATE POLICY payroll_ins ON public.%I FOR INSERT WITH CHECK (app.has_perm(''payroll.write''))', t);
    EXECUTE format('CREATE POLICY payroll_upd ON public.%I FOR UPDATE USING (app.has_perm(''payroll.write'')) WITH CHECK (app.has_perm(''payroll.write''))', t);
    EXECUTE format('CREATE POLICY payroll_del ON public.%I FOR DELETE USING (app.has_perm(''payroll.write''))', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ─── Facturación y cobros ───
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','invoice_payments'] LOOP
    EXECUTE format('CREATE POLICY fin_read ON public.%I FOR SELECT USING (app.has_perm(''finance.read''))', t);
    EXECUTE format('CREATE POLICY fin_ins ON public.%I FOR INSERT WITH CHECK (app.has_perm(''invoices.write'') OR app.has_perm(''invoices.pay''))', t);
    EXECUTE format('CREATE POLICY fin_upd ON public.%I FOR UPDATE USING (app.has_perm(''invoices.write'') OR app.has_perm(''invoices.pay'') OR app.has_perm(''invoices.void'')) WITH CHECK (true)', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ─── Gastos ───
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses','expense_payments','recurring_expenses','budgets'] LOOP
    EXECUTE format('CREATE POLICY exp_read ON public.%I FOR SELECT USING (app.has_perm(''expenses.read''))', t);
    EXECUTE format('CREATE POLICY exp_ins ON public.%I FOR INSERT WITH CHECK (app.has_perm(''expenses.write'') OR app.has_perm(''expenses.pay''))', t);
    EXECUTE format('CREATE POLICY exp_upd ON public.%I FOR UPDATE USING (app.has_perm(''expenses.write'') OR app.has_perm(''expenses.pay'')) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY exp_del ON public.%I FOR DELETE USING (app.has_perm(''expenses.write''))', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ─── Auditoría: cualquiera registra, solo auditores consultan ───
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (app.in_ctx());
--> statement-breakpoint
CREATE POLICY audit_read ON audit_logs FOR SELECT USING (app.has_perm('audit.read'));
--> statement-breakpoint

-- ─── Notificaciones: cada usuario ve las suyas ───
CREATE POLICY notif_insert ON notifications FOR INSERT WITH CHECK (app.in_ctx());
--> statement-breakpoint
CREATE POLICY notif_own ON notifications FOR SELECT USING (app.is_system() OR user_id = app.user_id());
--> statement-breakpoint
CREATE POLICY notif_upd ON notifications FOR UPDATE USING (app.is_system() OR user_id = app.user_id()) WITH CHECK (app.is_system() OR user_id = app.user_id());
--> statement-breakpoint
CREATE POLICY notif_del ON notifications FOR DELETE USING (app.is_system() OR user_id = app.user_id());
--> statement-breakpoint

-- ─── Conversaciones del agente: privadas por usuario ───
CREATE POLICY ai_conv_own ON ai_conversations FOR ALL
  USING (app.is_system() OR user_id = app.user_id()) WITH CHECK (app.is_system() OR user_id = app.user_id());
--> statement-breakpoint
CREATE POLICY ai_msg_own ON ai_messages FOR ALL
  USING (app.is_system() OR EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id AND c.user_id = app.user_id()))
  WITH CHECK (app.is_system() OR EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id AND c.user_id = app.user_id()));
--> statement-breakpoint
CREATE POLICY ai_log_own ON ai_action_logs FOR SELECT USING (app.is_system() OR user_id = app.user_id() OR app.has_perm('audit.read'));
--> statement-breakpoint
CREATE POLICY ai_log_ins ON ai_action_logs FOR INSERT WITH CHECK (app.is_system() OR user_id = app.user_id());
--> statement-breakpoint
CREATE POLICY ai_log_upd ON ai_action_logs FOR UPDATE USING (app.is_system() OR user_id = app.user_id()) WITH CHECK (app.is_system() OR user_id = app.user_id());
--> statement-breakpoint

-- ─── Nóminas cerradas: los importes no pueden modificarse ───
CREATE OR REPLACE FUNCTION app.guard_closed_payroll() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM payroll_periods WHERE id = coalesce(NEW.period_id, OLD.period_id);
  IF st IN ('aprobada','contabilizada','pagada') THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'La nómina % está cerrada y no admite cambios', st USING ERRCODE = 'P0001';
    END IF;
    IF NEW.gross_salary IS DISTINCT FROM OLD.gross_salary OR NEW.net_salary IS DISTINCT FROM OLD.net_salary
       OR NEW.total_deductions IS DISTINCT FROM OLD.total_deductions OR NEW.inss_employer IS DISTINCT FROM OLD.inss_employer THEN
      RAISE EXCEPTION 'La nómina % está cerrada: los importes no pueden modificarse', st USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER payroll_records_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_records
  FOR EACH ROW EXECUTE FUNCTION app.guard_closed_payroll();
--> statement-breakpoint

-- ─── Mantener updated_at ───
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
--> statement-breakpoint
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'updated_at' LOOP
    EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t.table_name);
  END LOOP;
END $$;
--> statement-breakpoint

-- ─── Numeración de facturas ───
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conecta_app') THEN
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON SEQUENCE invoice_number_seq TO conecta_app';
  END IF;
END $$;
