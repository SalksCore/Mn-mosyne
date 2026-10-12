import express, { type Request, type Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccountKind, cleanURL, geolocation, instance } from "pawnote";
import { DEFAULT_CONFIG, getConfig, getCredentials, getSnapshot, resetAll, saveConfig } from "../store/db.js";
import {
  completeSecurity,
  explainLoginError,
  firstLogin,
  isLinked,
  pendingSecurityRequest,
  qrLogin,
  SecurityRequiredError,
  suspensionRemaining,
  unlink,
} from "../pronote/client.js";
import { networkById, searchNetworks } from "../transport/catalog.js";
import { cachedIndex, loadIndex, progress } from "../transport/gtfs/feed.js";
import { commonLines, currentNetwork, linesOf, nearbyStops, searchStops, stopById } from "../transport/engine.js";
import { planEvening, planMorning, type Plan } from "../transport/plan.js";
import { renderDay } from "../render/timetable.js";
import { renderGrades } from "../render/grades.js";
import { renderBag } from "../render/bag.js";
import { renderChanges } from "../render/changes.js";
import { renderTransport } from "../render/transport.js";
import { normalizeHex, subjectKey } from "../render/theme.js";
import { bridge } from "./bridge.js";
import {
  consumeLinkToken,
  createLinkToken,
  createSession,
  destroyAllSessions,
  destroySession,
  hasSession,
  requireSession,
  sameOrigin,
} from "./auth.js";
import { demoSnapshot } from "./demo.js";
import type { BotConfig, Change, TransportConfig } from "../types.js";

/**
 * Panneau web de Mnemosyne : toute la configuration se fait ici, du token
 * Discord jusqu'aux arrets de bus. On y entre par un lien a usage unique
 * (commande /setup, /config web, ou console au premier demarrage) ; le
 * lien est echange contre un cookie de session valable 30 jours.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, "../../web");
// Pterodactyl et la plupart des hebergeurs imposent leur port via SERVER_PORT.
const PORT = Number(process.env.WEB_PORT || process.env.SERVER_PORT || 8787);
const HOST = process.env.WEB_HOST ?? "0.0.0.0";

export function publicUrl(): string {
  const fallback = process.env.SERVER_IP && process.env.SERVER_IP !== "0.0.0.0" ? `http://${process.env.SERVER_IP}:${PORT}` : `http://localhost:${PORT}`;
  return (process.env.PUBLIC_URL || fallback).replace(/\/+$/, "");
}

/** Lien d'entree a usage unique vers une page du panneau (15 minutes). */
export function panelLink(page = "/"): string {
  const token = createLinkToken();
  const next = page === "/" ? "" : `?next=${encodeURIComponent(page)}`;
  return `${publicUrl()}/entrer/${token}${next}`;
}

let server: ReturnType<express.Express["listen"]> | null = null;

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((err) => {
      console.error("[web] erreur:", err);
      if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : "Erreur interne" });
    });
  };

const fail = (res: Response, status: number, error: string, extra: Record<string, unknown> = {}): void => {
  res.status(status).json({ error, ...extra });
};

// ------------------------------------------------------------------- etat

const hm = (d: Date | null | undefined): string | null =>
  d ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : null;

function planJSON(plan: Plan | null) {
  if (!plan) return null;
  return {
    kind: plan.kind,
    network: plan.network.name,
    from: plan.fromStop.name,
    to: plan.toStop.name,
    deadline: plan.kind === "morning" ? hm(plan.deadline) : null,
    notifyAt: plan.kind === "morning" ? hm(plan.notifyAt) : null,
    firstLesson: plan.kind === "morning" && plan.firstLesson ? { subject: plan.firstLesson.subject, start: hm(new Date(plan.firstLesson.start)) } : null,
    releaseAt: plan.kind === "evening" ? hm(plan.releaseAt) : null,
    best: plan.best ? plan.options.indexOf(plan.best) : -1,
    options: plan.options.map((o) => ({
      line: o.journey.line.short,
      color: o.journey.line.color,
      textColor: o.journey.line.textColor,
      mode: o.journey.mode,
      headsign: o.journey.headsign,
      departure: hm(o.journey.departure),
      arrival: hm(o.journey.arrival),
      leaveAt: hm(o.leaveAt),
      arriveAt: hm(o.arriveAt),
      margin: o.marginMinutes,
      delay: o.journey.delayMinutes,
      realtime: o.journey.realtime,
      cancelled: o.journey.cancelled,
      viable: o.viable,
      issue: o.issue ?? null,
    })),
  };
}

