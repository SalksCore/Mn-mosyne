import type { SKRSContext2D } from "@napi-rs/canvas";
import { THEME, contrastText, useTheme, withAlpha } from "./theme.js";
import { createRenderCanvas, drawBackdrop, drawFooter, drawKicker, drawTitle, ellipsize, fillRound, finishRender, wrapText } from "./util.js";
import { getConfig } from "../store/db.js";
import type { Plan, PlanOption } from "../transport/plan.js";
import type { Disruption, Journey } from "../transport/types.js";

const W = 1000;
const PAD = 28;
const INNER = W - PAD * 2 - 40;

const hm = (d: Date): string => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Pastille de ligne aux couleurs officielles publiees par le reseau. */
function lineBadge(ctx: SKRSContext2D, j: Journey, x: number, y: number, h = 30): number {
  const bg = j.line.color ?? THEME.accent;
  const fg = j.line.textColor ?? contrastText(bg);
  ctx.font = `800 ${Math.round(h * 0.52)}px Jakarta`;
  const label = j.line.short;
  const w = Math.max(h, ctx.measureText(label).width + h * 0.6);
  fillRound(ctx, x, y, w, h, j.mode === "Bus" ? h / 2 : 7, bg);
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.fillText(label, x + w / 2, y + h * 0.69);
  ctx.textAlign = "left";
  return w;
}

function stateOf(o: PlanOption): { text: string; color: string } {
  const j = o.journey;
  if (j.cancelled) return { text: "SUPPRIMÉ", color: THEME.danger };
  if (!o.viable) return { text: (o.issue ?? "Indisponible").toUpperCase(), color: THEME.textFaint };
  if (j.delayMinutes !== null && j.delayMinutes >= 2) return { text: `+${j.delayMinutes} MIN`, color: THEME.warn };
  if (j.realtime) return { text: "À L'HEURE", color: THEME.good };
  return { text: "THÉORIQUE", color: THEME.textDim };
}

