# Publicar CONECTA OS (Supabase + Vercel)

Tiempo estimado: 20–30 minutos. **No compartas contraseñas ni claves por chat.** Todas se pegan directamente en
Supabase o en Vercel.

## 1. Base de datos en Supabase

1. Crea una cuenta en https://supabase.com y un proyecto nuevo (*New project*). Región recomendada: **East US** (la
   más cercana a Nicaragua). Guarda la contraseña de la base de datos.
2. Abre **SQL Editor**, pega el contenido de [`db/supabase-setup.sql`](../db/supabase-setup.sql), **cambia las dos
   contraseñas** (`CAMBIA-ESTA-CLAVE-OWNER` y `CAMBIA-ESTA-CLAVE-APP`) por valores largos y aleatorios y ejecútalo.
3. En **Project Settings → Data API** desactiva la Data API: CONECTA OS no la usa. La migración `0002` también
   retira cualquier acceso de los roles públicos.
4. En **Project Settings → Database → Connection string** (sección *Connection pooling*) copia el host del pooler, que
   tiene esta forma: `aws-0-us-east-1.pooler.supabase.com`. Anota también el *project ref*: es el texto que aparece en
   la URL del proyecto, `https://supabase.com/dashboard/project/<project-ref>`.
5. En **Project Settings → API** copia la *Project URL* y la clave **service_role**. La clave service_role es secreta
   y solo va en Vercel.

## 2. Aplicación en Vercel

1. Crea una cuenta en https://vercel.com con tu GitHub y elige **Add New → Project → Import**
   `douglasgon4-art/conecta-os`.
2. En **Environment Variables** agrega:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | `postgresql://conecta_app.<project-ref>:<CLAVE-APP>@<host-pooler>:6543/postgres` |
| `DATABASE_OWNER_URL` | `postgresql://conecta_owner.<project-ref>:<CLAVE-OWNER>@<host-pooler>:5432/postgres` |
| `DB_POOL_MAX` | `5` |
| `CRON_SECRET` | una cadena aleatoria larga, por ejemplo la salida de `openssl rand -hex 32` |
| `APP_TIMEZONE` | `America/Managua` |
| `SUPABASE_URL` | la Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | la clave service_role |
| `SUPABASE_STORAGE_BUCKET` | `conecta-archivos` |
| `SEED_ADMIN_EMAIL` | tu correo de acceso (Gerencia) |
| `SEED_ADMIN_PASSWORD` | una contraseña inicial segura (cámbiala al entrar) |
| `ANTHROPIC_API_KEY` | tu clave de https://console.anthropic.com (opcional; activa el asistente) |
| `AI_MODEL` | `claude-opus-5-5` (opcional) |

3. Pulsa **Deploy**. En cada despliegue, el comando `vercel-build` aplica las migraciones, carga los catálogos (el seed
   es idempotente y no duplica nada) y compila.
4. Entra a la URL que te da Vercel con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`, y cambia la contraseña en
   **Mi perfil**.

**¿No puedes entrar?** En Vercel abre *Deployments → el último → Build Logs* y busca `Usuario inicial`: ahí aparece el
correo que se creó (nunca la contraseña). Para restablecer la contraseña de Gerencia, cambia `SEED_ADMIN_PASSWORD`,
agrega la variable `SEED_ADMIN_RESET` = `1` y vuelve a desplegar (*Redeploy*). Cuando entres, borra `SEED_ADMIN_RESET`.

El cron diario ya está configurado en `vercel.json` (6:00 a. m. hora de Managua). Vercel envía `CRON_SECRET`
automáticamente.

## 3. Primeros pasos dentro de la app

1. **Configuración → Ajustes**: actualiza el tipo de cambio con la tasa oficial del BCN y revisa las anticipaciones.
2. **Configuración → Reglas laborales**: revisa las fuentes con tu contador y pulsa **Marcar como validada**. Hasta
   entonces, la nómina se calcula como estimación y no se puede aprobar.
3. **Configuración → Importar datos**: descarga las plantillas, llénalas en Excel, guárdalas como CSV y usa
   **Vista previa** antes de **Importar**. Importa en este orden: colaboradores, clientes y prospectos.
4. **Configuración → Usuarios**: crea los accesos de tu equipo y asígnales su rol.

## Actualizaciones

Cada cambio que se sube a la rama `main` de GitHub se despliega automáticamente. Las migraciones nuevas se aplican
solas.