async function state() {
  const cfg = getConfig();
  const creds = getCredentials();
  const snap = getSnapshot();
  const discord = await bridge().discord();
  const network = cfg.transport.networkId ? await currentNetwork().catch(() => null) : null;
  const index = network ? cachedIndex(network.id) : null;
  const sync = bridge().syncStatus();

  const steps = {
    discord: discord.configured && discord.ready,
    owner: !!cfg.ownerId,
    pronote: isLinked(),
    profile: !!cfg.displayName,
    transport: cfg.transport.enabled && !!cfg.transport.homeStopId && !!cfg.transport.schoolStopId,
  };

  return {
    preview: bridge().preview,
    version: process.env.npm_package_version ?? "2.0.0",
    steps,
    discord,
    pronote: {
      linked: isLinked(),
      url: creds?.url ?? null,
      username: creds?.username ?? null,
      kind: creds?.kind ?? null,
      studentName: snap?.studentName ?? null,
      className: snap?.className ?? null,
      lastSync: snap?.fetchedAt ?? null,
      lastError: sync.lastError,
      security: pendingSecurityRequest(),
      pausedFor: suspensionRemaining(),
      counts: snap
        ? { lessons: snap.lessons.length, assignments: snap.assignments.length, grades: snap.grades.length, discussions: snap.discussions.length }
        : null,
      subjects: snap ? [...new Set(snap.lessons.map((l) => l.subject))].sort((a, b) => a.localeCompare(b, "fr")) : [],
    },
    config: {
      displayName: cfg.displayName,
      timezone: cfg.timezone,
      morningBriefTime: cfg.morningBriefTime,
      eveningBriefTime: cfg.eveningBriefTime,
      morningBriefEnabled: cfg.morningBriefEnabled,
      eveningBriefEnabled: cfg.eveningBriefEnabled,
      pollIntervalMinutes: cfg.pollIntervalMinutes,
      notifications: cfg.notifications,
      quietHours: cfg.quietHours,
      imageTheme: cfg.imageTheme,
      colorImminent: cfg.colorImminent,
      colorFuture: cfg.colorFuture,
      subjectColors: cfg.subjectColors,
      bag: cfg.bag,
    },
    transport: {
      ...cfg.transport,
      network: network
        ? { id: network.id, name: network.name, logo: network.logo, area: network.area, realtime: !!network.tripUpdatesUrl, alerts: !!network.alertsUrl }
        : null,
      indexed: index ? { stops: index.stops.length, lines: Object.keys(index.lines).length, builtAt: index.builtAt } : null,
      progress: network ? (progress.get(network.id) ?? null) : null,
      homeStop: index && cfg.transport.homeStopId ? stopPayload(index, cfg.transport.homeStopId) : null,
      schoolStop: index && cfg.transport.schoolStopId ? stopPayload(index, cfg.transport.schoolStopId) : null,
      directLines:
        index && cfg.transport.homeStopId && cfg.transport.schoolStopId
          ? (() => {
              const a = stopById(index, cfg.transport.homeStopId);
              const b = stopById(index, cfg.transport.schoolStopId);
              return a && b ? commonLines(index, a, b).map(linePayload) : [];
            })()
          : [],
    },
  };
}

type Index = NonNullable<ReturnType<typeof cachedIndex>>;

function linePayload(l: { id: string; short: string; long: string; color: string | null; textColor: string | null; type: number }) {
  return { id: l.id, short: l.short, long: l.long, color: l.color, textColor: l.textColor, type: l.type };
}

function stopPayload(index: Index, id: string) {
  const s = stopById(index, id);
  if (!s) return null;
  return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, lines: linesOf(index, s).map(linePayload) };
}

