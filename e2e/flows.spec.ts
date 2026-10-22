import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email = "gerencia@conecta.local", password = "Conecta2026!") {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.locator("form button").click();
  await page.waitForURL("/");
}

const errors: string[] = [];
test.beforeEach(({ page }) => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept()); // confirmaciones de acciones sensibles
});
test.afterEach(() => expect(errors.splice(0)).toEqual([]));

test("rechaza credenciales inválidas y protege las rutas", async ({ page }) => {
  await page.goto("/clientes");
  await expect(page).toHaveURL(/\/login/);
  await page.fill("input[name=email]", "gerencia@conecta.local");
  await page.fill("input[name=password]", "incorrecta");
  await page.locator("form button").click();
  await expect(page.getByText("Correo o contraseña incorrectos")).toBeVisible();
});

test("crear cliente genera sus espacios y el tablero de 14 entregables", async ({ page }) => {
  await login(page);
  await page.goto("/clientes/nuevo");
  await page.fill("input[name='client.tradeName']", "Consultorio Pepitos E2E");
  await page.fill("input[name='client.city']", "Estelí");
  await page.fill("input[name='contract.startDate']", "2026-10-01");
  await page.fill("input[name='contract.monthlyPrice']", "12000");
  await page.getByRole("button", { name: "Crear cliente y generar espacios" }).click();
  await page.waitForURL(/\/clientes\/[0-9a-f-]+\?creado=1/);
  await expect(page.getByText("Sus espacios de trabajo se generaron automáticamente")).toBeVisible();
  await expect(page.locator("h1")).toHaveText("Consultorio Pepitos E2E");

  await page.getByRole("link", { name: "Producción", exact: true }).click();
  await page.getByRole("link", { name: /octubre de 2026/ }).first().click();
  await expect(page.getByText("Área de Diseño")).toBeVisible();
  await expect(page.getByText("0/14 entregables")).toBeVisible();

  // Sin archivo final no se puede terminar
  const firstRow = page.locator("tr", { hasText: "Arte gráfico 1" });
  await firstRow.locator("select[name=status]").selectOption("finalizado");
  await firstRow.getByRole("button", { name: "Guardar" }).click();
  await expect(firstRow.getByText(/falta el archivo final/)).toBeVisible();

  await firstRow.locator("input[name=finalFileUrl]").fill("https://drive.example.com/arte1.png");
  await firstRow.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("1/14 entregables")).toBeVisible();

  // Facturación generada (pendiente, nunca pagada automáticamente)
  await page.goto("/finanzas/facturas");
  await expect(page.locator("tr", { hasText: "Consultorio Pepitos E2E" }).first()).toBeVisible();
});

test("ventas: agregar prospecto y registrar llamada", async ({ page }) => {
  await login(page);
  await page.goto("/ventas?lista=pendientes");
  await page.fill("input[name=tradeName]", "Clínica Ejemplo E2E");
  await page.fill("input[name=city]", "Estelí");
  await page.getByRole("button", { name: "Agregar a pendientes" }).click();
  await expect(page.getByText("agregado a la lista")).toBeVisible();
  await page.getByRole("link", { name: "Clínica Ejemplo E2E" }).click();
  await page.locator("select[name=result]").selectOption("contesto");
  await page.fill("input[name=answeredBy]", "Recepción");
  await page.getByRole("button", { name: "Guardar llamada" }).click();
  await expect(page.getByText("Historial de llamadas (1)")).toBeVisible();
});

test("el asistente informa que está pendiente de configuración sin simular acciones", async ({ page }) => {
  await login(page);
  await page.goto("/asistente");
  await expect(page.getByText(/pendiente de configuración/).first()).toBeVisible();
  await page.fill("textarea", "Agrega un colaborador llamado Prueba");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(/No se ejecutó ninguna acción/)).toBeVisible();
});

test("todas las secciones cargan sin errores para Gerencia", async ({ page }) => {
  await login(page);
  const paths = ["/", "/tareas", "/clientes", "/clientes?scope=inactivos", "/ventas", "/agenda", "/agenda?vista=semana", "/agenda?vista=dia", "/estrategia", "/produccion", "/publicaciones", "/publicaciones?tab=contenido", "/publicaciones?tab=historial", "/colaboradores", "/colaboradores/nuevo", "/nomina", "/gastos", "/gastos?tab=categorias", "/gastos?tab=recurrentes", "/finanzas", "/finanzas/facturas", "/finanzas/rentabilidad", "/informes", "/informes?informe=entregables", "/configuracion", "/configuracion/roles", "/configuracion/usuarios", "/configuracion/reglas-laborales", "/configuracion/automatizaciones", "/configuracion/auditoria", "/configuracion/auditoria?tab=agente", "/notificaciones", "/perfil", "/buscar?q=Pepitos"];
  for (const p of paths) {
    const res = await page.goto(p);
    expect(res?.status(), p).toBeLessThan(400);
    await expect(page.locator("h1").first(), p).toBeVisible();
    await expect(page.getByText("Application error"), p).toHaveCount(0);
  }
  // Ficha de cliente: todas las pestañas
  await page.goto("/clientes");
  await page.getByRole("link", { name: "Consultorio Pepitos E2E" }).click();
  await page.waitForURL(/\/clientes\/[0-9a-f-]+$/);
  const base = page.url();
  for (const tab of ["agenda", "estrategia", "produccion", "disenos", "videos", "publicaciones", "aprobaciones", "administracion", "facturacion", "historial"]) {
    await page.goto(`${base}?tab=${tab}`);
    await expect(page.locator("h1"), tab).toHaveText("Consultorio Pepitos E2E");
  }
  // Planificación y tablero
  await page.goto("/estrategia?mes=2026-11");
  await page.getByRole("link", { name: "Consultorio Pepitos E2E" }).click();
  await expect(page.getByText("Reels (6)")).toBeVisible();
});

test("un diseñador no ve finanzas ni puede abrir sus rutas", async ({ page }) => {
  await login(page, "disenio@conecta.local", "Diseno2026!");
  await expect(page.getByRole("link", { name: "Finanzas y cobros" })).toHaveCount(0);
  await page.goto("/finanzas");
  await expect(page).toHaveURL(/sin-acceso/);
  await page.goto("/nomina");
  await expect(page).toHaveURL(/sin-acceso/);
  const res = await page.request.get("/api/export?informe=facturas&desde=2026-10-01&hasta=2026-10-31");
  expect(res.status()).toBe(403);
});

test("el endpoint de cron exige el secreto y ejecuta las automatizaciones", async ({ request }) => {
  expect((await request.get("/api/cron")).status()).toBe(401);
  const ok = await request.post("/api/cron", { headers: { authorization: "Bearer e2e-secret" } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.results.length).toBeGreaterThan(5);
});
