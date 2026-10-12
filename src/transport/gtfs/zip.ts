import readline from "node:readline";
import yauzl, { type Entry, type ZipFile } from "yauzl";

/**
 * Lecture d'un GTFS directement dans son archive, ligne par ligne.
 * Le fichier stop_times.txt d'un grand reseau depasse le gigaoctet une fois
 * decompresse : on ne le charge jamais en entier en memoire.
 */

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error("Archive illisible"));
      else resolve(zip);
    });
  });
}

function entries(zip: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const map = new Map<string, Entry>();
    zip.on("entry", (entry: Entry) => {
      // Certains editeurs rangent les fichiers dans un sous-dossier.
      const base = entry.fileName.split("/").pop() ?? entry.fileName;
      if (base && !map.has(base)) map.set(base, entry);
      zip.readEntry();
    });
    zip.once("end", () => resolve(map));
    zip.once("error", reject);
    zip.readEntry();
  });
}

/** Decoupe une ligne CSV en respectant les champs entre guillemets. */
export function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export type RowHandler = (cols: string[], col: Record<string, number>) => void;

/**
 * Parcourt un fichier de l'archive. `onRow` recoit les colonnes brutes et
 * l'index des en-tetes. Renvoie false si le fichier est absent (beaucoup de
 * fichiers GTFS sont facultatifs).
 */
export async function eachRow(
  zipPath: string,
  fileName: string,
  onRow: RowHandler,
  onProgress?: (ratio: number) => void,
): Promise<boolean> {
  const zip = await openZip(zipPath);
  try {
    const entry = (await entries(zip)).get(fileName);
    if (!entry) return false;
    const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
      zip.openReadStream(entry, (err, s) => (err || !s ? reject(err ?? new Error("Flux illisible")) : resolve(s)));
    });

    const total = entry.uncompressedSize || 1;
    let read = 0;
    let lastReport = 0;
    let col: Record<string, number> | null = null;
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const raw of rl) {
      read += raw.length + 1;
      const line = raw.trimEnd();
      if (!line) continue;
      if (!col) {
        col = Object.fromEntries(
          splitCsv(line.replace(/^﻿/, "")).map((h, i) => [h.trim().replace(/^"|"$/g, ""), i]),
        );
        continue;
      }
      onRow(splitCsv(line), col);
      if (onProgress && read - lastReport > 4_000_000) {
        lastReport = read;
        onProgress(Math.min(1, read / total));
      }
    }
    onProgress?.(1);
    return true;
  } finally {
    zip.close();
  }
}

/** "08:05:00" ou "25:10:00" (apres minuit) -> secondes depuis le debut du jour de service. */
export function gtfsSeconds(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(\d{1,3}):(\d{2}):(\d{2})\s*$/.exec(v);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
