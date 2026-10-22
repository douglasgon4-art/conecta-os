import { resetDatabase } from "../scripts/reset-db";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

export default async function setup() {
  const owner = process.env.E2E_DATABASE_OWNER_URL ?? "postgres://conecta_owner:conecta_owner@localhost:5432/conecta_e2e";
  await resetDatabase(owner, { quiet: true });
  // Usuario diseñador para probar permisos
  const pool = new Pool({ connectionString: owner });
  const c = await pool.connect();
  await c.query("BEGIN");
  await c.query("select set_config('app.system','on',true)");
  const { rows } = await c.query("insert into employees(full_name, normalized_name, start_date) values('Diana Diseño','diana diseno','2026-01-01') returning id");
  const u = await c.query("insert into users(email,name,password_hash,employee_id) values('disenio@conecta.local','Diana Diseño',$1,$2) returning id", [await bcrypt.hash("Diseno2026!", 10), rows[0].id]);
  await c.query("insert into user_roles(user_id, role_id) select $1, id from roles where key='disenador'", [u.rows[0].id]);
  await c.query("COMMIT");
  c.release();
  await pool.end();
}
