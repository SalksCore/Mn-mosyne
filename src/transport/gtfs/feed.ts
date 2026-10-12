import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DATA_DIR } from "../../store/db.js";
import type { Line, Network, Stop } from "../types.js";
import { distanceM, fetchWithTimeout, normalizeName } from "../util.js";
import { eachRow, gtfsSeconds } from "./zip.js";

/**
 * Horaires theoriques d'un reseau, au format GTFS.
 *
 * 1. Le GTFS est telecharge une fois par semaine dans data/gtfs/<reseau>/.
 * 2. Un index leger (arrets, lignes, fuseau) est construit et garde en memoire.
 * 3. Les horaires detailles ne sont extraits que pour les arrets qui
 *    interessent l'utilisateur (« corridor »), puis mis en cache.
 */

const ROOT = path.join(DATA_DIR, "gtfs");
const MAX_AGE = 7 * 24 * 3600 * 1000;

export interface FeedIndex {
  networkId: string;
  /** Empreinte de l'archive : invalide les corridors quand le GTFS change. */
  version: string;
  builtAt: number;
  timezone: string;
  lines: Record<string, Line>;
  stops: Stop[];
}

/** Un passage d'une course a un quai : [quai, rang, arrivee (s), depart (s)]. */
export type Call = [string, number, number, number];

export interface CorridorTrip {
  route: string;
  service: string;
  headsign: string;
  calls: Call[];
}

export interface Corridor {
  version: string;
  trips: Record<string, CorridorTrip>;
  calendar: Record<string, { days: number[]; start: string; end: string }>;
  dates: Record<string, { add: string[]; remove: string[] }>;
}

export type Progress = (step: string, ratio: number) => void;

const dirOf = (networkId: string): string => path.join(ROOT, networkId.replace(/[^a-zA-Z0-9_-]/g, "_"));
const zipOf = (networkId: string): string => path.join(dirOf(networkId), "feed.zip");

function readJSON<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJSON(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, file);
}

const indexes = new Map<string, FeedIndex>();
const building = new Map<string, Promise<FeedIndex>>();
/** Etat de l'indexation en cours, affiche par le panneau web. */
export const progress = new Map<string, { step: string; ratio: number }>();