/** Fiche de trajet : heure de depart en grand, trajet detaille, options. */
export function renderTransport(plan: Plan, title: string): Buffer {
  useTheme(getConfig().imageTheme.transport);
  const best = plan.best;
  const rows = plan.options.slice(0, 6);
  const H = 340 + Math.max(rows.length, 1) * 58 + 40;

  const { canvas, ctx } = createRenderCanvas(W, H);
  drawBackdrop(ctx, W, H, 9);

  const kicker = plan.kind === "morning" ? "Trajet du matin" : "Retour";
  drawKicker(ctx, `${kicker} · ${plan.network.name}`, PAD, 52);
  drawTitle(ctx, title, PAD, 94, 32, 560);

  ctx.font = "500 14px Jakarta";
  ctx.fillStyle = THEME.textDim;
  const sub =
    plan.kind === "morning"
      ? plan.firstLesson
        ? `Premier cours : ${plan.firstLesson.subject} à ${hm(new Date(plan.firstLesson.start))}${plan.deadline ? ` · à l'arrivée au plus tard ${hm(plan.deadline)}` : ""}`
        : "Aucun cours ce jour"
      : plan.lastLesson
        ? `Fin des cours : ${hm(new Date(plan.lastLesson.end))}`
        : "Prochains départs";
  ctx.fillText(ellipsize(ctx, sub, 600), PAD, 120);

  // Heure de depart, l'information decisive.
  const boxW = 230;
  const boxX = PAD + INNER - boxW;
  const tint = best ? THEME.accent : THEME.danger;
  fillRound(ctx, boxX, 38, boxW, 92, 12, withAlpha(tint, 0.12));
  ctx.strokeStyle = withAlpha(tint, 0.55);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = "500 11px 'JetBrains Mono'";
  ctx.fillStyle = THEME.textDim;
  ctx.fillText(best ? "QUITTE LES LIEUX À" : "AUCUN PASSAGE", boxX + boxW / 2, 62);
  ctx.font = "800 44px Jakarta";
  ctx.fillStyle = tint;
  ctx.fillText(best ? hm(best.leaveAt) : "—", boxX + boxW / 2, 112);
  ctx.textAlign = "left";

  // Frise du trajet retenu : depart -> arret -> ligne -> arret -> arrivee.
  const ty = 156;
  fillRound(ctx, PAD, ty, INNER, 130, 12, THEME.card);
  ctx.strokeStyle = THEME.stroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (best) {
    const j = best.journey;
    const from = plan.kind === "morning" ? "Maison" : "Établissement";
    const to = plan.kind === "morning" ? "Établissement" : "Maison";
    const stations: Array<[string, string, string]> = [
      [hm(best.leaveAt), from, ""],
      [hm(j.departure), j.fromStop.name, j.delayMinutes ? `${j.delayMinutes > 0 ? "+" : ""}${j.delayMinutes} min` : ""],
      [hm(j.arrival), j.toStop.name, ""],
      [hm(best.arriveAt), to, best.marginMinutes !== null ? `${best.marginMinutes} min d'avance` : ""],
    ];
    const x0 = PAD + 40;
    const x1 = PAD + INNER - 40;
    const step = (x1 - x0) / 3;
    const ly = ty + 46;

    for (let i = 0; i < 3; i++) {
      const a = x0 + i * step;
      const b = a + step;
      if (i === 1) {
        ctx.strokeStyle = j.line.color ?? THEME.accent;
        ctx.lineWidth = 6;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = THEME.strokeStrong;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([3, 6]);
      }
      ctx.beginPath();
      ctx.moveTo(a, ly);
      ctx.lineTo(b, ly);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "500 12px Jakarta";
      ctx.fillStyle = THEME.textDim;
      ctx.textAlign = "center";
      if (i === 1) {
        const ride = Math.round((j.arrival.getTime() - j.departure.getTime()) / 60000);
        ctx.font = "800 15px Jakarta";
        const bw = Math.max(30, ctx.measureText(j.line.short).width + 18);
        lineBadge(ctx, j, (a + b) / 2 - bw / 2, ly - 38, 26);
        ctx.font = "500 12px Jakarta";
        ctx.fillStyle = THEME.textDim;
        ctx.textAlign = "center";
        ctx.fillText(`${j.mode} · ${ride} min · vers ${ellipsize(ctx, j.headsign, step - 120)}`, (a + b) / 2, ly + 24);
      } else {
        const walk = i === 0 ? j.walkTo : j.walkFrom;
        ctx.fillText(`à pied · ${walk} min`, (a + b) / 2, ly - 12);
      }
      ctx.textAlign = "left";
    }

    stations.forEach(([time, name, note], i) => {
      const x = x0 + i * step;
      ctx.fillStyle = THEME.card;
      ctx.beginPath();
      ctx.arc(x, ly, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = i === 0 || i === 3 ? THEME.accent : (j.line.color ?? THEME.accent);
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.font = "800 17px Jakarta";
      ctx.fillStyle = THEME.text;
      ctx.fillText(time, x, ly + 52);
      ctx.font = "500 12px Jakarta";
      ctx.fillStyle = THEME.textDim;
      ctx.fillText(ellipsize(ctx, name, step - 16), x, ly + 70);
      if (note) {
        ctx.font = "500 10.5px 'JetBrains Mono'";
        ctx.fillStyle = i === 1 ? THEME.warn : THEME.good;
        ctx.fillText(note.toUpperCase(), x, ly - 18);
      }
      ctx.textAlign = "left";
    });
  } else {
    ctx.font = "600 16px Jakarta";
    ctx.fillStyle = THEME.textDim;
    ctx.textAlign = "center";
    ctx.fillText(
      plan.kind === "morning" && !plan.firstLesson ? "Pas de cours : rien à prévoir." : "Aucun passage direct ne convient. Regarde les itinéraires de repli.",
      PAD + INNER / 2,
      ty + 72,
    );
    ctx.textAlign = "left";
  }

  // Liste des passages
  let y = 310;
  ctx.font = "500 11px 'JetBrains Mono'";
  ctx.fillStyle = THEME.textFaint;
  ctx.fillText("PASSAGES", PAD, y);
  y += 12;
  if (!rows.length) {
    ctx.font = "500 14px Jakarta";
    ctx.fillStyle = THEME.textFaint;
    ctx.fillText("Aucun passage dans la fenêtre étudiée.", PAD, y + 30);
  }
  for (const o of rows) {
    const j = o.journey;
    const chosen = o === best;
    fillRound(ctx, PAD, y, INNER, 50, 10, chosen ? withAlpha(THEME.accent, 0.1) : THEME.card);
    ctx.strokeStyle = chosen ? withAlpha(THEME.accent, 0.6) : THEME.stroke;
    ctx.lineWidth = chosen ? 1.5 : 1;
    ctx.stroke();

    const bw = lineBadge(ctx, j, PAD + 14, y + 11, 28);
    ctx.font = "800 17px Jakarta";
    ctx.fillStyle = o.viable ? THEME.text : THEME.textFaint;
    ctx.fillText(`${hm(j.departure)}  →  ${hm(j.arrival)}`, PAD + 26 + bw, y + 31);
    ctx.font = "500 13px Jakarta";
    ctx.fillStyle = THEME.textDim;
    ctx.fillText(ellipsize(ctx, `vers ${j.headsign} · partir à ${hm(o.leaveAt)}`, 330), PAD + 190 + bw, y + 31);

    const st = stateOf(o);
    ctx.font = "500 11px 'JetBrains Mono'";
    const sw = ctx.measureText(st.text).width + 18;
    fillRound(ctx, PAD + INNER - sw - 14, y + 15, sw, 20, 10, withAlpha(st.color, 0.15));
    ctx.fillStyle = st.color;
    ctx.textAlign = "center";
    ctx.fillText(st.text, PAD + INNER - sw / 2 - 14, y + 29);
    ctx.textAlign = "left";
    if (chosen) {
      ctx.font = "500 10px 'JetBrains Mono'";
      ctx.fillStyle = THEME.accent;
      ctx.textAlign = "right";
      ctx.fillText("RETENU", PAD + INNER - sw - 24, y + 29);
      ctx.textAlign = "left";
    }
    y += 58;
  }

  const realtime = rows.some((o) => o.journey.realtime);
  drawFooter(ctx, W, H, `${plan.network.name} · ${realtime ? "temps réel" : "horaires théoriques"}`);
  return finishRender(canvas, "transport");
}

/** Messages de perturbation du reseau. */
export function renderDisruptions(items: Disruption[], networkName: string): Buffer {
  useTheme(getConfig().imageTheme.transport);
  const list = items.slice(0, 6);
  const probe = createRenderCanvas(W, 10).ctx;
  probe.font = "400 14px Jakarta";
  const heights = list.map((d) => 58 + wrapText(probe, d.detail, INNER - 40, 4).length * 20);
  const H = 150 + heights.reduce((a, b) => a + b + 10, 0) + 40;

  const { canvas, ctx } = createRenderCanvas(W, H);
  drawBackdrop(ctx, W, H, 13);
  drawKicker(ctx, `Perturbations · ${networkName}`, PAD, 52, THEME.warn);
  drawTitle(ctx, "Info trafic", PAD, 94, 32);

  let y = 124;
  list.forEach((d, i) => {
    const h = heights[i];
    fillRound(ctx, PAD, y, INNER, h, 12, THEME.card);
    ctx.strokeStyle = THEME.stroke;
    ctx.stroke();
    fillRound(ctx, PAD, y, 4, h, 2, THEME.warn);
    ctx.font = "500 11px 'JetBrains Mono'";
    ctx.fillStyle = THEME.warn;
    ctx.fillText(d.lines.length ? `LIGNE${d.lines.length > 1 ? "S" : ""} ${d.lines.join(", ")}` : "RÉSEAU", PAD + 20, y + 26);
    ctx.font = "800 16px Jakarta";
    ctx.fillStyle = THEME.text;
    ctx.fillText(ellipsize(ctx, d.summary, INNER - 40), PAD + 20, y + 48);
    ctx.font = "400 14px Jakarta";
    ctx.fillStyle = THEME.textDim;
    let ly = y + 70;
    for (const line of wrapText(ctx, d.detail, INNER - 40, 4)) {
      ctx.fillText(line, PAD + 20, ly);
      ly += 20;
    }
    y += h + 10;
  });

  drawFooter(ctx, W, H, `${networkName} · GTFS-RT`);
  return finishRender(canvas, "perturbations");
}

/** Itineraires de repli, toutes lignes confondues. */
export function renderAlternatives(alts: Journey[], reason: string, deadline: Date | null, networkName: string): Buffer {
  useTheme(getConfig().imageTheme.transport);
  const list = alts.slice(0, 6);
  const H = 190 + Math.max(list.length, 1) * 74 + 40;
  const { canvas, ctx } = createRenderCanvas(W, H);
  drawBackdrop(ctx, W, H, 17);
  drawKicker(ctx, `Plan B · ${networkName}`, PAD, 52, THEME.warn);
  drawTitle(ctx, "Itinéraires de repli", PAD, 94, 32);
  ctx.font = "500 14px Jakarta";
  ctx.fillStyle = THEME.textDim;
  ctx.fillText(ellipsize(ctx, reason, INNER), PAD, 120);

  let y = 146;
  if (!list.length) {
    ctx.font = "600 15px Jakarta";
    ctx.fillStyle = THEME.textFaint;
    ctx.fillText("Aucune liaison directe trouvée dans un rayon accessible à pied.", PAD, y + 30);
  }
  for (const j of list) {
    const arrive = new Date(j.arrival.getTime() + j.walkFrom * 60000);
    const leave = new Date(j.departure.getTime() - j.walkTo * 60000);
    const late = deadline ? Math.floor((deadline.getTime() - arrive.getTime()) / 60000) : null;
    fillRound(ctx, PAD, y, INNER, 64, 10, THEME.card);
    ctx.strokeStyle = THEME.stroke;
    ctx.stroke();
    const bw = lineBadge(ctx, j, PAD + 14, y + 17, 30);
    ctx.font = "800 16px Jakarta";
    ctx.fillStyle = THEME.text;
    ctx.fillText(`Partir à ${hm(leave)} · arrivée ${hm(arrive)}`, PAD + 28 + bw, y + 28);
    ctx.font = "500 12.5px Jakarta";
    ctx.fillStyle = THEME.textDim;
    ctx.fillText(
      ellipsize(ctx, `${j.walkTo} min à pied → ${j.fromStop.name} (${hm(j.departure)}) → ${j.toStop.name} → ${j.walkFrom} min à pied`, INNER - bw - 200),
      PAD + 28 + bw,
      y + 48,
    );
    if (late !== null) {
      const text = late >= 0 ? `${late} MIN D'AVANCE` : `${-late} MIN DE RETARD`;
      const color = late >= 0 ? THEME.good : THEME.danger;
      ctx.font = "500 11px 'JetBrains Mono'";
      const sw = ctx.measureText(text).width + 18;
      fillRound(ctx, PAD + INNER - sw - 14, y + 22, sw, 20, 10, withAlpha(color, 0.15));
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.fillText(text, PAD + INNER - sw / 2 - 14, y + 36);
      ctx.textAlign = "left";
    }
    y += 74;
  }

  drawFooter(ctx, W, H, "Liaisons directes · arrêts à moins de 900 m");
  return finishRender(canvas, "alternatives");
}
