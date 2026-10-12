import { getBuffer } from "../util.js";

/**
 * Decodeur GTFS-Realtime minimal.
 *
 * Le format est du Protocol Buffers ; plutot que d'embarquer protobufjs et
 * sa chaine d'outils, on decode a la main les quelques champs utiles
 * (TripUpdates et Alerts). Les numeros de champ viennent de la
 * specification officielle gtfs-realtime.proto.
 */

type Field = { wire: number; value: bigint | Buffer };
type Message = Map<number, Field[]>;

function readVarint(buf: Buffer, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error("varint tronque");
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7n;
  }
}

function decode(buf: Buffer): Message {
  const msg: Message = new Map();
  let pos = 0;
  while (pos < buf.length) {
    const [key, p1] = readVarint(buf, pos);
    pos = p1;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    let value: bigint | Buffer;
    if (wire === 0) {
      [value, pos] = readVarint(buf, pos);
    } else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      value = buf.subarray(p2, p2 + Number(len));
      pos = p2 + Number(len);
    } else if (wire === 1) {
      value = buf.readBigUInt64LE(pos);
      pos += 8;
    } else if (wire === 5) {
      value = BigInt(buf.readUInt32LE(pos));
      pos += 4;
    } else {
      throw new Error(`type de champ protobuf inconnu ${wire}`);
    }
    const list = msg.get(field) ?? [];
    list.push({ wire, value });
    msg.set(field, list);
  }
  return msg;
}

const sub = (m: Message, f: number): Message[] =>
  (m.get(f) ?? []).filter((x) => Buffer.isBuffer(x.value)).map((x) => decode(x.value as Buffer));
const first = (m: Message, f: number): Message | null => sub(m, f)[0] ?? null;
const str = (m: Message | null, f: number): string | undefined => {
  const v = m?.get(f)?.[0]?.value;
  return Buffer.isBuffer(v) ? v.toString("utf8") : undefined;
};
const num = (m: Message | null, f: number): number | undefined => {
  const v = m?.get(f)?.[0]?.value;
  return typeof v === "bigint" ? Number(v) : undefined;
};
/** int32 encode en varint : les negatifs arrivent sur 64 bits. */
const int32 = (m: Message | null, f: number): number | undefined => {
  const v = m?.get(f)?.[0]?.value;
  return typeof v === "bigint" ? Number(BigInt.asIntN(64, v)) : undefined;
};

export interface StopUpdate {
  seq?: number;
  stopId?: string;
  /** Horaires absolus (secondes Unix) ou retard (secondes). */
  arrivalTime?: number;
  arrivalDelay?: number;
  departureTime?: number;
  departureDelay?: number;
  skipped: boolean;
}

export interface TripUpdate {
  tripId: string;
  routeId?: string;
  startDate?: string;
  cancelled: boolean;
  delay?: number;
  stops: StopUpdate[];
}

export interface Alert {
  id: string;
  header: string;
  description: string;
  routeIds: string[];
  start: number | null;
  end: number | null;
}

/** Texte francais de preference, sinon la premiere traduction. */
function translated(m: Message | null): string {
  if (!m) return "";
  const items = sub(m, 1).map((t) => ({ text: str(t, 1) ?? "", lang: str(t, 2) ?? "" }));
  return (items.find((t) => t.lang.startsWith("fr")) ?? items[0])?.text.trim() ?? "";
}

