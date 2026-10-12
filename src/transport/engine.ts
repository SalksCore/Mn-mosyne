import { getConfig } from "../store/db.js";
import { networkById } from "./catalog.js";
import { cachedIndex, corridor, loadIndex, modeOf, serviceRuns, type FeedIndex } from "./gtfs/feed.js";
import { applyUpdate, fetchAlerts, fetchTripUpdates, type TripUpdate } from "./gtfs/realtime.js";
import type { Disruption, Journey, Line, Network, Stop } from "./types.js";
import { distanceM, rankByName, walkMinutes, wallTimeToDate, ymd, zonedParts } from "./util.js";

/**
 * Moteur de trajets, commun a tous les reseaux.
 *
 * Il s'appuie uniquement sur des standards ouverts : GTFS pour les horaires
 * officiels et GTFS-RT pour le temps reel. Tout reseau publie sur
 * transport.data.gouv.fr fonctionne donc sans une ligne de code specifique,
 * de meme que n'importe quel flux GTFS saisi a la main.
 */

/** Reseau configure, ou null s'il n'y en a pas encore. */
export async function currentNetwork(): Promise<Network | null> {
  const t = getConfig().transport;
  if (t.networkId === "custom") {
    if (!t.customGtfsUrl) return null;
    return {
      id: "custom",
      name: t.networkName || "Réseau personnalisé",
      authority: "",
      area: "",
      logo: t.networkLogo,
      publisherId: null,
      kinds: [],
      gtfsUrl: t.customGtfsUrl,
      tripUpdatesUrl: t.customTripUpdatesUrl || null,
      alertsUrl: t.customAlertsUrl || null,
      page: t.customGtfsUrl,
    };
  }
  return networkById(t.networkId);
}

export async function currentIndex(): Promise<{ network: Network; index: FeedIndex } | null> {
  const network = await currentNetwork();
  if (!network) return null;
  return { network, index: await loadIndex(network) };
}

// ------------------------------------------------------------------ arrets

export function searchStops(index: FeedIndex, query: string, limit = 12): Stop[] {
  return rankByName(index.stops, query, (s) => s.name).slice(0, limit);
}

export function stopById(index: FeedIndex, id: string): Stop | null {
  return index.stops.find((s) => s.id === id) ?? null;
}

export function nearbyStops(index: FeedIndex, lat: number, lon: number, radiusM: number): Array<{ stop: Stop; meters: number }> {
  return index.stops
    .map((stop) => ({ stop, meters: distanceM(lat, lon, stop.lat, stop.lon) }))
    .filter((x) => x.meters <= radiusM)
    .sort((a, b) => a.meters - b.meters);
}

export function linesOf(index: FeedIndex, stop: Stop): Line[] {
  return stop.lines.map((id) => index.lines[id]).filter((l): l is Line => !!l);
}

/** Lignes qui relient directement deux arrets. */
export function commonLines(index: FeedIndex, a: Stop, b: Stop): Line[] {
  const other = new Set(b.lines);
  return linesOf(index, a).filter((l) => other.has(l.id));
}

// ---------------------------------------------------------------- trajets

export interface Endpoint {
  stop: Stop;
  /** Minutes de marche entre le point reel et l'arret. */
  walk: number;
}

export interface ConnectionQuery {
  origins: Endpoint[];
  destinations: Endpoint[];
  /** Heure de montee au plus tot. */
  after: Date;
  /** Heure de montee au plus tard. */
  before: Date;
  /** Lignes autorisees (route_id). Vide = toutes. */
  lines?: string[];
  realtime?: boolean;
}

async function tripUpdates(network: Network): Promise<Map<string, TripUpdate>> {
  if (!network.tripUpdatesUrl) return new Map();
  try {
    return await fetchTripUpdates(network.tripUpdatesUrl);
  } catch (err) {
    console.warn(`[transport] temps reel indisponible : ${err instanceof Error ? err.message : err}`);
    return new Map();
  }
}

/** Jours de service a explorer : la veille couvre les courses apres minuit. */
function serviceDays(after: Date, before: Date, tz: string): Array<{ y: number; m: number; d: number; key: string; weekday: number }> {
  const out: Array<{ y: number; m: number; d: number; key: string; weekday: number }> = [];
  const start = after.getTime() - 24 * 3600 * 1000;
  for (let t = start; t <= before.getTime() + 3600 * 1000; t += 24 * 3600 * 1000) {
    const p = zonedParts(new Date(t), tz);
    const key = ymd(new Date(t), tz);
    if (out.some((x) => x.key === key)) continue;
    out.push({ y: p.y, m: p.m, d: p.d, key, weekday: new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() });
  }
  return out;
}

/**
 * Toutes les liaisons directes entre un ensemble d'arrets de depart et un
 * ensemble d'arrets d'arrivee, avec leurs vraies heures de passage.
 * Une course n'apparait qu'une fois : avec le couple d'arrets qui fait
 * arriver le plus tot a destination (marche comprise).
 */
