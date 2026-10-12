/** Outils partages par le moteur de transport. */

export async function getJSON(url: string, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<any> {
  const res = await fetchWithTimeout(url, headers, timeoutMs);
  return res.json();
}

export async function getBuffer(url: string, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<Buffer> {
  const res = await fetchWithTimeout(url, headers, timeoutMs);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchWithTimeout(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mnemosyne (bot PRONOTE open source)", ...headers },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${new URL(url).host}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalise un nom pour la recherche (accents, casse, ponctuation). */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Trie par pertinence : nom exact, debut de nom, debut d'un mot, puis contenu. */
export function rankByName<T>(items: T[], query: string, name: (x: T) => string): T[] {
  const q = normalizeName(query);
  if (!q) return [];
  return items
    .map((item) => {
      const n = normalizeName(name(item));
      let score = -1;
      if (n === q) score = 0;
      else if (n.startsWith(q)) score = 1;
      else if (n.split(" ").some((w) => w.startsWith(q))) score = 2;
      else if (n.includes(q)) score = 3;
      return { item, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.item);
}

/** Distance en metres entre deux points (haversine). */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Marche a environ 4,8 km/h, arrondie a la minute superieure. */
export function walkMinutes(meters: number): number {
  return Math.max(1, Math.ceil(meters / 80));
}

/** Composantes calendaires d'un instant dans un fuseau donne. */
export function zonedParts(date: Date, timeZone: string): { y: number; m: number; d: number; h: number; min: number; s: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, min: +parts.minute, s: +parts.second, weekday };
}

/**
 * Instant absolu correspondant a une heure "murale" dans `timeZone`.
 * Deux passes pour encaisser les changements d'heure.
 */
export function wallTimeToDate(y: number, m: number, d: number, seconds: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0) + seconds * 1000;
  const offset = (t: number): number => {
    const p = zonedParts(new Date(t), timeZone);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

/** "20261013" dans le fuseau donne. */
export function ymd(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.y}${String(p.m).padStart(2, "0")}${String(p.d).padStart(2, "0")}`;
}
