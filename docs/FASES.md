# CONECTA OS — Resumen por fases

Cada fase indica lo implementado, las migraciones, las pruebas ejecutadas y lo que queda pendiente.
Las pruebas de integración (`tests/*.test.ts`) corren contra PostgreSQL real con RLS activo; las E2E (`e2e/`) contra la
aplicación compilada en un navegador Chromium.

## Fase 1 · Fundación

**Implementado**
- Esquema completo (54 tablas) con claves foráneas, `CHECK` de estados, índices y restricciones de unicidad.
- RLS forzado en todas las tablas. El servidor fija `app.user_id`, `app.perms` y `app.system` por transacción.
  Las tablas sensibles (salarios, nómina, facturas, gastos, auditoría) exigen el permiso también en la base de datos.
- El rol `conecta_app` no tiene `BYPASSRLS` ni `DELETE` en tablas históricas. La auditoría y los pagos son de solo
  inserción. Un disparador impide modificar importes de nóminas cerradas.
- Autenticación con sesiones (token aleatorio hasheado, cookie httpOnly), límite de intentos y cabeceras de seguridad.
- 8 roles configurables con 44 permisos granulares, incluidos los permisos `*_own` para actualizar solo lo asignado.
- Ficha central del cliente, contrato o paquete por cliente, historial de estados y detección de duplicados.
- Colaboradores con historial salarial (fecha efectiva) e historial laboral. Los cambios retroactivos piden confirmación.

**Migraciones:** `0000_init.sql` (esquema), `0001_rls_security.sql` (RLS, privilegios, disparadores, secuencia de facturas).

**Pruebas:** `clients.test.ts`, `employees.test.ts`, `security.test.ts`.

## Fase 2 · Operaciones de clientes

**Implementado**
- Prospectos con 14 estados y 8 listas dinámicas calculadas desde el estado, registro de llamadas con historial,
  propuestas, cierre sin venta y detección de duplicados (también contra clientes).
- Conversión de una venta ganada en una sola transacción: crea o vincula el cliente sin duplicar, registra el contrato,
  genera los espacios, las tareas de incorporación y la cuenta por cobrar (nunca pagada) y avisa a Administración y
  Gerencia.
- Inicialización **idempotente** de espacios según el contrato: módulos, tareas, cuentas de redes, primera sesión,
  planificaciones, tableros con entregables y factura.
- Agenda con fechas prevista, propuesta, confirmada y realizada por separado; siguiente fecha calculada según la
  periodicidad; semáforo verde/amarillo/rojo; lista de atención; conflictos de horario; historial de cambios.
  Una sesión nunca se marca realizada solo por llegar la fecha.
- Estrategia: planificación única por cliente y mes, 6 reels y 6 diseños independientes, flujo de aprobación,
  sincronización con producción sin reescribir, duplicación con confirmación.

**Pruebas:** `sales.test.ts`, `agenda.test.ts`, `strategy.test.ts`.

## Fase 3 · Producción y publicación

**Implementado**
- Tablero único por cliente y período con los 14 entregables del paquete estándar (adaptable al contrato).
  Las variantes por plataforma no cuentan como artes adicionales.
- `CHECK` en la base de datos: ningún entregable puede quedar «Finalizado» o «Editado» sin archivo final.
- Avance calculado solo con entregables terminados; estado general automático (pendiente, en producción, en revisión,
  con retraso, producción incompleta, listo para publicar). Los retrasos se destacan aunque haya avance.
- Acciones grupales con confirmación, que completan solo lo que tiene archivo. Asignar diseñador o editor se propaga a
  sus entregables.
- Al completar el paquete: «Listo para publicar», aviso al CM y publicaciones preparadas desde las fechas tentativas.
  Si un entregable vuelve a cambios, el tablero deja de estar listo.
- Community Management: registro individual por red, confirmación trazada (quién y cuándo), reprogramación con
  registro nuevo y cumplimiento calculado solo con obligaciones aplicables. El **cierre diario es inmutable**.

**Pruebas:** `production.test.ts`, `publications.test.ts`.

## Fase 4 · Finanzas y personal

**Implementado**
- Cuentas por cobrar mensuales automáticas (`source_key` único), manuales con detección de duplicados, cobros parciales
  con bloqueo de fila e idempotencia, estado «vencida» derivado de la fecha y anulación con motivo y sin cobros.
- Gastos únicos y recurrentes: los períodos se generan sin duplicar y siempre como pendientes; hay pausa y cancelación
  que anula solo los pendientes futuros. Incluye pagos parciales, presupuesto frente a real, comparación mensual y
  salidas de caja.
- Nómina quincenal (mes comercial de 30 días, tramos por cambio salarial), recibo con bruto, deducciones y neto,
  ajustes autorizados, aprobación (bloqueada con reglas sin validar), contabilización única que separa salario neto,
  retenciones y aportes patronales, provisiones aparte y pago.
