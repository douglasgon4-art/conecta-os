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

export const storage: FileStorage = new LocalStorage(path.resolve(process.env.FILE_STORAGE_DIR ?? "./storage"));
