# CONECTA OS — Plan técnico de implementación

## 0. Diagnóstico del repositorio

- El directorio de trabajo estaba **vacío**: no había código, framework, base de datos, autenticación, componentes
  ni automatizaciones previas. No hay repositorios de GitHub conectados a la sesión.
- Por lo tanto, no hay código funcional que conservar ni aplicaciones paralelas que evitar: CONECTA OS se construye
  desde cero en `conecta-os/`.
- Entorno disponible: Node 22, PostgreSQL 16 local y Chromium (Playwright). No hay Docker, así que no se puede levantar
  Supabase local.

## 1. Arquitectura

| Capa | Tecnología | Ubicación |
|---|---|---|
| Interfaz | Next.js 16 (App Router), React 19, Tailwind 4, componentes propios estilo shadcn/ui | `src/app`, `src/components` |
| Lógica de negocio | Servicios TypeScript puros que reciben un `Ctx` (usuario + transacción) | `src/server/services` |
| Acceso a datos | Drizzle ORM + `pg` sobre PostgreSQL | `src/server/db` |
| Autorización | Permisos por rol en BD, verificación en cada servicio y RLS en PostgreSQL | `src/server/auth`, `db/migrations` |
| Automatizaciones | Jobs idempotentes con registro en `automation_runs`, que se ejecutan por cron (endpoint protegido o script) | `src/server/automations` |
| Notificaciones | Tabla `notifications` con `dedupe_key` única y reglas por rol | `src/server/services/notifications.ts` |
| IA | Agente con herramientas tipadas que llaman a los mismos servicios; proveedor configurable por variables de entorno | `src/server/agent` |
| Archivos | Almacenamiento local privado con descarga autorizada, o enlaces externos (Drive, etc.) | `src/server/files` |

**Decisiones clave**

1. **PostgreSQL estándar en lugar de un SDK propietario.** Sin credenciales de Supabase ni Docker, el sistema se construye
   sobre PostgreSQL puro. Es 100 % compatible con el Postgres de Supabase: basta con apuntar `DATABASE_URL` al proyecto.
   La autenticación es propia (sesiones con cookie httpOnly y token hasheado) para no depender de un servicio externo.
2. **Una sola fuente de verdad por entidad.** Todos los módulos consultan `clients.status`. No hay copias del estado.
3. **Servicios como única puerta de escritura.** La UI (Server Actions), el agente de IA y las automatizaciones usan las
   mismas funciones, con las mismas validaciones (Zod), los mismos permisos y la misma auditoría.
4. **Transacciones** en toda operación que toque varios módulos: alta de cliente, conversión de venta, baja,
   contabilización de nómina, etc.
5. **Idempotencia por restricciones únicas** (`UNIQUE` + `ON CONFLICT DO NOTHING`): un tablero por cliente y período, una
   planificación por cliente y mes, una factura por contrato y período, un gasto por recurrencia y período, una
   contabilización por nómina, una notificación por `dedupe_key`.
6. **RLS como defensa en profundidad.** Todas las tablas tienen RLS forzado. El servidor fija `app.user_id`, `app.perms` y
   `app.system` en cada transacción (`set_config(..., true)`). Las tablas sensibles (salarios, nómina, finanzas, gastos,
   auditoría) exigen el permiso correspondiente también a nivel de base de datos. La app se conecta con un rol sin
   `BYPASSRLS`.
7. **Zona horaria:** `America/Managua` (configurable). **Monedas:** NIO (C$) y USD, con tipo de cambio configurable para
   los totales equivalentes.

## 2. Módulos

Gerencia (dashboard), Clientes (ficha central + pestañas), Ventas, Agenda de sesiones, Estrategia y campañas,
Producción mensual (Diseño / Video), Community Management, Tareas, Colaboradores, Nómina y prestaciones, Gastos del mes,
Finanzas (facturas, cobros, rentabilidad), Informes, Asistente de CONECTA (IA), Notificaciones y Configuración
(roles, permisos, reglas laborales, ajustes, automatizaciones y auditoría).

## 3. Modelo de datos (resumen)

- **Organización:** `users`, `sessions`, `roles`, `permissions`, `role_permissions`, `user_roles`, `departments`, `app_settings`.
- **Personal:** `employees`, `employee_salary_history`, `employee_changes`, `vacation_requests`, `leave_adjustments`,
  `labor_rule_sets` (versionadas por vigencia), `payroll_periods`, `payroll_records`, `payroll_adjustments`,
  `labor_benefit_accruals`.
