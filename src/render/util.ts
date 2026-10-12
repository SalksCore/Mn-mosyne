import { createCanvas, GlobalFonts, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEME, withAlpha } from "./theme.js";

/**
 * Polices embarquees : les serveurs n'ont pas toujours de police systeme
 * (images avec des carres a la place du texte). Plus Jakarta Sans pour le
 * texte, JetBrains Mono pour les surtitres, comme sur le site.
 */
const FONTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
GlobalFonts.registerFromPath(path.join(FONTS, "PlusJakartaSans.ttf"), "Jakarta");
GlobalFonts.registerFromPath(path.join(FONTS, "JetBrainsMono.ttf"), "JetBrains Mono");

export const GREEK_NAME = "ΜΝΗΜΟΣΥΝΗ";

export function createRenderCanvas(
  width: number,
  height: number,
): { canvas: Canvas; ctx: SKRSContext2D } {
  const canvas = createCanvas(width * 2, height * 2);
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  return { canvas, ctx };
}

export function finishRender(canvas: Canvas, name: string): Buffer {
  const buffer = canvas.toBuffer("image/png");
  console.log(`[render] ${name} ${canvas.width}x${canvas.height}px ${buffer.length} octets`);
  return buffer;
}

export function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
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
}

export function fillRound(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
): void {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

/** Tronque avec une ellipse si le texte depasse la largeur disponible. */
export function ellipsize(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}...`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}...`;
}

/** Decoupe un texte en lignes tenant dans maxWidth, limite a maxLines. */
export function wrapText(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === maxLines) {
    lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1], maxWidth);
  }
  return lines;
}

export const HOUR_MS = 3600 * 1000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sameDay(a: number, b: Date): boolean {
  const d = new Date(a);
  return (
    d.getFullYear() === b.getFullYear() &&
    d.getMonth() === b.getMonth() &&
    d.getDate() === b.getDate()
  );
}

export const timeLabel = (ts: number): string =>
  new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export const dayLabel = (d: Date): string =>
  d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

// ----------------------------------------------------- couche pantheon

/** Generateur pseudo-aleatoire deterministe : meme image a chaque rendu. */
function prng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Frise de grecques (meandre) posee sur un filet, comme sur le site. */
export function drawMeander(ctx: SKRSContext2D, x: number, y: number, w: number, h = 12, step = 20, alpha = 0.28): void {
  ctx.save();
  ctx.strokeStyle = withAlpha(THEME.accent, alpha);
  ctx.lineWidth = 1.4;
  ctx.lineCap = "square";
  const u = step / 6;
  const k = h / 4;
  for (let px = x; px < x + w - step / 2; px += step) {
    ctx.beginPath();
    ctx.moveTo(px, y + h);
    ctx.lineTo(px, y);
    ctx.lineTo(px + 4 * u, y);
    ctx.lineTo(px + 4 * u, y + 3 * k);
    ctx.lineTo(px + 1.5 * u, y + 3 * k);
    ctx.lineTo(px + 1.5 * u, y + 1.4 * k);
    ctx.lineTo(px + 2.6 * u, y + 1.4 * k);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x, y + h - 0.7);
  ctx.lineTo(x + w, y + h - 0.7);
  ctx.stroke();
  ctx.restore();
}

/**
 * Fond commun a toutes les images : nuit, halo rose, etoiles, nom grec en
 * creux le long du bord droit et frise de meandres en haut.
 */
export function drawBackdrop(ctx: SKRSContext2D, w: number, h: number, seed = 7): void {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w * 0.12, 0, 0, w * 0.12, 0, Math.max(520, w * 0.55));
  glow.addColorStop(0, withAlpha(THEME.accent, 0.16));
  glow.addColorStop(1, withAlpha(THEME.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const r = prng(seed);
  for (let i = 0; i < Math.round((w * h) / 9000); i++) {
    const size = 0.6 + r() * 1.5;
    ctx.fillStyle = withAlpha(THEME.accent, 0.12 + r() * 0.35);
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(w - 22, h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.font = "800 46px Jakarta";
  ctx.textAlign = "center";
  ctx.strokeStyle = withAlpha(THEME.accent, 0.14);
  ctx.lineWidth = 1.2;
  ctx.strokeText(GREEK_NAME.split("").join(" "), 0, 16);
  ctx.restore();

  drawMeander(ctx, 0, 10, w, 12, 20, 0.22);
}

/** Surtitre en capitales mono avec la pastille de la marque. */
export function drawKicker(ctx: SKRSContext2D, text: string, x: number, y: number, color = THEME.accent): void {
  ctx.fillStyle = withAlpha(color, 0.25);
  ctx.beginPath();
  ctx.arc(x + 4, y - 4, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 4, y - 4, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "500 12px 'JetBrains Mono'";
  ctx.textAlign = "left";
  const spaced = ctx as SKRSContext2D & { letterSpacing?: string };
  spaced.letterSpacing = "2.2px";
  ctx.fillText(text.toUpperCase(), x + 18, y);
  spaced.letterSpacing = "0px";
}

/** Titre en Jakarta 800, ferme par le point rose de la marque. */
export function drawTitle(ctx: SKRSContext2D, text: string, x: number, y: number, size = 30, maxWidth = 900): number {
  ctx.font = `800 ${size}px Jakarta`;
  ctx.textAlign = "left";
  ctx.fillStyle = THEME.text;
  const shown = ellipsize(ctx, text, maxWidth);
  ctx.fillText(shown, x, y);
  const end = x + ctx.measureText(shown).width;
  ctx.fillStyle = THEME.accent;
  ctx.beginPath();
  ctx.arc(end + size * 0.2, y - size * 0.09, size * 0.1, 0, Math.PI * 2);
  ctx.fill();
  return end + size * 0.35;
}

/** Signature en bas d'image : mot-symbole et horodatage. */
export function drawFooter(ctx: SKRSContext2D, w: number, h: number, note: string): void {
  ctx.textAlign = "left";
  ctx.font = "800 15px Jakarta";
  ctx.fillStyle = THEME.textDim;
  ctx.fillText("Mnémosyne", 28, h - 20);
  const end = 28 + ctx.measureText("Mnémosyne").width;
  ctx.fillStyle = THEME.accent;
  ctx.beginPath();
  ctx.arc(end + 4, h - 22, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "400 11px 'JetBrains Mono'";
  ctx.fillStyle = THEME.textFaint;
  ctx.textAlign = "right";
  ctx.fillText(note.toUpperCase(), w - 56, h - 20);
  ctx.textAlign = "left";
}
