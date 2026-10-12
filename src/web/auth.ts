import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { DATA_DIR } from "../store/db.js";

/**
 * Acces au panneau web.
 *
 * On n'entre jamais avec un mot de passe : on entre par un lien a usage
 * unique, delivre soit par le bot en MP (`/setup`, `/config web`), soit
 * dans la console au tout premier demarrage (personne n'a encore de
 * compte Discord lie). Le lien echange contre un cookie de session.
 */

const COOKIE = "mnemo_session";
const LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const FILE = path.join(DATA_DIR, "web-sessions.json");

interface SessionStore {
  sessions: Record<string, { createdAt: number; expiresAt: number }>;
}

const links = new Map<string, number>();

function load(): SessionStore {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as SessionStore;
  } catch {
    return { sessions: {} };
  }
}

function save(store: SessionStore): void {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, FILE);
}

/** Jeton aleatoire, comparable sans fuite temporelle. */
const randomToken = (): string => crypto.randomBytes(24).toString("base64url");

const hash = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

/** Cree un lien d'entree a usage unique, valable 15 minutes. */
export function createLinkToken(ttlMs = LINK_TTL_MS): string {
  const token = randomToken();
  links.set(hash(token), Date.now() + ttlMs);
  return token;
}

/** Consomme un lien : renvoie vrai une seule fois, s'il n'a pas expire. */
export function consumeLinkToken(token: string): boolean {
  const key = hash(token);
  const exp = links.get(key);
  links.delete(key);
  return exp !== undefined && exp > Date.now();
}

export function createSession(res: Response, secure: boolean): void {
  const token = randomToken();
  const store = load();
  const now = Date.now();
  for (const [k, v] of Object.entries(store.sessions)) if (v.expiresAt < now) delete store.sessions[k];
  store.sessions[hash(token)] = { createdAt: now, expiresAt: now + SESSION_TTL_MS };
  save(store);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

function readCookie(req: Request): string | null {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function hasSession(req: Request): boolean {
  const token = readCookie(req);
  if (!token) return false;
  const entry = load().sessions[hash(token)];
  return !!entry && entry.expiresAt > Date.now();
}

export function destroySession(req: Request, res: Response): void {
  const token = readCookie(req);
  if (token) {
    const store = load();
    delete store.sessions[hash(token)];
    save(store);
  }
  res.clearCookie(COOKIE, { path: "/" });
}

/** Deconnecte tous les navigateurs (apres une reinitialisation). */
export function destroyAllSessions(): void {
  save({ sessions: {} });
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (hasSession(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "SESSION_REQUIRED" });
}

/**
 * Les requetes qui modifient l'etat doivent venir de la page elle-meme.
 * Le cookie est deja SameSite=Lax ; on verifie en plus l'en-tete Origin.
 */
export function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        res.status(403).json({ error: "BAD_ORIGIN" });
        return;
      }
    } catch {
      res.status(403).json({ error: "BAD_ORIGIN" });
      return;
    }
  }
  next();
}

/** Au moins un navigateur a-t-il deja une session valide ? */
export function hasAnySession(): boolean {
  const now = Date.now();
  return Object.values(load().sessions).some((s) => s.expiresAt > now);
}