// --------------------------------------------------------- validations

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function cleanConfigPatch(body: Record<string, unknown>): Partial<BotConfig> {
  const cfg = getConfig();
  const patch: Partial<BotConfig> = {};
  if (typeof body.displayName === "string") patch.displayName = body.displayName.trim().slice(0, 40);
  if (typeof body.timezone === "string") {
    try {
      new Intl.DateTimeFormat("fr-FR", { timeZone: body.timezone });
      patch.timezone = body.timezone;
    } catch {
      throw new Error("Fuseau horaire inconnu.");
    }
  }
  for (const key of ["morningBriefTime", "eveningBriefTime"] as const) {
    if (typeof body[key] === "string") {
      if (!HHMM.test(body[key] as string)) throw new Error("Heure invalide (format HH:MM).");
      patch[key] = body[key] as string;
    }
  }
  for (const key of ["morningBriefEnabled", "eveningBriefEnabled"] as const) {
    if (typeof body[key] === "boolean") patch[key] = body[key] as boolean;
  }
  if (body.pollIntervalMinutes !== undefined) {
    const n = Number(body.pollIntervalMinutes);
    if (!Number.isInteger(n) || n < 2 || n > 120) throw new Error("Intervalle entre 2 et 120 minutes.");
    patch.pollIntervalMinutes = n;
  }
  if (body.notifications && typeof body.notifications === "object") {
    const next = { ...cfg.notifications };
    for (const [k, v] of Object.entries(body.notifications as Record<string, unknown>)) {
      if (k in next && typeof v === "boolean") (next as Record<string, boolean>)[k] = v;
    }
    patch.notifications = next;
  }
  if (body.quietHours && typeof body.quietHours === "object") {
    const q = body.quietHours as Record<string, unknown>;
    const next = { ...cfg.quietHours };
    if (typeof q.enabled === "boolean") next.enabled = q.enabled;
    for (const k of ["start", "end"] as const) {
      if (typeof q[k] === "string") {
        if (!HHMM.test(q[k] as string)) throw new Error("Heure invalide (format HH:MM).");
        next[k] = q[k] as string;
      }
    }
    patch.quietHours = next;
  }
  if (body.imageTheme && typeof body.imageTheme === "object") {
    const next = { ...cfg.imageTheme };
    for (const [k, v] of Object.entries(body.imageTheme as Record<string, unknown>)) {
      if (k in next && (v === "clair" || v === "sombre")) (next as Record<string, string>)[k] = v;
    }
    patch.imageTheme = next;
  }
  for (const key of ["colorImminent", "colorFuture"] as const) {
    if (typeof body[key] === "string") {
      const hex = normalizeHex(body[key] as string);
      if (!hex) throw new Error("Couleur hexadécimale invalide.");
      patch[key] = hex;
    }
  }
  if (body.subjectColors && typeof body.subjectColors === "object") {
    const next: Record<string, string> = {};
    for (const [subject, color] of Object.entries(body.subjectColors as Record<string, unknown>)) {
      const hex = typeof color === "string" ? normalizeHex(color) : null;
      if (hex) next[subjectKey(subject)] = hex;
    }
    patch.subjectColors = next;
  }
  if (body.bag && typeof body.bag === "object") {
    const next: BotConfig["bag"] = {};
    for (const [subject, items] of Object.entries(body.bag as Record<string, unknown>)) {
      if (!Array.isArray(items)) continue;
      const clean = items
        .map((it) => ({ label: String((it as { label?: unknown }).label ?? "").trim().slice(0, 60), color: normalizeHex(String((it as { color?: unknown }).color ?? "")) ?? "#9a95a3" }))
        .filter((it) => it.label);
      if (clean.length) next[subjectKey(subject)] = clean;
    }
    patch.bag = next;
  }
  return patch;
}

