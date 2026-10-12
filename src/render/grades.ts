import type { SKRSContext2D } from "@napi-rs/canvas";
import { THEME, subjectColor, withAlpha, useTheme } from "./theme.js";
import { createRenderCanvas, drawBackdrop, drawFooter, drawKicker, drawTitle, ellipsize, fillRound, finishRender } from "./util.js";
import type { FlatAverage, FlatGrade } from "../types.js";
import { getConfig } from "../store/db.js";

const W = 1080;
const PAD = 28;

function stroked(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.stroke();
}

export interface GradesRenderOptions {
  periodName: string;
  overallAverage: number | null;
  averages: FlatAverage[];
  recentGrades: FlatGrade[];
  /** Note mise en avant (nouvelle note qui declenche la notification). */
  highlightGradeId?: string;
  studentName: string;
}

/** Carte de synthese des notes : moyenne generale, par matiere, dernieres notes. */
export function renderGrades(opts: GradesRenderOptions): Buffer {
  useTheme(getConfig().imageTheme.grades);

  const averages = opts.averages
    .filter((a) => a.student !== null)
    .sort((a, b) => (b.student ?? 0) - (a.student ?? 0));

  const recent = opts.recentGrades.slice(0, 8);

  const avgBlockH = 92 + averages.length * 44 + 20;
  const recentBlockH = 92 + recent.length * 54 + 20;
  const H = 170 + Math.max(avgBlockH, recentBlockH) + PAD + 30;

  const { canvas, ctx } = createRenderCanvas(W, H);
  drawBackdrop(ctx, W, H, 3);

  // --- En-tete ---
  drawKicker(ctx, opts.periodName, PAD, 52);
  drawTitle(ctx, "Bulletin", PAD, 92, 32);
  ctx.font = "500 14px Jakarta";
  ctx.fillStyle = THEME.textDim;
  ctx.fillText(opts.studentName, PAD, 116);

  // Moyenne generale, en grand a droite
  if (opts.overallAverage !== null) {
    const value = opts.overallAverage;
    const color = value >= 14 ? THEME.good : value >= 10 ? THEME.warn : THEME.danger;
    const boxW = 200;
    const boxX = W - PAD - boxW - 40;
    fillRound(ctx, boxX, 40, boxW, 80, 12, withAlpha(color, 0.12));
    ctx.strokeStyle = withAlpha(color, 0.5);
    ctx.lineWidth = 1.5;
    stroked(ctx, boxX, 40, boxW, 80, 12);

    ctx.textAlign = "center";
    ctx.font = "500 11px 'JetBrains Mono'";
    ctx.fillStyle = THEME.textDim;
    ctx.fillText("MOYENNE GÉNÉRALE", boxX + boxW / 2, 64);
    ctx.font = "800 36px Jakarta";
    ctx.fillStyle = color;
    ctx.fillText(`${value.toFixed(2)}`, boxX + boxW / 2, 106);
    ctx.textAlign = "left";
  }

  const top = 146;
  const colW = (W - PAD * 2 - 24 - 40) / 2;

  drawAverages(ctx, averages, PAD, top, colW, avgBlockH);
  drawRecent(ctx, recent, PAD + colW + 24, top, colW, recentBlockH, opts.highlightGradeId);

  drawFooter(ctx, W, H, `PRONOTE · ${new Date().toLocaleDateString("fr-FR")}`);
  return finishRender(canvas, "notes");
}