export async function connections(network: Network, index: FeedIndex, q: ConnectionQuery): Promise<Journey[]> {
  const originByQuay = new Map<string, Endpoint>();
  for (const o of q.origins) for (const quay of o.stop.quays) originByQuay.set(quay, o);
  const destByQuay = new Map<string, Endpoint>();
  for (const d of q.destinations) for (const quay of d.stop.quays) destByQuay.set(quay, d);

  const c = await corridor(index, [...originByQuay.keys(), ...destByQuay.keys()]);
  const updates = q.realtime === false ? new Map<string, TripUpdate>() : await tripUpdates(network);
  const allowed = q.lines?.length ? new Set(q.lines) : null;
  const days = serviceDays(q.after, q.before, index.timezone);
  const out: Journey[] = [];

  for (const [tripId, trip] of Object.entries(c.trips)) {
    if (allowed && !allowed.has(trip.route)) continue;
    const line = index.lines[trip.route];
    if (!line) continue;

    // Meilleur couple (montee, descente) sur cette course.
    let best: { board: (typeof trip.calls)[number]; alight: (typeof trip.calls)[number]; o: Endpoint; d: Endpoint } | null = null;
    for (let i = 0; i < trip.calls.length; i++) {
      const o = originByQuay.get(trip.calls[i][0]);
      if (!o) continue;
      for (let j = i + 1; j < trip.calls.length; j++) {
        const d = destByQuay.get(trip.calls[j][0]);
        if (!d || d.stop.id === o.stop.id) continue;
        const score = trip.calls[j][2] + d.walk * 60;
        const bestScore = best ? best.alight[2] + best.d.walk * 60 : Infinity;
        const later = best && score === bestScore && trip.calls[i][3] - o.walk * 60 > best.board[3] - best.o.walk * 60;
        if (score < bestScore || later) best = { board: trip.calls[i], alight: trip.calls[j], o, d };
      }
    }
    if (!best) continue;

    for (const day of days) {
      if (!serviceRuns(c, trip.service, day.key, day.weekday)) continue;
      const aimedDeparture = wallTimeToDate(day.y, day.m, day.d, best.board[3], index.timezone);
      if (aimedDeparture < new Date(q.after.getTime() - 30 * 60 * 1000) || aimedDeparture > q.before) continue;
      const aimedArrival = wallTimeToDate(day.y, day.m, day.d, best.alight[2], index.timezone);

      const update = updates.get(tripId);
      const usable = update && (!update.startDate || update.startDate === day.key) ? update : undefined;
      const dep = applyUpdate(usable, { stopId: best.board[0], seq: best.board[1] }, aimedDeparture, "departure");
      const arr = applyUpdate(usable, { stopId: best.alight[0], seq: best.alight[1] }, aimedArrival, "arrival");
      if (dep.time < q.after || dep.time > q.before) continue;

      out.push({
        tripId,
        serviceDate: day.key,
        line,
        mode: modeOf(line.type),
        headsign: trip.headsign || best.d.stop.name,
        fromStop: best.o.stop,
        toStop: best.d.stop,
        walkTo: best.o.walk,
        walkFrom: best.d.walk,
        aimedDeparture,
        departure: dep.time,
        aimedArrival,
        arrival: arr.time,
        delayMinutes: dep.realtime ? Math.round((dep.time.getTime() - aimedDeparture.getTime()) / 60000) : null,
        cancelled: !!usable?.cancelled || dep.skipped || arr.skipped,
        realtime: dep.realtime || arr.realtime,
      });
    }
  }

  return out.sort((a, b) => a.departure.getTime() - b.departure.getTime());
}

/** Raccourci : liaisons directes entre les deux arrets configures. */
export async function directJourneys(
  network: Network,
  index: FeedIndex,
  from: Endpoint,
  to: Endpoint,
  after: Date,
  before: Date,
  lines: string[] = [],
): Promise<Journey[]> {
  return connections(network, index, { origins: [from], destinations: [to], after, before, lines });
}

/**
 * Itineraires de repli : on elargit aux arrets accessibles a pied autour du
 * depart et de l'arrivee, toutes lignes confondues (bus, tram, metro...).
 */
export async function alternatives(
  network: Network,
  index: FeedIndex,
  from: Endpoint,
  to: Endpoint,
  after: Date,
  before: Date,
  radiusM = 900,
): Promise<Journey[]> {
  const around = (e: Endpoint): Endpoint[] =>
    nearbyStops(index, e.stop.lat, e.stop.lon, radiusM)
      .slice(0, 8)
      .map(({ stop, meters }) => ({ stop, walk: stop.id === e.stop.id ? e.walk : e.walk + walkMinutes(meters) }));

  const found = await connections(network, index, {
    origins: around(from),
    destinations: around(to),
    after,
    before,
  });
  // Une proposition par ligne et par arret de depart : la premiere qui passe.
  const seen = new Set<string>();
  return found
    .filter((j) => !j.cancelled)
    .filter((j) => {
      const k = `${j.line.id}|${j.fromStop.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.arrival.getTime() + a.walkFrom * 60000 - (b.arrival.getTime() + b.walkFrom * 60000));
}

// ------------------------------------------------------------ perturbations

/** Messages de perturbation qui touchent les lignes donnees. */
export async function disruptions(network: Network, index: FeedIndex, routeIds: string[]): Promise<Disruption[]> {
  if (!network.alertsUrl) return [];
  const wanted = new Set(routeIds);
  const now = Date.now() / 1000;
  const alerts = await fetchAlerts(network.alertsUrl);
  return alerts
    .filter((a) => a.routeIds.some((r) => wanted.has(r)))
    .filter((a) => (a.end === null || a.end > now) && (a.start === null || a.start < now + 24 * 3600))
    .map((a) => ({
      id: a.id || `${a.header}|${a.start}`,
      summary: (a.header || a.description).slice(0, 160),
      detail: [a.header, a.description].filter(Boolean).join(" — ").slice(0, 900),
      lines: [...new Set(a.routeIds.map((r) => index.lines[r]?.short ?? r))],
      from: a.start ? new Date(a.start * 1000) : null,
      to: a.end ? new Date(a.end * 1000) : null,
    }));
}

export { cachedIndex };
