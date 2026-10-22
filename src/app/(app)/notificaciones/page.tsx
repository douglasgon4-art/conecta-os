import Link from "next/link";
import { load } from "../_lib/page";
import { listNotifications } from "@/server/services/notifications";
import { NOTIFICATION_TYPES } from "@/server/services/notification-types";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { markReadAction } from "./actions";

export const metadata = { title: "Notificaciones" };
const tone = { info: "blue", warning: "yellow", critical: "red", success: "green" } as const;

export default async function NotificationsPage() {
  const d = await load([], async (ctx) => ({ rows: await listNotifications(ctx, { limit: 200 }) }));
  return (
    <>
      <PageHeader title="Notificaciones" subtitle="Generadas automáticamente por el sistema, sin avisos duplicados" actions={<ActionForm action={markReadAction} inline><SubmitButton size="sm" variant="secondary">Marcar todas como leídas</SubmitButton></ActionForm>} />
      <Card padded={false}>
        {d.rows.length ? (
          <ul className="divide-y divide-slate-100">
            {d.rows.map((n) => (
              <li key={n.id} className={cn("flex items-start gap-3 p-3", !n.readAt && "bg-brand-50/40")}>
                <Badge tone={tone[n.severity as keyof typeof tone] ?? "gray"}>{NOTIFICATION_TYPES[n.type as keyof typeof NOTIFICATION_TYPES] ?? n.type}</Badge>
                <div className="flex-1 text-sm">
                  {n.link ? <Link href={n.link} className="font-medium hover:underline">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
                  {n.body && <div className="text-slate-600">{n.body}</div>}
                  <div className="text-xs text-slate-400">{formatDateTime(n.createdAt)}</div>
                </div>
                {!n.readAt && <ActionForm action={markReadAction} inline><input type="hidden" name="id" value={n.id} /><SubmitButton size="sm" variant="ghost">Leída</SubmitButton></ActionForm>}
              </li>
            ))}
          </ul>
        ) : <div className="p-4"><Empty>No tienes notificaciones.</Empty></div>}
      </Card>
    </>
  );
}
