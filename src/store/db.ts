import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BotConfig, Snapshot, StoredCredentials } from "../types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `DATA_DIR` permet d'isoler un jeu de donnees (mode apercu, tests, plusieurs instances). */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(HERE, "../../data");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function file(name: string): string {
  return path.join(DATA_DIR, `${name}.json`);
}

/**
 * Ecriture atomique : on ecrit dans un fichier temporaire puis on renomme.
 * Evite un JSON tronque si le process meurt pendant l'ecriture.
 */
function writeJSON(name: string, value: unknown): void {
  const target = file(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

function readJSON<T>(name: string, fallback: T): T {
  const target = file(name);
  if (!fs.existsSync(target)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(target, "utf8")) as T;
  } catch {
    // Fichier corrompu : on le met de cote plutot que de le perdre.
    fs.renameSync(target, `${target}.corrupt.${Date.now()}`);
    return fallback;
  }
}

export const DEFAULT_CONFIG: BotConfig = {
  ownerId: null,
  displayName: "",
  setupComplete: false,
  timezone: "Europe/Paris",
  morningBriefTime: "06:00",
  eveningBriefTime: "20:00",
  morningBriefEnabled: true,
  eveningBriefEnabled: true,
  pollIntervalMinutes: 6,
  notifications: {
    timetable: true,
    grades: true,
    homework: true,
    discussions: true,
    news: true,
    attendance: true,
    evaluations: true,
    sessionExpiry: true,
    transport: true,
  },
  quietHours: { enabled: true, start: "22:30", end: "06:30" },
  subjectColors: {},
  bag: {},
  imageTheme: {
    timetable: "sombre",
    grades: "sombre",
    notifications: "sombre",
    bag: "sombre",
    transport: "sombre",
  },
  transport: {
    enabled: false,
    networkId: "",
    networkName: "",
    networkLogo: null,
    customGtfsUrl: "",
    customTripUpdatesUrl: "",
    customAlertsUrl: "",
    homeStopId: "",
    homeStopName: "",
    schoolStopId: "",
    schoolStopName: "",
    lines: [],
    walkToHomeStop: 6,
    walkFromSchoolStop: 5,
    walkToSchoolStop: 5,
    walkFromHomeStop: 6,
    arriveMinBefore: 5,
    notifyLeadMinutes: 15,
    delayAlertMinutes: 4,
    eveningEnabled: true,
    morningWatchMinutes: 45,
    eveningWatchMinutes: 30,
    disruptionAlerts: true,
  },
  colorImminent: "#f23f43",
  colorFuture: "#f0a232",
};

let configCache: BotConfig | null = null;

/**
 * Tout le bot raisonne en heure locale de l'utilisateur : PRONOTE fournit
 * des heures « murales », les briefs et les trajets aussi. Sur un serveur
 * en UTC, un cours de 8 h etait lu 8 h UTC et tous les calculs glissaient.
 * Node relit `TZ` a chaud : il suffit de l'aligner sur la configuration.
 */
function applyTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: tz });
    process.env.TZ = tz;
  } catch {
    process.env.TZ = "Europe/Paris";
  }
}

/**
 * Reprend les reglages de transport des anciennes versions (moteur propre a un seul reseau,
 * arrets saisis par nom, duree de trajet manuelle). Les noms d'arrets sont
 * conserves pour guider la nouvelle configuration depuis le panneau web.
 */
function migrateTransport(raw: Record<string, unknown> | undefined): BotConfig["transport"] {
  const next = { ...DEFAULT_CONFIG.transport, ...(raw ?? {}) } as BotConfig["transport"] & Record<string, unknown>;
  if (typeof raw?.homeStop === "string" && !next.homeStopName) next.homeStopName = raw.homeStop;
  if (typeof raw?.schoolStop === "string" && !next.schoolStopName) next.schoolStopName = raw.schoolStop;
  if (!Array.isArray(next.lines)) next.lines = [];
  // Sans reseau ni arrets resolus, l'ancien moteur ne peut plus tourner.
  if (!next.networkId || !next.homeStopId || !next.schoolStopId) next.enabled = false;
  for (const legacy of ["provider", "siriBaseUrl", "siriKey", "navitiaKey", "navitiaCoverage", "homeStop", "schoolStop", "line", "rideMinutesToSchool", "rideMinutesToHome", "arriveMaxBefore"]) {
    delete next[legacy];
  }
  return next;
}