function cleanTransportPatch(body: Record<string, unknown>): Partial<TransportConfig> {
  const patch: Partial<TransportConfig> = {};
  const ints: Array<[keyof TransportConfig, number, number]> = [
    ["walkToHomeStop", 0, 60],
    ["walkFromSchoolStop", 0, 60],
    ["walkToSchoolStop", 0, 60],
    ["walkFromHomeStop", 0, 60],
    ["arriveMinBefore", 0, 90],
    ["notifyLeadMinutes", 0, 120],
    ["delayAlertMinutes", 1, 30],
    ["morningWatchMinutes", 5, 180],
    ["eveningWatchMinutes", 5, 180],
  ];
  for (const [key, min, max] of ints) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Valeur hors limites pour ${key} (${min}-${max}).`);
    (patch as Record<string, number>)[key] = Math.round(n);
  }
  for (const key of ["enabled", "eveningEnabled", "disruptionAlerts"] as const) {
    if (typeof body[key] === "boolean") patch[key] = body[key] as boolean;
  }
  if (Array.isArray(body.lines)) patch.lines = body.lines.filter((x): x is string => typeof x === "string").slice(0, 30);
  for (const key of ["homeStopId", "schoolStopId"] as const) {
    if (typeof body[key] === "string") patch[key] = body[key] as string;
  }
  return patch;
}

// -------------------------------------------------------------- pages

function sendPage(res: Response, file: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(WEB_DIR, file));
}

function previewSnapshot() {
  return getSnapshot() ?? demoSnapshot();
}

// --------------------------------------------------------------- routes

function buildApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "256kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.use("/img", express.static(path.join(WEB_DIR, "img"), { maxAge: "7d" }));
  app.use("/fonts", express.static(path.join(WEB_DIR, "fonts"), { maxAge: "30d" }));
  app.use("/static", express.static(path.join(WEB_DIR, "static"), { maxAge: 0 }));

  const secure = (req: Request) => req.secure || publicUrl().startsWith("https://");

  // Entree par lien a usage unique
  app.get("/entrer/:token", (req, res) => {
    if (!consumeLinkToken(req.params.token)) {
      res.redirect("/?lien=expire");
      return;
    }
    createSession(res, secure(req));
    const next = typeof req.query.next === "string" && req.query.next.startsWith("/") ? req.query.next : "/";
    res.redirect(`/${next === "/" ? "" : `#${next.slice(1)}`}`);
  });

  // Entree par code d'acces (le jeton du lien, colle a la main)
  app.post("/api/entrer", sameOrigin, (req, res) => {
    const raw = String(req.body?.code ?? "").trim();
    const code = raw.includes("/entrer/") ? raw.split("/entrer/")[1].split(/[?#]/)[0] : raw;
    if (!code || !consumeLinkToken(code)) {
      fail(res, 403, "Code invalide ou expiré. Demande un nouveau lien avec /config web, ou relance le bot pour en afficher un dans la console.");
      return;
    }
    createSession(res, secure(req));
    res.json({ ok: true });
  });

  app.get("/", (req, res) => sendPage(res, hasSession(req) ? "panel.html" : "login.html"));

  // Tout ce qui suit exige une session.
  const api = express.Router();
  api.use(requireSession, sameOrigin);

  api.get("/state", asyncRoute(async (_req, res) => res.json(await state())));

  api.post("/logout", (req, res) => {
    destroySession(req, res);
    res.json({ ok: true });
  });

  // --- Discord
  api.post(
    "/discord",
    asyncRoute(async (req, res) => {
      const token = String(req.body?.token ?? "").trim();
      if (!/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(token)) return fail(res, 400, "Ce n'est pas un token de bot Discord valide.");
      try {
        const { tag } = await bridge().connectDiscord(token);
        res.json({ ok: true, tag });
      } catch (err) {
        fail(res, 400, err instanceof Error ? err.message : "Connexion à Discord impossible.");
      }
    }),
  );

  // --- PRONOTE
  api.post(
    "/pronote/geo",
    asyncRoute(async (req, res) => {
      const latitude = Number(req.body?.latitude);
      const longitude = Number(req.body?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return fail(res, 400, "Position invalide.");
      const found = await geolocation({ latitude, longitude });
      res.json({ results: found.slice(0, 20).map((f) => ({ name: f.name, url: f.url, postalCode: f.postalCode, distance: f.distance })) });
    }),
  );

  api.post(
    "/pronote/instance",
    asyncRoute(async (req, res) => {
      const raw = String(req.body?.url ?? "").trim();
      if (!raw) return fail(res, 400, "Renseigne l'adresse de ton espace PRONOTE.");
      try {
        const url = cleanURL(raw.startsWith("http") ? raw : `https://${raw}`);
        const info = await instance(url);
        res.json({
          url,
          name: info.name,
          version: info.version.join("."),
          ent: !!info.casURL,
          casURL: info.casURL ?? null,
          webLogin: info.casURL ?? `${url}/eleve.html`,
          accounts: info.accounts.map((a) => a.name),
        });
      } catch (err) {
        fail(res, 400, explainLoginError(err));
      }
    }),
  );

  const linked = async (res: Response, studentName: string, url: string): Promise<void> => {
    bridge().pronoteLinked();
    res.json({ ok: true, studentName, url });
  };

  api.post(
    "/pronote/login",
    asyncRoute(async (req, res) => {
      const url = String(req.body?.url ?? "").trim();
      const username = String(req.body?.username ?? "").trim();
      const password = String(req.body?.password ?? "");
      const kind = Number(req.body?.kind ?? AccountKind.STUDENT) as AccountKind;
      if (!url || !username || !password) return fail(res, 400, "Adresse, identifiant et mot de passe sont nécessaires.");
      try {
        const session = await firstLogin({ url, kind, username, password, deviceUUID: crypto.randomUUID() });
        await linked(res, session.userResource.name || username, session.information.url);
      } catch (err) {
        if (err instanceof SecurityRequiredError) return fail(res, 409, err.message, { security: err.request });
        fail(res, 400, explainLoginError(err));
      }
    }),
  );

  api.post(
    "/pronote/qr",
    asyncRoute(async (req, res) => {
      const pin = String(req.body?.pin ?? "").trim();
      let qr: unknown = req.body?.qr;
      if (typeof qr === "string") {
        try {
          qr = JSON.parse(qr);
        } catch {
          return fail(res, 400, "Le contenu du QR code n'est pas reconnu. Scanne-le à nouveau.");
        }
      }
      if (!qr || typeof qr !== "object" || !/^\d{4}$/.test(pin)) return fail(res, 400, "Il faut le QR code et le code à 4 chiffres choisi dans PRONOTE.");
      try {
        const session = await qrLogin({ qr, pin, deviceUUID: crypto.randomUUID() });
        await linked(res, session.userResource.name, session.information.url);
      } catch (err) {
        if (err instanceof SecurityRequiredError) return fail(res, 409, err.message, { security: err.request });
        fail(res, 400, `${explainLoginError(err)} Le QR code expire vite : génère-le à nouveau juste avant.`);
      }
    }),
  );

  api.post(
    "/pronote/security",
    asyncRoute(async (req, res) => {
      try {
        const session = await completeSecurity({
          pin: req.body?.pin ? String(req.body.pin) : undefined,
          newPassword: req.body?.newPassword ? String(req.body.newPassword) : undefined,
        });
        await linked(res, session.userResource.name, session.information.url);
      } catch (err) {
        fail(res, 400, explainLoginError(err));
      }
    }),
  );

  api.post("/pronote/unlink", (_req, res) => {
    unlink();
    res.json({ ok: true });
  });

  api.post(
    "/sync",
    asyncRoute(async (_req, res) => {
      const error = await bridge().syncNow(false);
      res.json({ ok: !error, error });
    }),
  );

  // --- Reglages generaux
  api.post("/config", (req, res) => {
    try {
      const patch = cleanConfigPatch(req.body ?? {});
      saveConfig(patch);
      bridge().configChanged();
      res.json({ ok: true });
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : "Réglage invalide.");
    }
  });

  // --- Transport
  api.get(
    "/transport/networks",
    asyncRoute(async (req, res) => {
      try {
        const list = await searchNetworks(String(req.query.q ?? ""), 24);
        res.json({
          results: list.map((n) => ({
            id: n.id,
            name: n.name,
            authority: n.authority,
            area: n.area,
            logo: n.logo,
            kinds: n.kinds,
            realtime: !!n.tripUpdatesUrl,
            alerts: !!n.alertsUrl,
          })),
        });
      } catch (err) {
        fail(res, 502, `Catalogue national injoignable : ${err instanceof Error ? err.message : err}`);
      }
    }),
  );

  api.post(
    "/transport/network",
    asyncRoute(async (req, res) => {
      const cfg = getConfig();
      const custom = req.body?.custom as Record<string, unknown> | undefined;
      let next: Partial<TransportConfig>;
      if (custom) {
        const gtfs = String(custom.gtfsUrl ?? "").trim();
        if (!/^https?:\/\//.test(gtfs)) return fail(res, 400, "L'adresse du GTFS doit commencer par http(s)://");
        next = {
          networkId: "custom",
          networkName: String(custom.name ?? "").trim() || "Réseau personnalisé",
          networkLogo: null,
          customGtfsUrl: gtfs,
          customTripUpdatesUrl: String(custom.tripUpdatesUrl ?? "").trim(),
          customAlertsUrl: String(custom.alertsUrl ?? "").trim(),
        };
      } else {
        const network = await networkById(String(req.body?.id ?? ""));
        if (!network) return fail(res, 404, "Réseau introuvable dans le catalogue.");
        next = { networkId: network.id, networkName: network.name, networkLogo: network.logo };
      }
      const changed = next.networkId !== cfg.transport.networkId || next.customGtfsUrl !== cfg.transport.customGtfsUrl;
      saveConfig({
        transport: {
          ...cfg.transport,
          ...next,
          ...(changed ? { homeStopId: "", schoolStopId: "", lines: [], enabled: false } : {}),
        },
      });
      const network = await currentNetwork();
      if (network) {
        // L'indexation peut prendre une minute sur un grand reseau : le
        // panneau suit son avancement via /state.
        loadIndex(network).catch((err) => console.warn("[gtfs] indexation en echec:", err instanceof Error ? err.message : err));
      }
      res.json({ ok: true });
    }),
  );

  api.get(
    "/transport/stops",
    asyncRoute(async (req, res) => {
      const network = await currentNetwork();
      const index = network ? cachedIndex(network.id) : null;
      if (!index) return fail(res, 409, "Les horaires du réseau sont encore en cours de chargement.");
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      const stops = Number.isFinite(lat) && Number.isFinite(lon) && req.query.lat !== undefined
        ? nearbyStops(index, lat, lon, 800).slice(0, 12).map((x) => ({ ...stopPayload(index, x.stop.id)!, meters: Math.round(x.meters) }))
        : searchStops(index, String(req.query.q ?? ""), 12).map((s) => stopPayload(index, s.id)!);
      res.json({ results: stops });
    }),
  );

  api.post("/transport/config", (req, res) => {
    try {
      const cfg = getConfig();
      const patch = cleanTransportPatch(req.body ?? {});
      const merged = { ...cfg.transport, ...patch };
      if (merged.enabled && (!merged.networkId || !merged.homeStopId || !merged.schoolStopId)) {
        throw new Error("Choisis d'abord un réseau et tes deux arrêts.");
      }
      saveConfig({ transport: merged });
      bridge().transportChanged();
      res.json({ ok: true });
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : "Réglage invalide.");
    }
  });

  api.get(
    "/transport/preview",
    asyncRoute(async (req, res) => {
      const raw = String(req.query.day ?? "");
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date();
      const plan = req.query.sens === "retour" ? await planEvening(date) : await planMorning(date);
      res.json({ plan: planJSON(plan) });
    }),
  );

  // --- Images d'apercu : exactement ce que le bot enverra
  api.get(
    "/images/:kind",
    asyncRoute(async (req, res) => {
      const snap = previewSnapshot();
      const theme = req.query.theme === "clair" || req.query.theme === "sombre" ? (req.query.theme as "clair" | "sombre") : null;
      const cfg = getConfig();
      const original = cfg.imageTheme;
      if (theme) cfg.imageTheme = { timetable: theme, grades: theme, notifications: theme, bag: theme, transport: theme };
      try {
        let png: Buffer;
        const today = new Date();
        const firstDay = new Date(snap.lessons[0]?.start ?? today.getTime());
        switch (req.params.kind) {
          case "edt":
            png = renderDay({ date: firstDay, lessons: snap.lessons, assignments: snap.assignments, studentName: snap.studentName, className: snap.className, caption: `Bonjour ${cfg.displayName || snap.studentName.split(" ")[0]}` });
            break;
          case "notes":
            png = renderGrades({ periodName: snap.currentPeriodName ?? "Période", overallAverage: snap.overallAverage, averages: snap.averages, recentGrades: [...snap.grades].sort((a, b) => b.date - a.date), studentName: snap.studentName });
            break;
          case "sac": {
            const subjects = [...new Set(snap.lessons.filter((l) => new Date(l.start).toDateString() === firstDay.toDateString() && !l.canceled).map((l) => l.subject))];
            png = renderBag({ subjects, checked: subjects.map((_, i) => i < 2), current: 2, dateLabel: firstDay.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), studentName: snap.studentName });
            break;
          }
          case "alertes": {
            const sample: Change[] = [
              { kind: "lesson_canceled", key: "a", targetDate: today.getTime() + 3600000, subject: "Anglais", title: "Cours annulé — Anglais", detail: "aujourd'hui, 10:15-11:15 · Prof. absent" },
              { kind: "lesson_room", key: "b", targetDate: today.getTime() + 2 * 3600000, subject: "Histoire-Géographie", title: "Changement de salle — Histoire-Géographie", detail: "salle A012 → C105" },
              { kind: "homework_new", key: "c", targetDate: today.getTime() + 5 * 86400000, subject: "Philosophie", title: "Nouveau devoir — Philosophie", detail: "Dissertation : « Peut-on se fier à sa mémoire ? »" },
            ];
            png = renderChanges(sample, "Ton PRONOTE a changé");
            break;
          }
          case "trajet": {
            // Jour demande, sinon le prochain jour de cours a venir.
            const raw = String(req.query.day ?? "");
            const upcoming = snap.lessons.find((l) => l.start > Date.now() && !l.canceled);
            const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date(upcoming?.start ?? Date.now());
            const plan = req.query.sens === "retour" ? await planEvening(day).catch(() => null) : await planMorning(day).catch(() => null);
            if (!plan) return fail(res, 404, "Configure d'abord tes trajets pour voir cet aperçu.");
            const title = plan.best
              ? plan.kind === "morning" ? `Pars à ${hm(plan.best.leaveAt)}` : `Retour : ${plan.best.journey.line.short} à ${hm(plan.best.journey.departure)}`
              : "Aucun passage à l'heure";
            png = renderTransport(plan, title);
            break;
          }
          default:
            return fail(res, 404, "Image inconnue.");
        }
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        res.end(png);
      } finally {
        cfg.imageTheme = original;
      }
    }),
  );

  // --- Tests et maintenance
  api.post(
    "/test/:what",
    asyncRoute(async (req, res) => {
      try {
        if (req.params.what === "brief") await bridge().sendTestBrief();
        else if (req.params.what === "alerte") await bridge().sendTestAlert();
        else if (req.params.what === "trajet") await bridge().sendTestTransport();
        else return fail(res, 404, "Test inconnu.");
        res.json({ ok: true });
      } catch (err) {
        fail(res, 400, err instanceof Error ? err.message : "Envoi impossible.");
      }
    }),
  );

  api.post("/reset", (req, res) => {
    if (req.body?.confirm !== "EFFACER") return fail(res, 400, "Confirmation manquante.");
    unlink();
    resetAll();
    saveConfig({ ...DEFAULT_CONFIG });
    destroyAllSessions();
    bridge().configChanged();
    res.json({ ok: true });
  });

  app.use("/api", api);
  app.use((_req, res) => res.status(404).sendFile(path.join(WEB_DIR, "login.html")));
  return app;
}

export function startWebServer(): void {
  if (server) return;
  if (!fs.existsSync(path.join(WEB_DIR, "panel.html"))) console.warn(`[web] dossier web introuvable : ${WEB_DIR}`);
  server = buildApp().listen(PORT, HOST, () => {
    console.log(`[web] panneau sur ${publicUrl()}`);
  });
}

export function stopServer(): void {
  server?.close();
  server = null;
}