function drawAverages(
  ctx: SKRSContext2D,
  averages: FlatAverage[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  fillRound(ctx, x, y, w, h, 12, THEME.card);
  ctx.strokeStyle = THEME.stroke;
  ctx.lineWidth = 1;
  stroked(ctx, x, y, w, h, 16);

  ctx.font = "700 16px Jakarta";
  ctx.fillStyle = THEME.text;
  ctx.fillText("Moyennes par matière", x + 18, y + 32);

  if (!averages.length) {
    ctx.font = "500 14px Jakarta";
    ctx.fillStyle = THEME.textFaint;
    ctx.fillText("Aucune moyenne disponible", x + 18, y + 66);
    return;
  }

  let ly = y + 62;
  for (const a of averages) {
    const color = subjectColor(a.subject);
    const outOf = a.outOf ?? 20;
    const ratio = Math.max(0, Math.min(1, (a.student ?? 0) / outOf));

    ctx.font = "600 13.5px Jakarta";
    ctx.fillStyle = THEME.text;
    ctx.fillText(ellipsize(ctx, a.subject, w - 190), x + 18, ly);

    ctx.textAlign = "right";
    ctx.font = "700 13.5px Jakarta";
    ctx.fillStyle = color;
    ctx.fillText(`${(a.student ?? 0).toFixed(2)}/${outOf}`, x + w - 18, ly);

    if (a.classAverage !== null) {
      ctx.font = "400 11px Jakarta";
      ctx.fillStyle = THEME.textFaint;
      ctx.fillText(`classe ${a.classAverage.toFixed(2)}`, x + w - 18, ly + 15);
    }
    ctx.textAlign = "left";

    // Barre de progression
    const barY = ly + 8;
    const barW = w - 190;
    fillRound(ctx, x + 18, barY, barW, 6, 3, THEME.panelAlt);
    fillRound(ctx, x + 18, barY, Math.max(barW * ratio, 4), 6, 3, color);

    ly += 44;
  }
}

function drawRecent(
  ctx: SKRSContext2D,
  grades: FlatGrade[],
  x: number,
  y: number,
  w: number,
  h: number,
  highlightId?: string,
): void {
  fillRound(ctx, x, y, w, h, 12, THEME.card);
  ctx.strokeStyle = THEME.stroke;
  ctx.lineWidth = 1;
  stroked(ctx, x, y, w, h, 16);

  ctx.font = "700 16px Jakarta";
  ctx.fillStyle = THEME.text;
  ctx.fillText("Dernières notes", x + 18, y + 32);

  if (!grades.length) {
    ctx.font = "500 14px Jakarta";
    ctx.fillStyle = THEME.textFaint;
    ctx.fillText("Aucune note pour l'instant", x + 18, y + 66);
    return;
  }

  let ly = y + 54;
  for (const g of grades) {
    const color = subjectColor(g.subject);
    const isNew = highlightId && g.id === highlightId;

    if (isNew) {
      fillRound(ctx, x + 10, ly - 6, w - 20, 50, 9, withAlpha(THEME.accent, 0.16));
    }

    fillRound(ctx, x + 18, ly + 2, 4, 38, 2, color);

    ctx.font = "600 13px Jakarta";
    ctx.fillStyle = THEME.text;
    ctx.fillText(ellipsize(ctx, g.subject, w - 180), x + 32, ly + 12);

    // Nom de l'evaluation ("DS sur les suites", "Interro chapitre 3"...).
    // C'est l'information la plus utile pour situer la note ; on la met
    // en avant et on repousse date/coefficient en dessous.
    ctx.font = "500 11.5px Jakarta";
    ctx.fillStyle = THEME.textDim;
    const evalName = g.comment?.replace(/\s+/g, " ").trim();
    ctx.fillText(
      ellipsize(ctx, evalName || "Sans intitulé", w - 180),
      x + 32,
      ly + 26,
    );

    ctx.font = "400 10.5px Jakarta";
    ctx.fillStyle = THEME.textFaint;
    const date = new Date(g.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    ctx.fillText(`${date}  •  coef ${g.coefficient}`, x + 32, ly + 39);

    ctx.textAlign = "right";
    ctx.font = "700 15px Jakarta";
    if (g.value === null || g.outOf === null) {
      ctx.fillStyle = THEME.textFaint;
      ctx.fillText("N.N.", x + w - 18, ly + 24);
    } else {
      const norm = (g.value / g.outOf) * 20;
      ctx.fillStyle = norm >= 14 ? THEME.good : norm >= 10 ? THEME.warn : THEME.danger;
      ctx.fillText(`${g.value}/${g.outOf}`, x + w - 18, ly + 24);
    }
    ctx.textAlign = "left";

    ly += 54;
  }
}