- Aguinaldo y vacaciones con detalle del cálculo, solicitudes, aprobaciones y ajustes.
- Resumen financiero que distingue lo facturado, lo reconocido y lo cobrado, y rentabilidad por cliente con regla de
  gastos generales configurable.

**Pruebas:** `finance.test.ts`, `payroll.test.ts`.

## Fase 5 · Automatizaciones y agente de IA

**Implementado**
- 9 trabajos idempotentes con `automation_runs` (clave única por día, intentos, estadísticas y error), reintento
  seguro y aviso de fallos. Se ejecutan por `/api/cron` (secreto), `npm run cron` o desde Configuración.
- Notificaciones con `dedupe_key` única por usuario y reglas por rol configurables. Los responsables directos siempre
  reciben sus avisos.
- Agente con 37 herramientas que llaman a los servicios; las herramientas visibles se filtran por permisos.
  Las acciones sensibles quedan pendientes de confirmación. Los errores se devuelven al modelo y el sistema le exige no
  afirmar éxito. Hay auditoría de la instrucción, la acción, los registros afectados, el resultado y la confirmación.
  Si falta el proveedor, el asistente responde «pendiente de configuración».

**Pruebas:** `automations.test.ts`, `agent.test.ts` (proveedor simulado determinista).

## Fase 6 · Consolidación

- Interfaz completa en español, adaptable a móvil, con estados que combinan color, icono y texto.
- E2E: autenticación, alta de cliente con espacios, regla del archivo final, ventas, asistente sin configurar,
  recorrido por todas las pantallas, permisos del diseñador y endpoint de cron.
- Documentación: `README.md`, `docs/PLAN.md` y este archivo.

## Criterios de aceptación → pruebas

| Área | Criterio | Prueba |
|---|---|---|
| Clientes | Crear, asignar paquete y generar espacios | `clients` › crea el cliente y genera… · E2E crear cliente |
| | Consultar desde otros departamentos | Ficha única por `client_id` (E2E: pestañas) |
| | Archivar sin borrar historial | `clients` › archivar conserva el historial |
| | Baja conservando finanzas y reactivar sin duplicar | `clients` › dar de baja… y reactivar no duplica |
| Agenda | Programar, reprogramar, realizada, siguiente fecha | `agenda` › 12 oct → 12 nov |
| | Alertas antes de coordinar y sesiones vencidas | `agenda` › semáforo · `automations` › alertas sin duplicados |
| Estrategia | 6 reels y 6 diseños, responsable, aprobar, tareas | `strategy` › planifica… sin duplicar |
| | Siguiente período sin copiar el anterior | `strategy` › siguiente período… |
| Producción | 14 entregables, avance, estado y listo | `production` (4 pruebas) |
| | Impedir completar sin archivo final | `production` · E2E · `CHECK` en la BD |
| | Conservar el historial mensual | `production` › meses anteriores · `automations` |
| Community | Publicar, cumplimiento diario e historial | `publications` › cumplimiento… inmutable |
| | Días sin publicaciones no cuentan | `publications` (cliente C excluido) |
| Ventas | Prospecto, llamadas, seguimiento y conversión sin duplicar | `sales` (5 pruebas) · E2E ventas |
| Personal y nómina | Colaborador, salario, períodos, reglas, historial, sin doble contabilización | `employees` · `payroll` |
| Gastos y contabilidad | Gasto, recurrente, parcial, saldo, cobros sin duplicar | `finance` · `security` › cobros simultáneos |
| Agente | Interpretar, buscar duplicados, ejecutar, verificar, auditar, confirmar, errores | `agent` (6 pruebas) |
| Seguridad | Permisos por rol, RLS, archivos, reintentos y duplicados | `security` · E2E diseñador · `automations` |

## Pendientes y riesgos conocidos

1. **Validar las reglas laborales** contra fuentes oficiales antes de aprobar nóminas definitivas, en particular la
   tasa patronal según el número de trabajadores, la base de cálculo del aguinaldo y el método de retención de IR de la
   DGI (se usa la proyección mensual × 12).
2. **Obligaciones tributarias de CONECTA** (DGI, Alcaldía): quedan como categorías de gasto. No se asume ninguna
   obligación automática.
3. **Integración con redes sociales:** la confirmación de publicaciones es manual y trazada. El modelo admite
   verificación por API (`verification = 'api'`).
4. **Archivos:** el almacenamiento local es para un solo servidor. En la nube conviene usar S3 o Supabase Storage.
   Los videos pesados se registran como enlace.
5. **Límite de intentos de inicio de sesión** en memoria: con varias instancias conviene un almacén compartido.
6. **Proveedor de IA:** probado con un proveedor simulado; requiere `ANTHROPIC_API_KEY` para el uso real.
7. **Repositorio:** el código está en un repositorio git local del contenedor. Hay que publicarlo en GitHub para
   conservarlo.
