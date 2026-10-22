import Link from "next/link";
import { load, sp, type SP } from "../_lib/page";
import { getConversation, listConversations } from "@/server/agent/runner";
import { getAgentProvider } from "@/server/agent/provider";
import { PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { AgentChat } from "./chat";

export const metadata = { title: "Asistente de CONECTA" };

export default async function AssistantPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const convId = sp(q.c) ?? null;
  const d = await load(["agent.use"], async (_ctx, actor) => ({
    conversations: await listConversations(actor),
    current: convId ? await getConversation(actor, convId) : null,
  }));
  const initial = (d.current?.messages ?? []).map((m) => ({ role: (m.display?.startsWith("El usuario") ? "system" : m.role) as "user" | "assistant" | "system", text: m.display ?? "" }));
  return (
    <>
      <PageHeader title="Asistente de CONECTA" subtitle="Ejecuta acciones reales en CONECTA OS con tus permisos. Todo queda en la auditoría." />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <aside className="space-y-1">
          <Link href="/asistente" className="block rounded-md bg-brand-600 px-3 py-2 text-center text-sm font-medium text-white">Nueva conversación</Link>
          {d.conversations.map((c) => (
            <Link key={c.id} href={`/asistente?c=${c.id}`} className={cn("block rounded-md px-3 py-2 text-sm hover:bg-white", c.id === convId && "bg-white font-medium")}>
              <div className="truncate">{c.title}</div>
              <div className="text-xs text-slate-400">{formatDateTime(c.updatedAt)}</div>
            </Link>
          ))}
        </aside>
        <AgentChat key={convId ?? "new"} initial={initial} conversationId={convId} configured={!!getAgentProvider()} />
      </div>
    </>
  );
}
