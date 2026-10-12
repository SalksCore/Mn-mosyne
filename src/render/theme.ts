import { getConfig } from "../store/db.js";

export type ThemeMode = "clair" | "sombre";

/**
 * Palettes de la direction artistique Mnemosyne : fonds nuit, teinte rose
 * de la deesse, texte ivoire. Les memes valeurs que le site et le panneau.
 */
const PALETTES: Record<ThemeMode, Record<string, string>> = {
  sombre: {
    bg: "#0e0d11",
    deep: "#26101d",
    panel: "#17151b",
    panelAlt: "#1b1920",
    card: "#131216",
    stroke: "#232028",
    strokeStrong: "#322e39",
    text: "#f2f0f4",
    textDim: "#9a95a3",
    textFaint: "#6a6572",
    accent: "#f472b6",
    accentSoft: "#3c2132",
    onAccent: "#100c1c",
    danger: "#f87171",
    warn: "#fbbf24",
    good: "#34d399",
  },
  clair: {
    bg: "#faf9fa",
    deep: "#fbe6f0",
    panel: "#f3f1f3",
    panelAlt: "#efedf1",
    card: "#ffffff",
    stroke: "#e5e1e7",
    strokeStrong: "#d3ccd8",
    text: "#1a171c",
    textDim: "#6a6472",
    textFaint: "#97919e",
    accent: "#c45e94",
    accentSoft: "#fbe6f0",
    onAccent: "#ffffff",
    danger: "#c0344c",
    warn: "#d97706",
    good: "#059669",
  },
};

/**
 * Palette active des images generees. Objet mutable : les renderers lisent
 * ses champs au moment du trace, `useTheme()` suffit donc a basculer.
 * Ne concerne que le rendu canvas — les cartes Components V2 de Discord
 * suivent le theme du client de l'utilisateur, non modifiable par le bot.
 */
export const THEME = { ...PALETTES.sombre };

let currentMode: ThemeMode = "sombre";

export function useTheme(mode: ThemeMode): void {
  currentMode = mode;
  Object.assign(THEME, PALETTES[mode]);
}

export function currentThemeMode(): ThemeMode {
  return currentMode;
}

/** Normalise un nom de matiere pour servir de cle stable dans la config. */
export function subjectKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Valide et normalise une couleur hexadecimale saisie par l'utilisateur. */
export function normalizeHex(input: string): string | null {
  let v = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    v = v
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
  return `#${v.toLowerCase()}`;
}

/** Convertit "#rrggbb" en entier pour la couleur d'accent d'un Container V2. */
export function hexToInt(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

/**
 * Hachage FNV-1a : bien meilleure dispersion que le classique h*31, qui
 * regroupait les matieres aux noms proches sur des teintes quasi identiques.
 */
function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Couleur de repli deterministe : la meme matiere aura toujours la meme
 * teinte tant que l'utilisateur n'en a pas defini une dans la config.
 *
 * La bande rouge (330-360 et 0-30) est volontairement exclue : le rouge
 * signale une annulation dans l'emploi du temps, une matiere rouge serait
 * confondue avec un cours annule.
 */
function hashHue(key: string): number {
  return 30 + (fnv1a(key) % 300);
}

export function hslToHex(h: number, s: number, l: number): string {
  // h en degres, s et l en pourcentage. L'amplitude se calcule sur la
  // luminance ramenee en fraction, sinon Math.min(l, 1 - l) devient negatif
  // et produit des composantes hors bornes.
  const lf = l / 100;
  const a = (s / 100) * Math.min(lf, 1 - lf);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lf - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, c)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Resout la couleur d'une matiere : config utilisateur > couleur PRONOTE
 * > teinte generee. Garantit toujours une couleur lisible sur fond sombre.
 */
export function subjectColor(subject: string, pronoteColor?: string): string {
  const cfg = getConfig();
  const key = subjectKey(subject);
  const custom = cfg.subjectColors[key];
  if (custom) {
    const norm = normalizeHex(custom);
    if (norm) return norm;
  }
  if (pronoteColor) {
    const norm = normalizeHex(pronoteColor);
    if (norm) return norm;
  }
  // On fait aussi varier saturation et luminosite : deux matieres tombant
  // sur des teintes voisines restent ainsi distinguables.
  // La luminosite depend du theme : ces couleurs servent de texte, il faut
  // des teintes sombres sur fond blanc et claires sur fond noir.
  const h = fnv1a(key);
  const base = currentMode === "clair" ? 38 : 52;
  return hslToHex(hashHue(key), 62 + ((h >>> 9) % 20), base + ((h >>> 17) % 12));
}

/** Noir ou blanc selon la luminance, pour que le texte reste lisible. */
export function contrastText(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#101216" : "#ffffff";
}

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
