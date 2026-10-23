import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Almacenamiento privado local (fuera de /public). Reemplazable por S3/Supabase Storage implementando la misma interfaz. */
export interface FileStorage {
  save(data: Buffer, originalName: string): Promise<string>;
  read(key: string): Promise<Buffer>;
}

class LocalStorage implements FileStorage {
  constructor(private root: string) {}
  async save(data: Buffer, originalName: string) {
    const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
    const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
    const full = path.join(this.root, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return key;
  }
  async read(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root))) throw new Error("Ruta inválida");
    return readFile(full);
  }
}

/** Supabase Storage (bucket privado) vía su API REST, con la clave de servicio solo en el servidor. */
class SupabaseStorage implements FileStorage {
  constructor(private url: string, private key: string, private bucket: string) {}
  private endpoint(key: string) {
    return `${this.url.replace(/\/$/, "")}/storage/v1/object/${this.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  // Claves nuevas (sb_secret_…) van solo en `apikey`; las antiguas service_role (JWT) también como Bearer.
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.key, ...(this.key.startsWith("eyJ") ? { Authorization: `Bearer ${this.key}` } : {}), ...extra };
  }
  async save(data: Buffer, originalName: string) {
    const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
    const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
    const res = await fetch(this.endpoint(key), { method: "POST", headers: this.headers({ "Content-Type": "application/octet-stream", "x-upsert": "false" }), body: new Uint8Array(data) });
    if (!res.ok) throw new Error(`No se pudo guardar el archivo en Supabase Storage (${res.status})`);
    return key;
  }
  async read(key: string) {
    const res = await fetch(this.endpoint(key), { headers: this.headers() });
    if (!res.ok) throw new Error(`No se pudo leer el archivo de Supabase Storage (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export const storage: FileStorage =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseStorage(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_STORAGE_BUCKET ?? "conecta-archivos")
    : new LocalStorage(path.resolve(process.env.FILE_STORAGE_DIR ?? "./storage"));
