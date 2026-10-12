import type { SKRSContext2D } from "@napi-rs/canvas";
import { THEME, subjectColor, withAlpha, useTheme } from "./theme.js";
import { createRenderCanvas, drawBackdrop, drawFooter, drawKicker, drawTitle, ellipsize, fillRound, finishRender, wrapText, timeLabel, dayLabel, sameDay } from "./util.js";
import type { FlatAssignment, FlatLesson } from "../types.js";
import { getConfig } from "../store/db.js";

const W = 1180;
const PAD = 28;
const HEADER_H = 124;
const GUTTER = 62;
const TT_W = 700;
const HW_X = PAD + GUTTER + TT_W + 24;
const HW_W = W - HW_X - PAD - 40;
const PX_PER_HOUR = 96;

export interface DayRenderOptions {
  date: Date;
  lessons: FlatLesson[];
  assignments: FlatAssignment[];
  studentName: string;
  className: string;
  /** Titre de la carte, ex "Ta journee" ou "Demain". */
  caption: string;
}

/**
 * Dessine l'emploi du temps d'une journee sous forme d'image PNG.
 * Les cours annules, les changements de salle et les statuts particuliers
 * (prof absent, classe absente) sont mis en evidence visuellement.
 */
export function renderDay(opts: DayRenderOptions): Buffer {
  // Le theme doit etre applique avant tout calcul de couleur.
  useTheme(getConfig().imageTheme.timetable);

  const lessons = opts.lessons
    .filter((l) => sameDay(l.start, opts.date))
    .sort((a, b) => a.start - b.start);

  const homework = opts.assignments
    .filter((h) => sameDay(h.deadline, opts.date))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  // Bornes horaires : on cadre sur la journee reelle, avec un repli 8h-18h.
  let firstHour = 8;
  let lastHour = 18;
  if (lessons.length) {
    firstHour = Math.floor(new Date(lessons[0].start).getHours());
    lastHour = Math.ceil(
      Math.max(...lessons.map((l) => new Date(l.end).getHours() + (new Date(l.end).getMinutes() > 0 ? 1 : 0))),
    );
    if (lastHour <= firstHour) lastHour = firstHour + 1;
  }

  const hours = lastHour - firstHour;
  const gridH = hours * PX_PER_HOUR;
  const hwH = estimateHomeworkHeight(homework);
  const bodyH = Math.max(gridH, hwH, 260);
  const H = HEADER_H + bodyH + PAD * 2 + 40;

  const { canvas, ctx } = createRenderCanvas(W, H);

  drawBackdrop(ctx, W, H, opts.date.getDate());

  drawHeader(ctx, opts, lessons);

  const top = HEADER_H + PAD;
  drawGrid(ctx, top, firstHour, hours);
  drawLessons(ctx, lessons, top, firstHour);
  drawHomeworkPanel(ctx, homework, top, bodyH);

  drawFooter(ctx, W, H, `PRONOTE · ${new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}`);

  return finishRender(canvas, `emploi-du-temps:${opts.caption}`);
}

function drawHeader(ctx: SKRSContext2D, opts: DayRenderOptions, lessons: FlatLesson[]): void {
  drawKicker(ctx, dayLabel(opts.date), PAD, 52);
  drawTitle(ctx, opts.caption, PAD, 92, 32, 640);

  ctx.font = "500 14px Jakarta";
  ctx.fillStyle = THEME.textDim;
  ctx.textAlign = "left";
  ctx.fillText([opts.studentName, opts.className].filter(Boolean).join("  ·  "), PAD, 114);

  // Pastilles de synthese a droite
  const canceled = lessons.filter((l) => l.canceled).length;
  const tests = lessons.filter((l) => l.test).length;
  const chips: Array<[string, string]> = [];
  chips.push([`${lessons.length} cours`, THEME.accent]);
  if (canceled) chips.push([`${canceled} annulé${canceled > 1 ? "s" : ""}`, THEME.danger]);
  if (tests) chips.push([`${tests} évaluation${tests > 1 ? "s" : ""}`, THEME.warn]);

  let x = W - PAD - 40;
  ctx.font = "500 12px 'JetBrains Mono'";
  for (const [label, color] of [...chips].reverse()) {
    const text = label.toUpperCase();
    const w = ctx.measureText(text).width + 26;
    x -= w;
    fillRound(ctx, x, 62, w, 28, 14, withAlpha(color, 0.14));
    ctx.strokeStyle = withAlpha(color, 0.45);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(text, x + w / 2, 80);
    ctx.textAlign = "left";
    x -= 8;
  }
}

