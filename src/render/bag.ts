import type { SKRSContext2D } from "@napi-rs/canvas";
import { THEME, subjectColor, useTheme, withAlpha, subjectKey } from "./theme.js";
import { createRenderCanvas, drawBackdrop, drawFooter, drawKicker, drawTitle, ellipsize, fillRound, finishRender } from "./util.js";
import { getConfig } from "../store/db.js";

const W = 900;
const PAD = 26;
const ROW_H = 34;
const HEADER_H = 132;

export interface BagRenderOptions {
  /** Matieres de la journee, dans l'ordre des cours. */
  subjects: string[];
  /** Etat de validation, meme longueur que `subjects`. */
  checked: boolean[];
  /** Index de l'etape en cours, ou >= subjects.length si terminee. */
  current: number;
  dateLabel: string;
  studentName: string;
}

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

function drawCheck(ctx: SKRSContext2D, x: number, y: number, size: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = size / 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + size * 0.24, y + size * 0.52);
  ctx.lineTo(x + size * 0.42, y + size * 0.72);
  ctx.lineTo(x + size * 0.76, y + size * 0.28);
  ctx.stroke();
  ctx.lineCap = "butt";
}

/**
 * Checklist du sac. Contrairement a la carte Discord, l'image affiche les
 * couleurs hexadecimales exactes configurees par l'utilisateur : Discord ne
 * sait pas colorer du texte en hex arbitraire, le canvas si.
 */
export function renderBag(opts: BagRenderOptions): Buffer {
  const cfg = getConfig();
  useTheme(cfg.imageTheme.bag);

  const blocks = opts.subjects.map((subject) => ({
    subject,
    items: cfg.bag[subjectKey(subject)] ?? [],
  }));

  // Hauteur : un en-tete de matiere + une ligne par element (min 1 ligne
  // pour afficher le message "aucun materiel configure").
  const heights = blocks.map((b) => 44 + Math.max(b.items.length, 1) * ROW_H + 14);
  const bodyH = heights.reduce((a, b) => a + b + 10, 0);
  const H = HEADER_H + bodyH + PAD + 60;

  const { canvas, ctx } = createRenderCanvas(W, H);
  drawBackdrop(ctx, W, H, 5);

  const doneCount = opts.checked.filter(Boolean).length;
  const total = opts.subjects.length;
  const finished = opts.current >= total;

  // --- En-tete ---
  drawKicker(ctx, opts.dateLabel, PAD, 52);
  drawTitle(ctx, "Mon sac", PAD, 92, 32);
  ctx.font = "500 14px Jakarta";
  ctx.fillStyle = THEME.textDim;
  ctx.textAlign = "left";
  ctx.fillText(opts.studentName, PAD, 114);

  // Compteur + barre de progression
  const right = W - PAD - 40;
  ctx.textAlign = "right";
  ctx.font = "800 22px Jakarta";
  ctx.fillStyle = finished && doneCount === total ? THEME.good : THEME.accent;
  ctx.fillText(`${doneCount}/${total}`, right, 84);
  ctx.textAlign = "left";

  const barW = 200;
  const barX = right - barW;
  fillRound(ctx, barX, 98, barW, 8, 4, THEME.panelAlt);
  if (doneCount > 0) {
    fillRound(
      ctx,
      barX,
      98,
      Math.max((barW * doneCount) / total, 8),
      8,
      4,
      doneCount === total ? THEME.good : THEME.accent,
    );
  }

  // --- Blocs par matiere ---
  let y = HEADER_H;

  blocks.forEach((block, i) => {
    const isDone = opts.checked[i];
    const isCurrent = i === opts.current && !finished;
    const color = subjectColor(block.subject);
    // Une matiere depassee sans validation a ete volontairement passee :
    // on la distingue de celles pas encore traitees.
    const skipped = !isDone && !isCurrent && i < opts.current;
    const blockH = heights[i];

    // Fond : l'etape courante est mise en avant, les etapes non traitees
    // restent neutres, les validees prennent une teinte verte discrete.
    const bgFill = isCurrent
      ? withAlpha(color, 0.14)
      : isDone
        ? withAlpha(THEME.good, 0.09)
        : THEME.card;
    fillRound(ctx, PAD, y, W - PAD * 2 - 40, blockH, 12, bgFill);

    if (isCurrent) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      stroked(ctx, PAD, y, W - PAD * 2 - 40, blockH, 13);
    } else {
      ctx.strokeStyle = THEME.stroke;
      ctx.lineWidth = 1;
      stroked(ctx, PAD, y, W - PAD * 2 - 40, blockH, 13);
    }

    fillRound(ctx, PAD, y, 5, blockH, 3, isDone ? THEME.good : color);

    // Case a cocher de la matiere
    const cbX = PAD + 20;
    const cbY = y + 15;
    if (isDone) {
      fillRound(ctx, cbX, cbY, 20, 20, 6, THEME.good);
      drawCheck(ctx, cbX, cbY, 20, "#ffffff");
    } else {
      ctx.strokeStyle = isCurrent ? color : skipped ? THEME.warn : THEME.textFaint;
      ctx.lineWidth = 2;
      stroked(ctx, cbX, cbY, 20, 20, 6);
    }

    ctx.font = "700 16px Jakarta";
    ctx.fillStyle = isDone ? THEME.textDim : isCurrent ? color : THEME.text;
    ctx.fillText(ellipsize(ctx, block.subject, W - 260), cbX + 32, y + 30);

    // Badge d'etat
    const badge = isDone
      ? "DANS LE SAC"
      : isCurrent
        ? "À PRÉPARER"
        : skipped
          ? "PASSÉ"
          : "EN ATTENTE";
    const badgeColor = isDone ? THEME.good : isCurrent ? color : skipped ? THEME.warn : THEME.textFaint;
    ctx.font = "500 10.5px 'JetBrains Mono'";
    const bw = ctx.measureText(badge).width + 18;
    fillRound(ctx, W - PAD - 40 - bw - 14, y + 15, bw, 20, 10, withAlpha(badgeColor, 0.2));
    ctx.fillStyle = badgeColor;
    ctx.textAlign = "center";
    ctx.fillText(badge, W - PAD - 40 - bw / 2 - 14, y + 29);
    ctx.textAlign = "left";

    // Elements du sac
    let ry = y + 52;
    if (!block.items.length) {
      ctx.font = "400 13px Jakarta";
      ctx.fillStyle = THEME.textFaint;
      ctx.fillText("Aucun matériel configuré — /sac ajouter ou panneau web", cbX + 32, ry + 16);
    } else {
      for (const item of block.items) {
        // Pastille a la couleur hexadecimale exacte de l'utilisateur.
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(cbX + 40, ry + 12, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = withAlpha(THEME.text, 0.25);
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.font = isDone ? "400 14px Jakarta" : "500 14px Jakarta";
        ctx.fillStyle = isDone ? THEME.textDim : THEME.text;
        const label = ellipsize(ctx, item.label, W - 320);
        ctx.fillText(label, cbX + 56, ry + 17);

        // Le hex reste lisible a cote du libelle.
        const labelW = ctx.measureText(label).width;
        ctx.font = "400 11.5px 'JetBrains Mono'";
        ctx.fillStyle = THEME.textFaint;
        ctx.fillText(item.color, cbX + 66 + labelW, ry + 17);

        ry += ROW_H;
      }
    }

    y += blockH + 10;
  });

  drawFooter(
    ctx,
    W,
    H,
    finished ? (doneCount === total ? "Tout est validé" : "Sac incomplet") : "Valide chaque matière avec les boutons",
  );

  return finishRender(canvas, "sac");
}
