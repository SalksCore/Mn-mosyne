import { THEME, subjectColor, withAlpha, useTheme } from "./theme.js";
import { createRenderCanvas, drawBackdrop, drawFooter, drawKicker, drawTitle, finishRender, fillRound, wrapText } from "./util.js";
import { getConfig } from "../store/db.js";
import { isImminent } from "../pronote/diff.js";
import type { Change } from "../types.js";

const W = 980;
const PAD = 28;
const CARD_W = W - PAD * 2 - 40;

export const KIND_LABEL: Record<string, string> = {
  lesson_canceled: "Cours annulé",
  lesson_restored: "Cours rétabli",
  lesson_room: "Salle modifiée",
  lesson_teacher: "Professeur modifié",
  lesson_moved: "Cours déplacé",
  lesson_added: "Nouveau cours",
  lesson_removed: "Cours retiré",
  lesson_status: "Statut modifié",
  lesson_test: "Évaluation",
  grade_new: "Nouvelle note",
  average_change: "Moyenne",
  homework_new: "Nouveau devoir",
  homework_done: "Devoir fait",
  discussion_new: "Message",
  news_new: "Information",
  absence_new: "Absence",
  absence_justified: "Absence justifiée",
};

/** Teinte d'un type de changement : rouge reserve aux annulations. */
function kindColor(kind: string): string {
  if (kind === "lesson_canceled" || kind === "lesson_removed" || kind === "absence_new") return THEME.danger;
  if (kind === "lesson_test" || kind === "lesson_status" || kind === "lesson_moved" || kind === "lesson_room") return THEME.warn;
  if (kind === "lesson_restored" || kind === "homework_done" || kind === "absence_justified") return THEME.good;
  return THEME.accent;
}

/**
 * Carte recapitulative des changements detectes. Le liseré gauche dit
 * l'urgence (aujourd'hui/demain ou plus tard), le badge dit la nature.
 */
export function renderChanges(changes: Change[], heading: string): Buffer {
  const cfg = getConfig();
  useTheme(cfg.imageTheme.notifications);
  const items = changes.slice(0, 10);

  // Passe de mesure pour connaitre la hauteur reelle avant de dessiner.
  const probe = createRenderCanvas(W, 10).ctx;
  probe.font = "400 14px Jakarta";
  const heights = items.map((c) => 62 + wrapText(probe, c.detail.replace(/\s+/g, " "), CARD_W - 44, 3).length * 20);

  const H = Math.max(240, 142 + heights.reduce((a, b) => a + b + 10, 0) + 56);
  const { canvas, ctx } = createRenderCanvas(W, H);
  drawBackdrop(ctx, W, H, changes.length + 11);

  const imminentCount = changes.filter(isImminent).length;
  drawKicker(ctx, `${changes.length} changement${changes.length > 1 ? "s" : ""} · PRONOTE`, PAD, 52, imminentCount ? cfg.colorImminent : THEME.accent);
  drawTitle(ctx, heading, PAD, 94, 30, CARD_W - 40);

  let y = 124;
  items.forEach((c, i) => {
    const imminent = isImminent(c);
    const edge = imminent ? cfg.colorImminent : cfg.colorFuture;
    const color = kindColor(c.kind);
    const cardH = heights[i];

    fillRound(ctx, PAD, y, CARD_W, cardH, 12, THEME.card);
    ctx.strokeStyle = THEME.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    fillRound(ctx, PAD, y, 4, cardH, 2, edge);

    // Badges : nature du changement, puis echeance
    let bx = PAD + 20;
    for (const [label, tint] of [
      [KIND_LABEL[c.kind] ?? "Info", color],
      [imminent ? "Aujourd'hui / demain" : "À venir", edge],
    ] as const) {
      ctx.font = "500 11px 'JetBrains Mono'";
      const text = label.toUpperCase();
      const bw = ctx.measureText(text).width + 18;
      fillRound(ctx, bx, y + 14, bw, 20, 10, withAlpha(tint, 0.16));
      ctx.fillStyle = tint;
      ctx.textAlign = "center";
      ctx.fillText(text, bx + bw / 2, y + 28);
      ctx.textAlign = "left";
      bx += bw + 6;
    }

    if (c.subject) {
      const dot = subjectColor(c.subject);
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(PAD + 25, y + 51, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = "800 16px Jakarta";
    ctx.fillStyle = THEME.text;
    ctx.fillText(c.title, PAD + (c.subject ? 36 : 20), y + 56);

    ctx.font = "400 14px Jakarta";
    ctx.fillStyle = THEME.textDim;
    let ly = y + 78;
    for (const line of wrapText(ctx, c.detail.replace(/\s+/g, " "), CARD_W - 44, 3)) {
      ctx.fillText(line, PAD + 20, ly);
      ly += 20;
    }

    y += cardH + 10;
  });

  if (changes.length > items.length) {
    ctx.font = "500 13px Jakarta";
    ctx.fillStyle = THEME.textFaint;
    ctx.fillText(`+ ${changes.length - items.length} autre(s) changement(s)`, PAD, y + 14);
  }

  drawFooter(ctx, W, H, new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }));
  return finishRender(canvas, `changements:${heading}`);
}