function drawGrid(ctx: SKRSContext2D, top: number, firstHour: number, hours: number): void {
  ctx.textAlign = "right";
  for (let i = 0; i <= hours; i++) {
    const y = top + i * PX_PER_HOUR;

    ctx.strokeStyle = THEME.stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD + GUTTER, y + 0.5);
    ctx.lineTo(PAD + GUTTER + TT_W, y + 0.5);
    ctx.stroke();

    if (i < hours) {
      ctx.font = "600 13px Jakarta";
      ctx.fillStyle = THEME.textFaint;
      ctx.fillText(`${String(firstHour + i).padStart(2, "0")}:00`, PAD + GUTTER - 12, y + 16);
    }
  }
  ctx.textAlign = "left";
}

function drawLessons(
  ctx: SKRSContext2D,
  lessons: FlatLesson[],
  top: number,
  firstHour: number,
): void {
  if (!lessons.length) {
    ctx.font = "500 17px Jakarta";
    ctx.fillStyle = THEME.textFaint;
    ctx.textAlign = "center";
    ctx.fillText("Aucun cours ce jour", PAD + GUTTER + TT_W / 2, top + 120);
    ctx.textAlign = "left";
    return;
  }

  // Gestion des chevauchements : les cours qui se superposent sont
  // repartis en colonnes de largeur egale.
  const columns = assignColumns(lessons);

  for (const { lesson, col, total } of columns) {
    const startD = new Date(lesson.start);
    const endD = new Date(lesson.end);
    const startOffset = startD.getHours() + startD.getMinutes() / 60 - firstHour;
    const duration = (endD.getTime() - startD.getTime()) / 3600000;

    const colW = (TT_W - (total - 1) * 8) / total;
    const x = PAD + GUTTER + col * (colW + 8) + 6;
    const y = top + startOffset * PX_PER_HOUR + 3;
    const h = Math.max(duration * PX_PER_HOUR - 6, 44);
    const w = colW - 12;

    const color = subjectColor(lesson.subject, lesson.backgroundColor);
    const isOff = lesson.canceled || lesson.exempted;

    // Corps du bloc. Un cours annule perd sa teinte de matiere au profit
    // d'un gris neutre : l'inactivite se lit alors immediatement, sans
    // avoir a reperer le liseré pointillé.
    fillRound(ctx, x, y, w, h, 12, isOff ? THEME.panelAlt : withAlpha(color, 0.24));
    ctx.strokeStyle = isOff ? withAlpha(THEME.danger, 0.7) : withAlpha(color, 0.85);
    ctx.lineWidth = isOff ? 2 : 1.5;
    if (isOff) ctx.setLineDash([6, 4]);
    fillRoundStroke(ctx, x, y, w, h, 12);
    ctx.setLineDash([]);

    // Barre de matiere a gauche
    fillRound(ctx, x, y, 5, h, 3, isOff ? THEME.danger : color);

    const innerX = x + 16;
    const innerW = w - 26;
    let ty = y + 24;

    ctx.font = "700 16px Jakarta";
    ctx.fillStyle = isOff ? THEME.textDim : THEME.text;
    ctx.fillText(ellipsize(ctx, lesson.subject, innerW), innerX, ty);
    ty += 20;

    ctx.font = "500 13px Jakarta";
    ctx.fillStyle = THEME.textDim;
    ctx.fillText(`${timeLabel(lesson.start)} - ${timeLabel(lesson.end)}`, innerX, ty);
    ty += 18;

    if (h > 78) {
      const meta: string[] = [];
      if (lesson.rooms.length) meta.push(`Salle ${lesson.rooms.join(", ")}`);
      if (lesson.teachers.length) meta.push(lesson.teachers.join(", "));
      if (meta.length) {
        ctx.font = "400 13px Jakarta";
        ctx.fillStyle = THEME.textFaint;
        ctx.fillText(ellipsize(ctx, meta.join(" — "), innerW), innerX, ty);
        ty += 18;
      }
    }

    // Bandeaux d'alerte
    const flags: Array<[string, string]> = [];
    if (lesson.canceled) flags.push(["ANNULE", THEME.danger]);
    if (lesson.exempted) flags.push(["DISPENSE", THEME.warn]);
    if (lesson.status) flags.push([lesson.status.toUpperCase(), THEME.warn]);
    if (lesson.test) flags.push(["EVALUATION", THEME.accent]);

    if (flags.length && h > 60) {
      let fx = innerX;
      ctx.font = "700 11px Jakarta";
      for (const [label, color2] of flags) {
        const fw = ctx.measureText(label).width + 16;
        if (fx + fw > x + w - 10) break;
        fillRound(ctx, fx, ty - 11, fw, 20, 10, withAlpha(color2, 0.22));
        ctx.fillStyle = color2;
        ctx.textAlign = "center";
        ctx.fillText(label, fx + fw / 2, ty + 3);
        ctx.textAlign = "left";
        fx += fw + 6;
      }
    }
  }
}