export function decodeTripUpdates(buf: Buffer): Map<string, TripUpdate> {
  const feed = decode(buf);
  const out = new Map<string, TripUpdate>();
  for (const entity of sub(feed, 2)) {
    const tu = first(entity, 3);
    if (!tu) continue;
    const trip = first(tu, 1);
    const tripId = str(trip, 1);
    if (!tripId) continue;
    const stops: StopUpdate[] = sub(tu, 2).map((s) => {
      const arr = first(s, 2);
      const dep = first(s, 3);
      return {
        seq: num(s, 1),
        stopId: str(s, 4),
        arrivalTime: num(arr, 2),
        arrivalDelay: int32(arr, 1),
        departureTime: num(dep, 2),
        departureDelay: int32(dep, 1),
        // StopTimeUpdate.ScheduleRelationship : 1 = SKIPPED
        skipped: num(s, 5) === 1,
      };
    });
    stops.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    out.set(tripId, {
      tripId,
      routeId: str(trip, 5),
      startDate: str(trip, 3),
      // TripDescriptor.ScheduleRelationship : 3 = CANCELED
      cancelled: num(trip, 4) === 3,
      delay: int32(tu, 5),
      stops,
    });
  }
  return out;
}

export function decodeAlerts(buf: Buffer): Alert[] {
  const feed = decode(buf);
  const out: Alert[] = [];
  for (const entity of sub(feed, 2)) {
    const alert = first(entity, 5);
    if (!alert) continue;
    const period = first(alert, 1);
    out.push({
      id: str(entity, 1) ?? "",
      header: translated(first(alert, 10)),
      description: translated(first(alert, 11)),
      routeIds: sub(alert, 5).map((e) => str(e, 2)).filter((x): x is string => !!x),
      start: num(period, 1) ?? null,
      end: num(period, 2) ?? null,
    });
  }
  return out.filter((a) => a.header || a.description);
}

const cache = new Map<string, { at: number; data: unknown }>();

/** Telecharge un flux temps reel ; garde 30 s en cache pour menager le serveur. */
async function cached<T>(url: string, parse: (b: Buffer) => T, ttlMs = 30000): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  // Mode apercu : flux temps reel vide (aucune requete reseau).
  if (url.startsWith("demo-rt://")) return parse(Buffer.alloc(0));
  const data = parse(await getBuffer(url, { accept: "application/x-protobuf" }, 15000));
  cache.set(url, { at: Date.now(), data });
  return data;
}

export const fetchTripUpdates = (url: string): Promise<Map<string, TripUpdate>> => cached(url, decodeTripUpdates);
export const fetchAlerts = (url: string): Promise<Alert[]> => cached(url, decodeAlerts, 120000);

/**
 * Horaire corrige d'un passage. On cherche la mise a jour de l'arret ;
 * a defaut, le dernier retard connu en amont se propage (regle GTFS-RT).
 */
export function applyUpdate(
  update: TripUpdate | undefined,
  call: { stopId: string; seq: number },
  scheduled: Date,
  kind: "arrival" | "departure",
): { time: Date; realtime: boolean; skipped: boolean } {
  if (!update) return { time: scheduled, realtime: false, skipped: false };
  const exact = update.stops.find((s) => (s.seq !== undefined && s.seq === call.seq) || (s.seq === undefined && s.stopId === call.stopId));
  const upstream = [...update.stops].reverse().find((s) => s.seq !== undefined && s.seq < call.seq);
  const ref = exact ?? upstream;

  if (ref) {
    const abs = kind === "arrival" ? (ref.arrivalTime ?? ref.departureTime) : (ref.departureTime ?? ref.arrivalTime);
    const delay = kind === "arrival" ? (ref.arrivalDelay ?? ref.departureDelay) : (ref.departureDelay ?? ref.arrivalDelay);
    if (exact && abs) return { time: new Date(abs * 1000), realtime: true, skipped: exact.skipped };
    if (delay !== undefined) return { time: new Date(scheduled.getTime() + delay * 1000), realtime: true, skipped: !!exact?.skipped };
    if (abs && !exact) {
      // Seul un horaire absolu en amont : on en deduit son retard.
      return { time: scheduled, realtime: false, skipped: false };
    }
  }
  if (update.delay !== undefined) return { time: new Date(scheduled.getTime() + update.delay * 1000), realtime: true, skipped: false };
  return { time: scheduled, realtime: false, skipped: !!exact?.skipped };
}
