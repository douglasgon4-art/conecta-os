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
          "Código del Trabajo (Ley 185): art. 76 — 15 días de vacaciones por cada 6 meses de trabajo ininterrumpido; art. 94 — el décimo tercer mes se paga con el último mes de salario (si el salario es variable por comisiones, obra o destajo: el más alto de los últimos 6 meses); art. 95 — pago en los primeros 10 días de diciembre o al terminar el contrato. Textos: ineter.gob.ni/wp-content/uploads/2024/11/Codigo-del-Trabajo.pdf, oig.cepal.org/sites/default/files/1996_codtrabajo_nic.pdf.",
          "INSS régimen integral: laboral 7 %; patronal 21.5 % para empleadores con menos de 50 trabajadores (sitio oficial: inss-princ.inss.gob.ni › Regímenes de afiliación). El 22.5 % para 50 o más solo aparece en fuentes secundarias. Sin techo de cotización (Resolución RI-112-2018, según fuentes secundarias).",
          "INATEC: 2 % patronal sobre la nómina bruta (fuentes secundarias).",
          "IR rentas del trabajo: Ley 822, art. 23 (reformada por Ley 891): exento hasta C$100,000 anuales; 15 % sobre el exceso hasta C$200,000; C$15,000 + 20 % hasta C$350,000; C$45,000 + 25 % hasta C$500,000; C$82,500 + 30 % sobre el exceso. Base: salario menos INSS laboral, proyectado a 12 meses. Tabla confirmada en varias fuentes secundarias; falta verificarla en la DGI o La Gaceta.",
        ].join("\n"),
        "PENDIENTE DE VALIDACIÓN POR GERENCIA O POR EL CONTADOR. Confirmado en fuente oficial: INSS laboral 7 % y patronal 21.5 % (<50 trabajadores); base del aguinaldo = último salario (art. 94); vacaciones 2.5 días por mes (art. 76). Por confirmar en fuente oficial: INATEC 2 % y la tabla de IR vigente (DGI).",
      ],
    );

    const clean = (v?: string) => v?.trim().replace(/^["']|["']$/g, "").trim() || undefined;
    const envPassword = clean(process.env.SEED_ADMIN_PASSWORD);
    const adminEmail = (opts.adminEmail ?? clean(process.env.SEED_ADMIN_EMAIL) ?? "gerencia@conecta.local").toLowerCase();
    const adminPassword = opts.adminPassword ?? envPassword ?? "Conecta2026!";
    const fromEnv = Boolean(opts.adminPassword ?? envPassword);
    const existing = await c.query("select id from users where lower(email)=lower($1)", [adminEmail]);
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(adminPassword, 10);
      const { rows } = await c.query("insert into users(email,name,password_hash) values($1,$2,$3) returning id", [adminEmail, "Gerencia CONECTA", hash]);
      await c.query("insert into user_roles(user_id, role_id) select $1, id from roles where key='gerencia'", [rows[0].id]);
      // Si la contraseña viene de una variable de entorno no se imprime (los registros de despliegue pueden ser visibles).
      if (!opts.quiet) console.log(`✓ Usuario inicial: ${adminEmail}${fromEnv ? "" : ` / ${adminPassword}`}  (cambia la contraseña después de entrar)`);
    } else if (clean(process.env.SEED_ADMIN_RESET) === "1" && envPassword) {
      // Restablecimiento explícito de la contraseña de Gerencia (quitar SEED_ADMIN_RESET después de entrar).
      const hash = await bcrypt.hash(envPassword, 10);
      await c.query("update users set password_hash=$2, is_active=true where id=$1", [existing.rows[0].id, hash]);
      await c.query("insert into user_roles(user_id, role_id) select $1, id from roles where key='gerencia' on conflict do nothing", [existing.rows[0].id]);
      if (!opts.quiet) console.log(`✓ Usuario inicial: ${adminEmail} — contraseña restablecida con SEED_ADMIN_PASSWORD. Quita SEED_ADMIN_RESET de las variables.`);
    } else if (!opts.quiet) {
      console.log(`✓ Usuario inicial: ${adminEmail} (ya existía; la contraseña no se modificó)`);
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