function fillRoundStroke(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  const radius = Math.min(r, w / 2, h / 2);
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

/** Repartit les cours qui se chevauchent en colonnes distinctes. */
function assignColumns(
  lessons: FlatLesson[],
): Array<{ lesson: FlatLesson; col: number; total: number }> {
  const result: Array<{ lesson: FlatLesson; col: number; total: number }> = [];
  let cluster: FlatLesson[] = [];
  let clusterEnd = -Infinity;

  const flush = (): void => {
    if (!cluster.length) return;
    const cols: number[] = [];
    const placed = cluster.map((l) => {
      let col = cols.findIndex((end) => end <= l.start);
      if (col === -1) {
        col = cols.length;
        cols.push(l.end);
      } else {
        cols[col] = l.end;
      }
      return { lesson: l, col };
    });
    for (const p of placed) result.push({ ...p, total: cols.length });
    cluster = [];
  };

  for (const l of lessons) {
    if (l.start >= clusterEnd) {
      flush();
      clusterEnd = l.end;
    } else {
      clusterEnd = Math.max(clusterEnd, l.end);
    }
    cluster.push(l);
  }
  flush();
  return result;
}

function estimateHomeworkHeight(homework: FlatAssignment[]): number {
  return 60 + homework.length * 92;
}

function drawHomeworkPanel(
  ctx: SKRSContext2D,
  homework: FlatAssignment[],
  top: number,
  bodyH: number,
): void {
  fillRound(ctx, HW_X, top, HW_W, bodyH, 16, THEME.panel);
  ctx.strokeStyle = THEME.stroke;
  ctx.lineWidth = 1;
  fillRoundStroke(ctx, HW_X, top, HW_W, bodyH, 16);

  ctx.font = "700 17px Jakarta";
  ctx.fillStyle = THEME.text;
  ctx.textAlign = "left";
  ctx.fillText("Devoirs", HW_X + 18, top + 32);

  const doneCount = homework.filter((h) => h.done).length;
  ctx.font = "500 13px Jakarta";
  ctx.fillStyle = THEME.textFaint;
  ctx.textAlign = "right";
  ctx.fillText(`${doneCount}/${homework.length} fait(s)`, HW_X + HW_W - 18, top + 32);
  ctx.textAlign = "left";

  if (!homework.length) {
    ctx.font = "500 15px Jakarta";
    ctx.fillStyle = THEME.textFaint;
    ctx.textAlign = "center";
    ctx.fillText("Rien a rendre", HW_X + HW_W / 2, top + 90);
    ctx.textAlign = "left";
    return;
  }

  let y = top + 54;
  for (const hw of homework) {
    if (y + 86 > top + bodyH - 8) break;
    const color = subjectColor(hw.subject, hw.backgroundColor);

    fillRound(ctx, HW_X + 12, y, HW_W - 24, 82, 12, THEME.panelAlt);
    fillRound(ctx, HW_X + 12, y, 4, 82, 2, color);

    // Case a cocher
    const cbX = HW_X + 26;
    const cbY = y + 14;
    if (hw.done) {
      fillRound(ctx, cbX, cbY, 18, 18, 5, THEME.good);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cbX + 4.5, cbY + 9);
      ctx.lineTo(cbX + 7.8, cbY + 12.6);
      ctx.lineTo(cbX + 13.5, cbY + 5.4);
      ctx.stroke();
    } else {
      ctx.strokeStyle = THEME.textFaint;
      ctx.lineWidth = 1.8;
      fillRoundStroke(ctx, cbX, cbY, 18, 18, 5);
    }

    ctx.font = "700 14px Jakarta";
    ctx.fillStyle = hw.done ? THEME.textDim : color;
    ctx.fillText(ellipsize(ctx, hw.subject, HW_W - 90), cbX + 28, cbY + 14);

    ctx.font = "400 12.5px Jakarta";
    ctx.fillStyle = hw.done ? THEME.textFaint : THEME.textDim;
    const clean = hw.description.replace(/\s+/g, " ").trim();
    const lines = wrapText(ctx, clean, HW_W - 76, 2);
    let ly = y + 50;
    for (const line of lines) {
      ctx.fillText(line, cbX + 28, ly);
      ly += 16;
    }

    y += 92;
  }
}