export function getConfig(): BotConfig {
  if (!configCache) {
    const raw = readJSON<Partial<BotConfig>>("config", {});
    // Fusion superficielle + fusion explicite des sous-objets, pour que
    // l'ajout d'une nouvelle option n'invalide pas un fichier existant.
    configCache = {
      ...DEFAULT_CONFIG,
      ...raw,
      notifications: { ...DEFAULT_CONFIG.notifications, ...(raw.notifications ?? {}) },
      imageTheme: { ...DEFAULT_CONFIG.imageTheme, ...(raw.imageTheme ?? {}) },
      quietHours: { ...DEFAULT_CONFIG.quietHours, ...(raw.quietHours ?? {}) },
      transport: migrateTransport(raw.transport as Record<string, unknown> | undefined),
      subjectColors: { ...(raw.subjectColors ?? {}) },
      bag: { ...(raw.bag ?? {}) },
    };
    applyTimezone(configCache.timezone);
  }
  return configCache;
}

export function saveConfig(patch: Partial<BotConfig>): BotConfig {
  const next = { ...getConfig(), ...patch };
  configCache = next;
  applyTimezone(next.timezone);
  writeJSON("config", next);
  return next;
}

export function getCredentials(): StoredCredentials | null {
  return readJSON<StoredCredentials | null>("credentials", null);
}

export function saveCredentials(creds: StoredCredentials | null): void {
  writeJSON("credentials", creds);
}

export function getSnapshot(): Snapshot | null {
  return readJSON<Snapshot | null>("snapshot", null);
}

export function saveSnapshot(snap: Snapshot): void {
  writeJSON("snapshot", snap);
}

/** Ensemble d'IDs deja notifies, pour ne jamais notifier deux fois. */
export function getSeen(): Record<string, number> {
  return readJSON<Record<string, number>>("seen", {});
}

export function markSeen(ids: string[]): void {
  const seen = getSeen();
  const now = Date.now();
  for (const id of ids) seen[id] = now;
  // Purge des entrees de plus de 120 jours pour borner la taille du fichier.
  const cutoff = now - 120 * 24 * 3600 * 1000;
  for (const [k, v] of Object.entries(seen)) if (v < cutoff) delete seen[k];
  writeJSON("seen", seen);
}

export function unmarkSeen(ids: string[]): void {
  const seen = getSeen();
  for (const id of ids) delete seen[id];
  writeJSON("seen", seen);
}

export function hasSeen(id: string): boolean {
  return id in getSeen();
}

/** Supprime toutes les donnees PRONOTE locales (reinitialisation). */
export function resetAll(): void {
  for (const name of ["config", "credentials", "snapshot", "seen", "pending", "secrets"]) {
    fs.rmSync(file(name), { force: true });
  }
  configCache = null;
}

// ---------------------------------------------------------------- secrets

export interface Secrets {
  discordToken?: string;
  clientId?: string;
}

/**
 * Le token Discord peut venir de `.env` ou etre saisi depuis le panneau web.
 * Dans ce second cas il est stocke ici, avec des droits restreints.
 */
export function getSecrets(): Secrets {
  return readJSON<Secrets>("secrets", {});
}

export function saveSecrets(patch: Secrets): void {
  writeJSON("secrets", { ...getSecrets(), ...patch });
  try {
    fs.chmodSync(file("secrets"), 0o600);
  } catch {
    /* systeme de fichiers sans permissions POSIX */
  }
}

// ------------------------------------------------- alertes retenues la nuit

export function getPending<T>(): T[] {
  return readJSON<T[]>("pending", []);
}

export function savePending<T>(items: T[]): void {
  writeJSON("pending", items);
}
