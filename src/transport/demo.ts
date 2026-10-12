import zlib from "node:zlib";

/**
 * Reseaux de demonstration, utilises par le mode apercu (`npm run preview`)
 * et par les tests : un catalogue fictif et un GTFS genere a la volee.
 * Aucune donnee reelle, aucune requete reseau.
 */

const logo = (letter: string, bg: string, fg = "#ffffff"): string =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/><text x="32" y="43" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="30" fill="${fg}">${letter}</text></svg>`,
  ).toString("base64")}`;

const DEMO = [
  { id: "demo-aster", name: "Aster", aom: "Métropole de Mnémé", area: "Mnémé, Clio-sur-Mer", sub: ["urban"], logo: logo("A", "#f472b6", "#100c1c"), rt: true },
  { id: "demo-helios", name: "Hélios Cars", aom: "Région Olympe", area: "Région Olympe", sub: ["intercity", "school"], logo: logo("H", "#fbbf24", "#1a171c"), rt: false },
  { id: "demo-thalassa", name: "Thalassa", aom: "Agglomération de Délos", area: "Délos", sub: ["urban", "maritime"], logo: logo("T", "#38bdf8", "#0b1a26"), rt: true },
  { id: "demo-iris", name: "Iris Tram", aom: "Ville d'Égée", area: "Égée", sub: ["urban"], logo: logo("I", "#a78bfa"), rt: true },
  { id: "demo-eos", name: "Éos Mobilités", aom: "Communauté de Naxos", area: "Naxos", sub: ["urban", "on-demand"], logo: logo("É", "#34d399", "#06281c"), rt: false },
];

export function demoDatasets(): unknown[] {
  return DEMO.map((d) => ({
    id: d.id,
    type: "public-transit",
    title: d.name,
    slug: d.id,
    logo: d.logo,
    sub_types: d.sub,
    offers: [{ nom_commercial: d.name, nom_aom: d.aom }],
    covered_area: [{ nom: d.area }],
    resources: [
      { format: "GTFS", url: `demo://${d.id}`, is_available: true },
      ...(d.rt ? [{ format: "gtfs-rt", url: `demo-rt://${d.id}`, features: ["trip_updates"] }] : []),
    ],
    page_url: "https://transport.data.gouv.fr",
  }));
}

// ------------------------------------------------------------ GTFS fictif

const pad = (n: number): string => String(n).padStart(2, "0");
const hms = (s: number): string => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;

function demoFiles(): Record<string, string> {
  const stops = [
    ["home", "Mairie", 45.0, 2.0],
    ["agora", "Agora", 45.004, 2.006],
    ["thermes", "Thermes", 45.009, 2.012],
    ["school", "Lycée Victor-Hugo", 45.016, 2.02],
    ["port", "Port", 45.02, 2.03],
    ["home_t", "Mairie", 45.0007, 2.0009],
    ["school_t", "Lycée Victor-Hugo", 45.0164, 2.0195],
  ];
  const routes = [
    ["L15", "15", "Port ↔ Mairie", "3", "F472B6", "100C1C"],
    ["TA", "A", "Tram A", "0", "A78BFA", "FFFFFF"],
  ];
  const trips: string[] = [];
  const times: string[] = [];
  let n = 0;
  const run = (route: string, path: [string, number][], from: number, to: number, every: number, headsign: string): void => {
    for (let t = from; t <= to; t += every) {
      const id = `${route}_${n++}`;
      trips.push(`${route},WEEK,${id},${headsign}`);
      let seq = 1;
      for (const [stop, offset] of path) {
        const at = hms(t + offset * 60);
        times.push(`${id},${at},${at},${stop},${seq++}`);
      }
    }
  };
  // Bus 15 : 18 minutes de la Mairie au lycee, toutes les 12 minutes.
  run("L15", [["home", 0], ["agora", 5], ["thermes", 11], ["school", 18], ["port", 24]], 5 * 3600 + 30 * 60, 21 * 3600, 12 * 60, "Port");
  run("L15", [["port", 0], ["school", 6], ["thermes", 13], ["agora", 19], ["home", 24]], 6 * 3600, 21 * 3600 + 30 * 60, 12 * 60, "Mairie");
  // Tram A : plus rapide, toutes les 8 minutes.
  run("TA", [["home_t", 0], ["school_t", 13]], 5 * 3600 + 45 * 60, 22 * 3600, 8 * 60, "Lycée");
  run("TA", [["school_t", 0], ["home_t", 13]], 6 * 3600, 22 * 3600, 8 * 60, "Mairie");

  const year = new Date().getFullYear();
  return {
    "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nDEMO,Aster,https://example.org,Europe/Paris\n",
    "stops.txt": `stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n${stops.map((s) => `${s[0]},${s[1]},${s[2]},${s[3]},0,`).join("\n")}\n`,
    "routes.txt": `route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color\n${routes.map((r) => `${r[0]},DEMO,${r.slice(1).join(",")}`).join("\n")}\n`,
    "trips.txt": `route_id,service_id,trip_id,trip_headsign\n${trips.join("\n")}\n`,
    "stop_times.txt": `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${times.join("\n")}\n`,
    "calendar.txt": `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWEEK,1,1,1,1,1,1,0,${year - 1}0101,${year + 1}1231\n`,
  };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Archive ZIP minimale (deflate), suffisante pour un GTFS. */
export function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, "utf8");
    const data = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(raw);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0, 10);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, nameBuf, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += head.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}

export function demoGtfs(): Buffer {
  return zip(demoFiles());
}