async function download(network: Network, onProgress: Progress): Promise<void> {
  const target = zipOf(network.id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  onProgress("Téléchargement des horaires", 0);
  if (network.gtfsUrl.startsWith("demo://")) {
    const { demoGtfs } = await import("../demo.js");
    fs.writeFileSync(target, demoGtfs());
    return;
  }
  const res = await fetchWithTimeout(network.gtfsUrl, {}, 10 * 60 * 1000);
  if (!res.body) throw new Error("GTFS vide");
  const total = Number(res.headers.get("content-length") ?? 0);
  let got = 0;
  const body = Readable.fromWeb(res.body as never);
  body.on("data", (chunk: Buffer) => {
    got += chunk.length;
    if (total) onProgress("Téléchargement des horaires", Math.min(1, got / total));
  });
  const tmp = `${target}.part`;
  await pipeline(body, fs.createWriteStream(tmp));
  fs.renameSync(tmp, target);
}

async function fileHash(file: string): Promise<string> {
  const h = crypto.createHash("sha1");
  await pipeline(fs.createReadStream(file), h);
  return h.digest("hex").slice(0, 16);
}

const MODES: Record<number, string> = { 0: "Tram", 1: "Métro", 2: "Train", 3: "Bus", 4: "Ferry", 5: "Câble", 6: "Téléphérique", 7: "Funiculaire", 11: "Trolleybus", 12: "Monorail" };

export function modeOf(type: number): string {
  if (MODES[type]) return MODES[type];
  // Types etendus (100-1700) : on retombe sur la famille.
  if (type >= 100 && type < 200) return "Train";
  if (type >= 200 && type < 800) return "Car";
  if (type >= 900 && type < 1000) return "Tram";
  return "Bus";
}

const hex = (v: string | undefined): string | null => (v && /^[0-9a-fA-F]{6}$/.test(v.trim()) ? `#${v.trim().toLowerCase()}` : null);

async function buildIndex(network: Network, onProgress: Progress): Promise<FeedIndex> {
  const zip = zipOf(network.id);
  const version = await fileHash(zip);
  let timezone = "Europe/Paris";

  await eachRow(zip, "agency.txt", (c, i) => {
    if (c[i.agency_timezone]) timezone = c[i.agency_timezone].trim();
  });

  const lines: Record<string, Line> = {};
  await eachRow(zip, "routes.txt", (c, i) => {
    const id = c[i.route_id];
    if (!id) return;
    lines[id] = {
      id,
      short: (c[i.route_short_name] ?? "").trim() || (c[i.route_long_name] ?? "").trim() || id,
      long: (c[i.route_long_name] ?? "").trim(),
      color: hex(c[i.route_color]),
      textColor: hex(c[i.route_text_color]),
      type: Number(c[i.route_type] ?? 3),
    };
  });

  interface RawStop { id: string; name: string; parent: string; type: number; lat: number; lon: number }
  const raw: RawStop[] = [];
  await eachRow(zip, "stops.txt", (c, i) => {
    raw.push({
      id: c[i.stop_id],
      name: (c[i.stop_name] ?? "").trim(),
      parent: (c[i.parent_station] ?? "").trim(),
      type: Number(c[i.location_type] || 0),
      lat: Number(c[i.stop_lat]),
      lon: Number(c[i.stop_lon]),
    });
  });

  // Lignes desservies par chaque quai : trips.txt donne la ligne d'une
  // course, stop_times.txt les quais qu'elle dessert.
  onProgress("Lecture des lignes", 0);
  const tripRoute = new Map<string, string>();
  await eachRow(zip, "trips.txt", (c, i) => tripRoute.set(c[i.trip_id], c[i.route_id]));
  const quayRoutes = new Map<string, Set<string>>();
  let lastTrip = "";
  let lastRoute: string | undefined;
  await eachRow(
    zip,
    "stop_times.txt",
    (c, i) => {
      const trip = c[i.trip_id];
      if (trip !== lastTrip) {
        lastTrip = trip;
        lastRoute = tripRoute.get(trip);
      }
      if (!lastRoute) return;
      const stop = c[i.stop_id];
      let set = quayRoutes.get(stop);
      if (!set) quayRoutes.set(stop, (set = new Set()));
      set.add(lastRoute);
    },
    (r) => onProgress("Analyse des passages", r),
  );
  tripRoute.clear();

  // Regroupement des quais en arrets : par station parente quand le GTFS
  // en declare, sinon par nom identique a moins de 300 m (un quai par sens).
  const stations = new Map(raw.filter((s) => s.type === 1).map((s) => [s.id, s]));
  const groups = new Map<string, Stop>();
  const byName = new Map<string, Stop[]>();
  for (const s of raw) {
    if (s.type !== 0 || !s.id || !Number.isFinite(s.lat)) continue;
    const routes = [...(quayRoutes.get(s.id) ?? [])];
    const parent = s.parent && stations.get(s.parent);
    if (parent) {
      const g = groups.get(parent.id) ?? { id: parent.id, name: parent.name || s.name, quays: [], lines: [], lat: parent.lat || s.lat, lon: parent.lon || s.lon };
      g.quays.push(s.id);
      g.lines = [...new Set([...g.lines, ...routes])];
      groups.set(parent.id, g);
      continue;
    }
    const key = normalizeName(s.name);
    const near = (byName.get(key) ?? []).find((g) => distanceM(g.lat, g.lon, s.lat, s.lon) < 300);
    if (near) {
      near.quays.push(s.id);
      near.lines = [...new Set([...near.lines, ...routes])];
    } else {
      const g: Stop = { id: s.id, name: s.name, quays: [s.id], lines: routes, lat: s.lat, lon: s.lon };
      groups.set(s.id, g);
      byName.set(key, [...(byName.get(key) ?? []), g]);
    }
  }

  const index: FeedIndex = {
    networkId: network.id,
    version,
    builtAt: Date.now(),
    timezone,
    lines,
    // Les arrets jamais desservis (points techniques) sont ecartes.
    stops: [...groups.values()].filter((g) => g.lines.length > 0),
  };
  writeJSON(path.join(dirOf(network.id), "index.json"), index);
  return index;
}

/**
 * Index du reseau, pret a l'emploi. Telecharge et indexe au premier appel
 * ou quand le GTFS a plus d'une semaine ; les appels concurrents partagent
 * le meme travail.
 */
export async function loadIndex(network: Network, opts: { force?: boolean } = {}): Promise<FeedIndex> {
  const mem = indexes.get(network.id);
  const fresh = (i: FeedIndex) => Date.now() - i.builtAt < MAX_AGE;
  if (mem && fresh(mem) && !opts.force) return mem;

  if (!opts.force) {
    const disk = readJSON<FeedIndex>(path.join(dirOf(network.id), "index.json"));
    if (disk && fresh(disk) && fs.existsSync(zipOf(network.id))) {
      indexes.set(network.id, disk);
      return disk;
    }
  }

  const pending = building.get(network.id);
  if (pending) return pending;

  const job = (async () => {
    const report: Progress = (step, ratio) => progress.set(network.id, { step, ratio });
    try {
      await download(network, report);
      const index = await buildIndex(network, report);
      indexes.set(network.id, index);
      corridors.clear();
      return index;
    } catch (err) {
      // Un vieux GTFS vaut mieux que rien quand le serveur est indisponible.
      const stale = mem ?? readJSON<FeedIndex>(path.join(dirOf(network.id), "index.json"));
      if (stale && fs.existsSync(zipOf(network.id))) {
        console.warn(`[gtfs] mise a jour impossible, ancien GTFS conserve : ${err instanceof Error ? err.message : err}`);
        indexes.set(network.id, stale);
        return stale;
      }
      throw err;
    } finally {
      progress.delete(network.id);
      building.delete(network.id);
    }
  })();
  building.set(network.id, job);
  return job;
}

export function cachedIndex(networkId: string): FeedIndex | null {
  return indexes.get(networkId) ?? readJSON<FeedIndex>(path.join(dirOf(networkId), "index.json"));
}

const corridors = new Map<string, Corridor>();
const scanning = new Map<string, Promise<Corridor>>();

/**
 * Extrait toutes les courses qui passent par l'un des quais demandes, avec
 * leurs horaires a ces quais, et les calendriers de service correspondants.
 */
export async function corridor(index: FeedIndex, quays: string[]): Promise<Corridor> {
  const sorted = [...new Set(quays)].sort();
  const key = crypto.createHash("sha1").update(`${index.version}|${sorted.join(",")}`).digest("hex").slice(0, 20);
  const file = path.join(dirOf(index.networkId), "corridors", `${key}.json`);

  const mem = corridors.get(key);
  if (mem) return mem;
  const disk = readJSON<Corridor>(file);
  if (disk && disk.version === index.version) {
    corridors.set(key, disk);
    return disk;
  }
  const pending = scanning.get(key);
  if (pending) return pending;

  const job = (async () => {
    const zip = zipOf(index.networkId);
    const wanted = new Set(sorted);
    const calls = new Map<string, Call[]>();

    await eachRow(
      zip,
      "stop_times.txt",
      (c, i) => {
        const stop = c[i.stop_id];
        if (!wanted.has(stop)) return;
        const arr = gtfsSeconds(c[i.arrival_time]);
        const dep = gtfsSeconds(c[i.departure_time]);
        if (arr === null && dep === null) return;
        const trip = c[i.trip_id];
        const list = calls.get(trip) ?? [];
        list.push([stop, Number(c[i.stop_sequence]), arr ?? dep!, dep ?? arr!]);
        calls.set(trip, list);
      },
      (r) => progress.set(index.networkId, { step: "Extraction de tes horaires", ratio: r }),
    );

    const trips: Record<string, CorridorTrip> = {};
    const services = new Set<string>();
    await eachRow(zip, "trips.txt", (c, i) => {
      const id = c[i.trip_id];
      const list = calls.get(id);
      if (!list) return;
      list.sort((a, b) => a[1] - b[1]);
      const service = c[i.service_id];
      services.add(service);
      trips[id] = {
        route: c[i.route_id],
        service,
        headsign: (c[i.trip_headsign] ?? "").trim(),
        calls: list,
      };
    });

    const calendar: Corridor["calendar"] = {};
    await eachRow(zip, "calendar.txt", (c, i) => {
      const id = c[i.service_id];
      if (!services.has(id)) return;
      calendar[id] = {
        // Dimanche en premier, comme Date#getDay().
        days: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((d) => Number(c[i[d]] ?? 0)),
        start: c[i.start_date],
        end: c[i.end_date],
      };
    });

    const dates: Corridor["dates"] = {};
    await eachRow(zip, "calendar_dates.txt", (c, i) => {
      const id = c[i.service_id];
      if (!services.has(id)) return;
      const entry = dates[id] ?? { add: [], remove: [] };
      (c[i.exception_type] === "1" ? entry.add : entry.remove).push(c[i.date]);
      dates[id] = entry;
    });

    progress.delete(index.networkId);
    const result: Corridor = { version: index.version, trips, calendar, dates };
    writeJSON(file, result);
    corridors.set(key, result);
    return result;
  })().finally(() => scanning.delete(key));

  scanning.set(key, job);
  return job;
}

/** Le service tourne-t-il ce jour-la ? `date` au format "YYYYMMDD", `weekday` 0 = dimanche. */
export function serviceRuns(c: Corridor, service: string, date: string, weekday: number): boolean {
  const ex = c.dates[service];
  if (ex?.remove.includes(date)) return false;
  if (ex?.add.includes(date)) return true;
  const cal = c.calendar[service];
  return !!cal && cal.start <= date && date <= cal.end && cal.days[weekday] === 1;
}

/** Supprime les donnees GTFS d'un reseau (changement de reseau). */
export function dropNetwork(networkId: string): void {
  indexes.delete(networkId);
  corridors.clear();
  fs.rmSync(dirOf(networkId), { recursive: true, force: true });
}
