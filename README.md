# CONECTA OS

Sistema operativo integral de la agencia de marketing digital **CONECTA**: clientes, ventas, agenda de sesiones,
estrategia, producción mensual (Diseño y Video), Community Management, colaboradores, nómina (Nicaragua), gastos,
facturación y cobros, informes, automatizaciones y un asistente de IA que ejecuta acciones reales.

> Regla principal: **registrar una sola vez, conectar automáticamente todos los módulos, mantener la información
> actualizada y conservar el historial.**

## Tecnologías

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · componentes propios estilo shadcn/ui
- PostgreSQL 16 · Drizzle ORM · **Row Level Security** forzado en todas las tablas
- Zod 4 (validación en el servidor, mensajes en español) · bcrypt · sesiones con cookie httpOnly
- Anthropic Claude (`@anthropic-ai/sdk`) para el asistente (configurable)
- Vitest (integración contra PostgreSQL real) · Playwright (E2E)

Más detalle en [`docs/PLAN.md`](docs/PLAN.md) (arquitectura) y [`docs/FASES.md`](docs/FASES.md) (qué se hizo en cada fase,
pruebas y pendientes).

## Puesta en marcha local

Requisitos: Node 20+ y PostgreSQL 14+.

```bash
# 1. Roles y bases de datos (como superusuario de PostgreSQL)
psql -c "CREATE ROLE conecta_owner LOGIN PASSWORD 'conecta_owner' CREATEDB;"
psql -c "CREATE ROLE conecta_app LOGIN PASSWORD 'conecta_app' NOSUPERUSER NOBYPASSRLS;"
psql -c "CREATE DATABASE conecta OWNER conecta_owner;"
psql -c "CREATE DATABASE conecta_test OWNER conecta_owner;"   # pruebas de integración
psql -c "CREATE DATABASE conecta_e2e OWNER conecta_owner;"    # pruebas E2E

# 2. Dependencias y configuración
npm install
cp .env.example .env        # ajusta CRON_SECRET, ANTHROPIC_API_KEY, etc.

# 3. Esquema, políticas RLS y datos de referencia (roles, permisos, categorías, paquete estándar, reglas laborales)
npm run db:migrate
npm run db:seed             # crea el usuario inicial de Gerencia (ver consola) — cambia la contraseña al entrar

# 4. Ejecutar
npm run dev                 # http://localhost:3000
```

El seed **no crea clientes ni operaciones ficticias**; solo catálogos y el usuario inicial
(`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, por defecto `gerencia@conecta.local` / `Conecta2026!`).

### Dos conexiones a la base de datos

| Variable | Rol | Uso |
|---|---|---|
| `DATABASE_URL` | `conecta_app` (sin `BYPASSRLS`, sin `DELETE` en tablas históricas) | La aplicación |
| `DATABASE_OWNER_URL` | `conecta_owner` | Solo migraciones y seed |

### Usar Supabase

El esquema es PostgreSQL estándar y funciona en Supabase sin cambios:

1. Crea los roles `conecta_owner` y `conecta_app` en el SQL Editor (como arriba) y concede `conecta_app` al
   propietario si hace falta.
2. Apunta `DATABASE_OWNER_URL` y `DATABASE_URL` a la cadena de conexión de Supabase con cada rol (puerto 5432 o pooler
   en modo sesión, porque el contexto de seguridad se fija por transacción).
3. `npm run db:migrate && npm run db:seed`.

La autenticación es propia (no usa Supabase Auth). Para los archivos se puede sustituir el almacenamiento local por
Supabase Storage o S3 implementando la interfaz `FileStorage` (`src/server/files/storage.ts`).

## Automatizaciones (cron)

Los trabajos diarios (ciclos mensuales, gastos recurrentes, alertas de sesiones, producción, planificaciones, finanzas,
tareas, nómina y cierre diario de publicaciones) **no dependen de que alguien abra una pantalla**. Programa una de estas
opciones:

- **Vercel Cron**: `vercel.json` ya incluye una ejecución diaria a las 6:00 a. m. de Managua. Define `CRON_SECRET` en
  el proyecto (Vercel lo envía como `Authorization: Bearer`).
- **crontab** en un servidor propio:
  ```cron
  0 12 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron
  ```
- **Script**: `npm run cron` (opciones `-- --force`, `-- --job=session_alerts`).

Cada ejecución queda en *Configuración → Automatizaciones* con intentos, estadísticas y errores. Si un trabajo falla, se
notifica a Gerencia y se puede reintentar sin duplicar nada (restricciones de unicidad + `ON CONFLICT DO NOTHING`).

## Asistente de IA

Configura `ANTHROPIC_API_KEY` (y opcionalmente `AI_MODEL`, por defecto `claude-opus-5-5`). La clave solo vive en el
servidor. Sin clave, el asistente muestra que está **pendiente de configuración** y no simula ninguna acción.

El agente usa herramientas tipadas que llaman a los mismos servicios que la interfaz (validación, permisos, auditoría).
No tiene acceso libre a la base de datos ni ejecuta SQL. Las acciones sensibles (archivar, pagos, salarios, conversión
de ventas, acciones masivas, bajas) quedan **pendientes de confirmación** hasta que el usuario pulsa *Confirmar*; en ese
momento se ejecuta exactamente lo propuesto y se registra en `ai_action_logs` y en la auditoría.

## Reglas laborales de Nicaragua

Las tasas (INSS laboral y patronal, INATEC, tabla de IR), el aguinaldo y las vacaciones están en
`labor_rule_sets`, **versionadas por fecha de vigencia**. Se sembraron valores de referencia tomados de fuentes
secundarias y marcados como **pendientes de validación**: mientras no se validen contra La Gaceta, INSS, DGI y MITRAB
(*Configuración → Reglas laborales*), las nóminas son **estimaciones** y el sistema no permite aprobarlas como
definitivas.

## Pruebas

```bash
npm test            # 62 pruebas de integración (Vitest) contra la base conecta_test (se reinicia sola)
npm run build && npm run test:e2e   # 7 pruebas E2E (Playwright) contra conecta_e2e
npm run typecheck
```

## Estructura

```
db/migrations/           SQL versionado (esquema + RLS, privilegios, disparadores)
scripts/                 migrate, seed, reset-db, run-automations
src/server/db/           esquema Drizzle y conexión
src/server/ctx.ts        contexto transaccional con RLS, permisos y auditoría
src/server/auth/         sesiones, permisos y roles sembrados, límite de intentos
src/server/services/     lógica de negocio (única puerta de escritura)
src/server/automations/  trabajos programados idempotentes
src/server/agent/        proveedor de IA, herramientas y ejecución con confirmaciones
src/app/(app)/           pantallas y Server Actions por módulo
src/components/          UI reutilizable y formularios
tests/  e2e/             pruebas de integración y de extremo a extremo
```