- **Clientes:** `clients`, `client_contacts`, `service_packages` (plantillas), `client_contracts` (paquete efectivo por
  cliente), `client_workspaces` (módulos inicializados), `client_status_history`, `client_offboarding_records`,
  `social_accounts`.
- **Ventas:** `leads`, `lead_calls`, `sales_proposals`.
- **Agenda:** `content_sessions` (fechas prevista, propuesta, confirmada y realizada por separado), `content_session_events`.
- **Estrategia:** `monthly_content_plans` (única por cliente y mes), `content_plan_items` (reels y diseños).
- **Producción:** `production_boards` (único por cliente y período), `production_deliverables` (con un `CHECK` que impide
  completar sin archivo final), `deliverable_events`.
- **Community:** `publications`, `daily_publication_snapshots` (cierre diario inmutable).
- **Tareas:** `tasks` (con `dedupe_key` para las tareas generadas).
- **Finanzas:** `invoices` (cuenta por cobrar), `invoice_payments`, `expense_categories`, `expenses`, `expense_payments`,
  `recurring_expenses`, `budgets`.
- **Sistema:** `notifications`, `notification_rules`, `automation_runs`, `audit_logs`, `ai_conversations`, `ai_messages`,
  `ai_action_logs`, `file_assets`.

## 4. Roles y permisos

Roles sembrados y configurables: Gerencia, Administración, Ventas, Estrategia, Diseñador, Editor de video,
Community Manager y Contabilidad. Los permisos son granulares (`clients.write`, `production.update_own`,
`payroll.approve`, `invoices.void`, etc.). Los permisos `*_own` limitan la escritura a los registros asignados al
colaborador vinculado con el usuario.

## 5. Automatizaciones (cron diario + bajo demanda)

`monthly_cycles` (planificaciones, tableros, facturas y transiciones de baja), `recurring_expenses`, `session_alerts`,
`production_alerts`, `strategy_alerts`, `publication_day_close`, `finance_alerts`, `task_alerts` y `payroll_alerts`.
Cada ejecución se registra con su clave de corrida, intentos, estadísticas y error, y se puede reintentar de forma segura.

## 6. Migraciones

SQL versionado en `db/migrations/*.sql`, aplicado por `scripts/migrate.ts` con una tabla `schema_migrations`. El esquema
de Drizzle (`src/server/db/schema.ts`) es el reflejo tipado de esas migraciones.

## 7. Etapas

1. Fundación: esquema, autenticación, roles, RLS, clientes y colaboradores.
2. Ventas y conversión, inicialización automática de espacios, agenda y estrategia.
3. Producción mensual y Community Management.
4. Gastos, facturación y cobros, nómina, aguinaldo y vacaciones.
5. Automatizaciones, notificaciones y agente de IA.
6. Consolidación: E2E, permisos y documentación.

## 8. Pruebas

- **Integración (Vitest)** contra una base PostgreSQL real (`conecta_test`): cada flujo de la Parte 22, incluidos
  duplicados, permisos, idempotencia y RLS.
- **Agente:** proveedor de IA simulado y determinista que emite llamadas a herramientas, para probar el ciclo completo
  sin red.
- **E2E (Playwright):** inicio de sesión, alta de cliente con espacios generados y tablero de producción.

## 9. Riesgos y dependencias

- **Reglas laborales y tributarias:** se cargan como conjunto versionado *pendiente de validación*, con las fuentes
  citadas. Mientras no se validen, la nómina se marca como **estimación** y no puede aprobarse como definitiva.
- **Integraciones con redes sociales:** no hay credenciales, así que la confirmación de publicaciones es manual y queda
  trazada (quién y cuándo). El modelo admite `verification = 'api'` para una integración futura.
- **Proveedor de IA:** requiere `ANTHROPIC_API_KEY`. Sin ella, el asistente indica que está pendiente de configuración.
- **Persistencia del código:** el contenedor es efímero; hace falta conectar un repositorio de GitHub para conservar el
  trabajo.
- **Almacenamiento de archivos:** es local en desarrollo. En producción conviene usar S3 o Supabase Storage (la interfaz
  `FileStorage` está aislada).
