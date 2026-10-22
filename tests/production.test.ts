import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { as, at, makeUser, standardContract, uniq } from "./helpers";
import { createClient } from "@/server/services/clients";
import {
  bulkCompleteDeliverables,
  computeBoardProgress,
  getBoardByClientPeriod,
  productionOverview,
  updateBoard,
  updateDeliverable,
  completeDeliverable,
  addPlatformVariant,
  readyToPublish,
} from "@/server/services/production";
import { listNotifications } from "@/server/services/notifications";
import { productionBoards } from "@/server/db/schema";

const TODAY = at("2026-10-22");
const FILE = "https://drive.example.com/archivo-final";

async function setup() {
  const admin = await makeUser("gerencia");
  const designer = await makeUser("disenador");
  const editor = await makeUser("editor_video");
  const cm = await makeUser("community_manager");
  const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Prod"), communityManagerId: cm.employeeId }, contract: standardContract() }), TODAY);
  const board = (await as(admin, (ctx) => getBoardByClientPeriod(ctx, r.client.id, "2026-10-01"), TODAY))!;
  await as(admin, (ctx) => updateBoard(ctx, board.id, { designerId: designer.employeeId, editorId: editor.employeeId }), TODAY);
  return { admin, designer, editor, cm, client: r.client, board: (await as(admin, (ctx) => getBoardByClientPeriod(ctx, r.client.id, "2026-10-01"), TODAY))! };
}

describe("Tablero mensual de producción", () => {
  it("calcula el avance sobre 14 entregables (7/14 = 50 %, 10/14 = 71,4 %)", () => {
    const mk = (kind: string, done: boolean) => ({ kind, status: done ? (kind === "reel" ? "editado" : "finalizado") : kind === "reel" ? "en_edicion" : "en_diseno", dueDate: "2026-10-25", countsTowardProgress: true });
    const items = [...Array(6)].map((_, i) => mk("diseno", i < 6)).concat([mk("perfil", true), mk("portada", false)], [...Array(6)].map(() => mk("reel", false)));
    const p = computeBoardProgress({ period: "2026-10-01", dueDate: "2026-10-25" }, items, "2026-10-22");
    expect(p).toMatchObject({ total: 14, done: 7, designs: { done: 6, total: 6 }, profileCover: { done: 1, total: 2 }, reels: { done: 0, total: 6 }, status: "en_produccion" });
    expect(p.progress).toBeCloseTo(0.5);
    const items2 = items.map((d, i) => (i >= 8 && i < 11 ? mk("reel", true) : d));
    expect(computeBoardProgress({ period: "2026-10-01", dueDate: "2026-10-25" }, items2, "2026-10-22").progress).toBeCloseTo(10 / 14);
    const late = computeBoardProgress({ period: "2026-10-01", dueDate: "2026-10-25" }, items2, "2026-10-26");
    expect(late).toMatchObject({ status: "con_retraso", delayed: true });
    expect(computeBoardProgress({ period: "2026-10-01", dueDate: "2026-10-25" }, items2, "2026-11-02").status).toBe("produccion_incompleta");
  });

  it("impide declarar terminado un entregable sin archivo final y respeta las asignaciones", async () => {
    const { designer, editor, board } = await setup();
    const design = board.deliverables.find((d) => d.kind === "diseno")!;
    const reel = board.deliverables.find((d) => d.kind === "reel")!;
    await expect(as(designer, (ctx) => completeDeliverable(ctx, design.id), TODAY)).rejects.toMatchObject({ code: "VALIDATION" });
    const done = await as(designer, (ctx) => completeDeliverable(ctx, design.id, FILE), TODAY);
    expect(done.status).toBe("finalizado");
    expect(done.completedBy).toBe(designer.userId);
    // El diseñador no puede tocar reels; el editor sí los suyos
    await expect(as(designer, (ctx) => updateDeliverable(ctx, reel.id, { status: "en_edicion" }), TODAY)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await as(editor, (ctx) => updateDeliverable(ctx, reel.id, { status: "en_edicion" }), TODAY);
    await expect(as(editor, (ctx) => updateDeliverable(ctx, reel.id, { assigneeId: designer.employeeId }), TODAY)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(editor, (ctx) => updateDeliverable(ctx, reel.id, { status: "finalizado" }), TODAY)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("acción grupal con confirmación, estado listo para publicar y aviso al CM", async () => {
    const { admin, cm, client, board } = await setup();
    for (const d of board.deliverables.filter((x) => x.kind === "diseno").slice(0, 5)) {
      await as(admin, (ctx) => updateDeliverable(ctx, d.id, { finalFileUrl: FILE }), TODAY);
    }
    await expect(as(admin, (ctx) => bulkCompleteDeliverables(ctx, board.id, "disenos"), TODAY)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const res = await as(admin, (ctx) => bulkCompleteDeliverables(ctx, board.id, "disenos", { confirm: true }), TODAY);
    expect(res.completed).toHaveLength(5);
    expect(res.skippedMissingFile).toEqual(["Arte gráfico 6"]);

    for (const d of board.deliverables.filter((x) => !(x.kind === "diseno" && x.position <= 5))) {
      await as(admin, (ctx) => completeDeliverable(ctx, d.id, FILE), TODAY);
    }
    const [row] = await as(admin, (ctx) => productionOverview(ctx, { period: "2026-10-01", clientId: client.id }), TODAY);
    expect(row).toMatchObject({ done: 14, total: 14, status: "listo_para_publicar" });
    expect(row.readyAt).not.toBeNull();
    const ready = await as(cm, (ctx) => readyToPublish(ctx, "2026-10-01"), TODAY);
    expect(ready.map((r) => r.clientId)).toContain(client.id);
    const notes = await as(cm, (ctx) => listNotifications(ctx), TODAY);
    expect(notes.some((n) => n.type === "content_ready" && n.title.includes(client.tradeName))).toBe(true);

    // Si un entregable vuelve a cambios, deja de estar listo
    const reel = board.deliverables.find((d) => d.kind === "reel")!;
    await as(admin, (ctx) => updateDeliverable(ctx, reel.id, { status: "pendiente_cambios" }), TODAY);
    const [again] = await as(admin, (ctx) => productionOverview(ctx, { period: "2026-10-01", clientId: client.id }), TODAY);
    expect(again.status).not.toBe("listo_para_publicar");
    expect(again.readyAt).toBeNull();
  });

  it("las variantes por plataforma no cuentan como artes adicionales y los meses anteriores se conservan", async () => {
    const { admin, client, board } = await setup();
    await as(admin, (ctx) => addPlatformVariant(ctx, board.id, "portada", "facebook"), TODAY);
    const b = (await as(admin, (ctx) => getBoardByClientPeriod(ctx, client.id, "2026-10-01"), TODAY))!;
    expect(b.deliverables).toHaveLength(15);
    expect(b.total).toBe(14);
    const boards = await as(admin, ({ tx }) => tx.select().from(productionBoards).where(and(eq(productionBoards.clientId, client.id))), at("2026-12-05"));
    expect(boards.length).toBeGreaterThanOrEqual(2);
  });
});
