"use client";
import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { importAction, type ImportState } from "./actions";

export function ImportForm({ kinds }: { kinds: { key: string; label: string; columns: string[]; required: string[] }[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, null);
  const [kind, setKind] = useState(kinds[0]?.key);
  const k = kinds.find((x) => x.key === kind);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="font-medium">Qué importar</span>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 block h-9 rounded-md border border-slate-300 px-2">
            {kinds.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        <a href={`/api/plantillas/${kind}`} className="h-9 rounded-md border border-slate-300 px-3 py-2 text-sm">Descargar plantilla</a>
        <label className="text-sm"><span className="font-medium">Archivo CSV</span><input type="file" name="file" accept=".csv,text/csv" required className="mt-1 block text-sm" /></label>
      </div>
      {k && <p className="text-xs text-slate-500">Columnas: {k.columns.join(", ")}. Obligatorias: <strong>{k.required.join(", ")}</strong>. Fechas en AAAA-MM-DD o DD/MM/AAAA. En Excel: «Guardar como → CSV».</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowDuplicate" className="size-4" />Importar también los posibles duplicados (solo si revisaste que son registros distintos)</label>
      <div className="flex gap-2">
        <button name="mode" value="previa" disabled={pending} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium">Vista previa (no guarda)</button>
        <button name="mode" value="importar" disabled={pending} className="h-9 rounded-md bg-brand-600 px-3 text-sm font-medium text-white">Importar</button>
        {pending && <Loader2 className="size-5 animate-spin self-center" />}
      </div>
      {state?.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
      {state?.ok && (
        <div className="rounded-md border border-slate-200">
          <div className={`px-3 py-2 text-sm font-medium ${state.failed ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
            {state.dryRun ? "Vista previa: " : "Importación: "}{state.okCount} de {state.total} fila(s) correctas{state.failed ? `, ${state.failed} con errores` : ""}.{state.dryRun ? " No se guardó nada." : ""}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
            {state.results?.map((r) => <li key={r.row} className={`px-3 py-1.5 ${r.ok ? "" : "text-red-700"}`}>Fila {r.row}: {r.ok ? "✓" : "✕"} {r.message}</li>)}
          </ul>
        </div>
      )}
    </form>
  );
}
