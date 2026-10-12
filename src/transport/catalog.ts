import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../store/db.js";
import type { Network } from "./types.js";
import { getJSON, normalizeName, rankByName } from "./util.js";

/**
 * Catalogue des reseaux de transport, tire du Point d'Acces National
 * (transport.data.gouv.fr). Tout reseau qui publie un GTFS y figure :
 * bus, tram et metro urbains, cars interurbains et regionaux, scolaires.
 * Aucun reseau n'est code en dur.
 */

const API = "https://transport.data.gouv.fr/api/datasets";
const CACHE_DIR = path.join(DATA_DIR, "cache");
const CATALOG_FILE = path.join(CACHE_DIR, "networks.json");
const LOGO_FILE = path.join(CACHE_DIR, "logos.json");
const TTL = 7 * 24 * 3600 * 1000;

let memory: { at: number; networks: Network[] } | null = null;
let loading: Promise<Network[]> | null = null;

function readFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, file);
}

const KIND_LABELS: Record<string, string> = {
  urban: "Urbain",
  intercity: "Interurbain",
  school: "Scolaire",
  "long-distance-coach": "Car longue distance",
  "rail": "Ferroviaire",
  "maritime": "Maritime",
  "on-demand": "Transport à la demande",
};

const textOf = (v: any): string =>
  typeof v === "string" ? v : (v?.nom ?? v?.name ?? v?.libelle ?? "");

/** `covered_area` a change de forme au fil des versions de l'API. */
function areaOf(ds: any): string {
  const raw = ds.covered_area ?? ds.coverage ?? [];
  const list = Array.isArray(raw) ? raw : [raw?.aom ?? raw?.region ?? raw?.cities ?? raw];
  return [...new Set(list.flat().map(textOf).filter(Boolean))].slice(0, 4).join(", ");
}

function toNetwork(ds: any): Network | null {
  if (ds?.type !== "public-transit") return null;
  const resources: any[] = ds.resources ?? [];
  const format = (r: any) => String(r.format ?? "").toLowerCase();
  const gtfs = resources.find((r) => format(r) === "gtfs" && r.is_available !== false && r.url);
  if (!gtfs) return null;

  const rt = resources.filter((r) => format(r) === "gtfs-rt" && r.url);
  const feature = (r: any, f: string) =>
    (r.features ?? []).includes(f) || new RegExp(f.replace("_", "."), "i").test(`${r.title ?? ""} ${r.url ?? ""}`);
  const tripUpdates = rt.find((r) => feature(r, "trip_updates")) ?? (rt.length === 1 ? rt[0] : null);
  const alerts = rt.find((r) => feature(r, "service_alerts")) ?? null;

  const offer = (ds.offers ?? [])[0];
  const authority = offer?.nom_aom ?? ds.aom?.name ?? ds.legal_owners?.[0]?.name ?? ds.publisher?.name ?? "";
  const logo = typeof ds.logo === "string" && ds.logo ? ds.logo : typeof ds.full_logo === "string" && ds.full_logo ? ds.full_logo : null;

  return {
    id: String(ds.id),
    name: String(offer?.nom_commercial ?? ds.title ?? "Réseau").trim(),
    authority,
    area: areaOf(ds),
    logo,
    publisherId: ds.publisher?.type === "organization" ? (ds.publisher.id ?? null) : null,
    kinds: (ds.sub_types ?? ds.sub_type ?? []).map((k: string) => KIND_LABELS[k] ?? k),
    gtfsUrl: gtfs.url,
    tripUpdatesUrl: tripUpdates?.url ?? null,
    alertsUrl: alerts?.url ?? null,
    page: ds.page_url ?? `https://transport.data.gouv.fr/datasets/${ds.slug ?? ds.id}`,
  };
}

/** Liste complete des reseaux, mise en cache une semaine sur disque. */
export async function networks(force = false): Promise<Network[]> {
  if (!force && memory && Date.now() - memory.at < TTL) return memory.networks;
  if (!force) {
    const cached = readFile<{ at: number; networks: Network[] }>(CATALOG_FILE);
    if (cached && Date.now() - cached.at < TTL) {
      memory = cached;
      return cached.networks;
    }
  }
  if (loading) return loading;

  loading = (async () => {
    try {
      const data = process.env.MNEMO_DEMO ? (await import("./demo.js")).demoDatasets() : await getJSON(API, {}, 60000);
      const list = (Array.isArray(data) ? data : [])
        .map(toNetwork)
        .filter((n): n is Network => n !== null)
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));
      memory = { at: Date.now(), networks: list };
      writeFile(CATALOG_FILE, memory);
      return list;
    } catch (err) {
      // Hors ligne : on se contente du dernier catalogue connu, meme perime.
      const stale = readFile<{ at: number; networks: Network[] }>(CATALOG_FILE);
      if (stale) {
        memory = stale;
        return stale.networks;
      }
      throw err;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export async function networkById(id: string): Promise<Network | null> {
  if (!id) return null;
  return (await networks()).find((n) => n.id === id) ?? null;
}

/** Recherche par nom commercial, collectivite ou territoire ("Lyon", "TCL", "Gironde"). */
export async function searchNetworks(query: string, limit = 12): Promise<Network[]> {
  const list = await networks();
  const q = normalizeName(query);
  const ranked = q
    ? rankByName(list, query, (n) => `${n.name} ${n.authority} ${n.area}`)
    : list.filter((n) => n.kinds.includes("Urbain"));
  return withLogos(ranked.slice(0, limit));
}

/** Logos des editeurs, resolus par lot puis gardes en cache. */
export async function withLogos(list: Network[]): Promise<Network[]> {
  const cache = readFile<Record<string, string | null>>(LOGO_FILE) ?? {};
  const missing = process.env.MNEMO_DEMO
    ? []
    : [...new Set(list.filter((n) => !n.logo).map((n) => n.publisherId).filter((id): id is string => !!id && !(id in cache)))];
  if (missing.length) {
    await Promise.allSettled(
      missing.map(async (id) => {
        try {
          const org = await getJSON(`https://www.data.gouv.fr/api/1/organizations/${id}/`, {}, 8000);
          cache[id] = org?.logo_thumbnail || org?.logo || null;
        } catch {
          cache[id] = null;
        }
      }),
    );
    writeFile(LOGO_FILE, cache);
  }
  return list.map((n) => ({ ...n, logo: n.logo ?? (n.publisherId ? (cache[n.publisherId] ?? null) : null) }));
}
