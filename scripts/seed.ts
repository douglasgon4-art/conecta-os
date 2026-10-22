import "./load-env";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { PERMISSIONS, SEED_ROLES } from "../src/server/auth/permissions";
import { NOTIFICATION_TYPES } from "../src/server/services/notification-types";
import { DEPARTMENTS } from "../src/lib/domain";

const EXPENSE_CATEGORIES: [string, string, string][] = [
  ["alquiler_vehiculos", "Alquiler de vehículos", "operativo"],
  ["transporte", "Transporte y combustible", "operativo"],
  ["ia", "Herramientas de inteligencia artificial", "operativo"],
  ["software", "Software y suscripciones", "operativo"],
  ["alquiler_local", "Alquiler de oficina o local", "operativo"],
  ["electricidad", "Electricidad", "operativo"],
  ["agua", "Agua", "operativo"],
  ["internet", "Internet y telefonía", "operativo"],
  ["impuestos", "Impuestos", "impuesto"],
  ["dgi", "Obligaciones con la DGI", "impuesto"],
  ["alcaldia", "Obligaciones con la Alcaldía", "impuesto"],
  ["nomina", "Nómina", "nomina"],
  ["aportes_patronales", "Aportes patronales", "nomina"],
  ["prestaciones", "Prestaciones laborales", "nomina"],
  ["equipos", "Equipos y mantenimiento", "operativo"],
  ["produccion_foto", "Producción fotográfica", "directo"],
  ["produccion_video", "Producción de videos", "directo"],
  ["diseno_recursos", "Diseño y recursos creativos", "directo"],
  ["publicidad", "Publicidad", "directo"],
  ["servicios_profesionales", "Servicios profesionales", "operativo"],
  ["comisiones", "Comisiones", "operativo"],
  ["otros", "Otros gastos operativos", "operativo"],
];

/** Notificaciones que recibe cada rol por defecto (configurable en Configuración). */
const ROLE_NOTIFICATIONS: Record<string, string[]> = {
  gerencia: Object.keys(NOTIFICATION_TYPES),
  administracion: ["session_attention", "client_onboarding", "invoice_due", "invoice_overdue", "expense_due", "payroll_prepare", "task_overdue", "admin_obligation"],
  ventas: ["lead_followup", "task_overdue"],
  estrategia: ["session_attention", "plan_pending", "task_overdue"],
  disenador: ["deliverable_overdue", "task_overdue"],
  editor_video: ["deliverable_overdue", "task_overdue"],
  community_manager: ["content_ready", "publication_pending", "task_overdue"],
  contabilidad: ["invoice_due", "invoice_overdue", "expense_due", "payroll_prepare", "admin_obligation"],
};

export async function seed(url = process.env.DATABASE_OWNER_URL!, opts: { adminEmail?: string; adminPassword?: string; quiet?: boolean } = {}) {
  const pool = new Pool({ connectionString: url, max: 1 });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.system','on',true)");

    for (const d of DEPARTMENTS) {
      await c.query("insert into departments(key,name) values($1,$2) on conflict (key) do update set name=excluded.name", [d.value, d.label]);
    }
    for (const [key, [module, description]] of Object.entries(PERMISSIONS)) {
      await c.query(
        "insert into permissions(key,module,description) values($1,$2,$3) on conflict (key) do update set module=excluded.module, description=excluded.description",
        [key, module, description],
      );
    }
    for (const r of SEED_ROLES) {
      const { rows } = await c.query(
        `insert into roles(key,name,description,is_system) values($1,$2,$3,true)
         on conflict (key) do update set name=excluded.name returning id, (xmax = 0) as inserted`,
        [r.key, r.name, r.description],
      );
      // Solo se asignan permisos por defecto al crear el rol; luego son configurables.
      if (rows[0].inserted) {
        for (const p of r.permissions) {
          await c.query("insert into role_permissions(role_id,permission_key) values($1,$2) on conflict do nothing", [rows[0].id, p]);
        }
        for (const type of Object.keys(NOTIFICATION_TYPES)) {
          await c.query("insert into notification_rules(role_id,type,enabled) values($1,$2,$3) on conflict do nothing", [
            rows[0].id,
            type,
            (ROLE_NOTIFICATIONS[r.key] ?? []).includes(type),
          ]);
        }
      }
    }
    for (const [key, name, kind] of EXPENSE_CATEGORIES) {
      await c.query("insert into expense_categories(key,name,kind) values($1,$2,$3) on conflict (key) do nothing", [key, name, kind]);
    }
    await c.query(
      `insert into service_packages(name, description, sessions_enabled, session_frequency_months, designs_per_month, reels_per_month,
        include_profile_photo, include_cover, include_strategy, include_community, social_networks)
       values ('Paquete estándar', 'Sesión mensual, 6 artes, foto de perfil, portada, 6 reels, gestión de redes, calendario y planificación estratégica',
        true, 1, 6, 6, true, true, true, true, '{facebook,instagram}')
       on conflict (name) do nothing`,
    );
    await c.query(
      `insert into labor_rule_sets(version, country, effective_from, params, sources, validated, notes)
       values ($1, 'NI', '2026-01-01', $2, $3, false, $4) on conflict (version) do nothing`,
      [
        "NI-2026-referencia",
        JSON.stringify({
          inssEmployeeRate: 0.07,
          inssEmployerRate: 0.215,
          inatecRate: 0.02,
          irBrackets: [
            { from: 0, to: 100000, base: 0, rate: 0 },
            { from: 100000, to: 200000, base: 0, rate: 0.15 },
            { from: 200000, to: 350000, base: 15000, rate: 0.2 },
            { from: 350000, to: 500000, base: 45000, rate: 0.25 },
            { from: 500000, to: null, base: 82500, rate: 0.3 },
          ],
          irDeductInss: true,
          aguinaldoMonthsPerYear: 1,
          aguinaldoPeriodStartMonth: 12,
          aguinaldoBase: "ultimo_salario",
          vacationDaysPerMonth: 2.5,
          payrollCurrency: "NIO",
        }),
        [
          "Código del Trabajo (Ley 185), arts. 76 (vacaciones: 15 días por cada 6 meses) y 93-97 (décimo tercer mes).",
          "Ley de Concertación Tributaria (Ley 822) y reformas (Ley 987): tabla progresiva de IR sobre rentas del trabajo (art. 23).",
          "INSS: cotización laboral 7 %, patronal 21.5 % (menos de 50 trabajadores) o 22.5 %; INATEC 2 %.",
          "Fuentes consultadas (secundarias): wageindicator.org/es-ni, laprensani.com (2022), toptrabajos.com/ni, unan.edu.ni/LEY-822.pdf.",
        ].join("\n"),
        "PENDIENTE DE VALIDACIÓN: valores de referencia tomados de fuentes secundarias. Verificar contra La Gaceta, INSS, DGI y MITRAB antes de aprobar nóminas definitivas. Confirmar la tasa patronal según el número de trabajadores y la base de cálculo del aguinaldo.",
      ],
    );

    const adminEmail = opts.adminEmail ?? process.env.SEED_ADMIN_EMAIL ?? "gerencia@conecta.local";
    const adminPassword = opts.adminPassword ?? process.env.SEED_ADMIN_PASSWORD ?? "Conecta2026!";
    const existing = await c.query("select id from users where lower(email)=lower($1)", [adminEmail]);
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(adminPassword, 10);
      const { rows } = await c.query("insert into users(email,name,password_hash) values($1,$2,$3) returning id", [adminEmail, "Gerencia CONECTA", hash]);
      await c.query("insert into user_roles(user_id, role_id) select $1, id from roles where key='gerencia'", [rows[0].id]);
      if (!opts.quiet) console.log(`✓ Usuario inicial: ${adminEmail} / ${adminPassword}  (cámbialo después de entrar)`);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => console.log("✓ Seed aplicado"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
