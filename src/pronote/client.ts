import {
  createSessionHandle,
  finishLoginManually,
  loginCredentials,
  loginQrCode,
  loginToken,
  securityCheckCustomPassword,
  securityCheckPIN,
  securitySave,
  securitySource,
  BadCredentialsError,
  DoubleAuthMode,
  RateLimitedError,
  SecurityError,
  SessionExpiredError,
  SuspendedIPError,
  type AccountKind,
  type RefreshInformation,
  type SecurityModal,
  type SessionHandle,
} from "pawnote";
import { getCredentials, saveCredentials } from "../store/db.js";
import type { StoredCredentials } from "../types.js";

/**
 * Connexion a PRONOTE.
 *
 * Depuis PRONOTE 2026, trois choses ont change et cassaient la connexion :
 *
 * 1. Le calcul du challenge d'authentification (identifiant en minuscules,
 *    encode en UTF-8). Corrige en amont par `@blockshub/pawnote-lts`.
 * 2. Le serveur verifie le User-Agent de l'application mobile sur TOUTES
 *    les requetes, pas seulement sur la page d'accueil. Notre fetcher le
 *    force donc systematiquement.
 * 3. A la premiere connexion d'un nouvel appareil, PRONOTE impose souvent
 *    la double authentification : nommer l'appareil, saisir un code PIN,
 *    voire changer de mot de passe. pawnote le signale par une
 *    `SecurityError` qu'il faut resoudre avant de finir la connexion.
 */

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PRONOTE Mobile APP Version/2.0.11";

/** Nom d'appareil affiche dans PRONOTE (Mes appareils connectes). */
export const DEVICE_NAME = "Mnemosyne";

interface PawnoteRequest {
  url: URL;
  redirect?: "follow" | "manual";
  headers?: Record<string, string> | Headers;
  method?: "GET" | "POST";
  content?: string;
}

async function pawnoteFetcher(request: PawnoteRequest) {
  const headers = new Headers(request.headers as ConstructorParameters<typeof Headers>[0]);
  headers.set("User-Agent", MOBILE_UA);
  const method = request.method ?? "GET";

  const response = await fetch(request.url.href, {
    redirect: request.redirect ?? "follow",
    headers,
    method,
    body: method !== "GET" ? request.content : undefined,
  });
  let content = await response.text();

  // PRONOTE 2026.2 ecrit « Start ({...});} catch » sur la page mobile ;
  // les versions de pawnote anterieures a la LTS attendaient « Start(...)}catch ».
  if (content.includes("Start (") && content.includes("} catch")) {
    content = content.replace(/\}\);\s*\}\s*catch/gu, "})}catch");
  }

  return {
    status: response.status,
    content,
    get headers() {
      return response.headers;
    },
  };
}

function newHandle(): SessionHandle {
  return createSessionHandle(pawnoteFetcher as never);
}

// ------------------------------------------------------------------ etat

let session: SessionHandle | null = null;
let loggingIn: Promise<SessionHandle> | null = null;

/**
 * PRONOTE suspend l'adresse IP apres trop de tentatives. Insister prolonge
 * la suspension : on se met en pause 30 minutes avant toute nouvelle connexion.
 */
const SUSPENSION_COOLDOWN_MS = 30 * 60 * 1000;
let suspendedUntil = 0;

export function suspensionRemaining(): number {
  return Math.max(0, suspendedUntil - Date.now());
}

/** Callbacks branches par le bot pour reagir a une perte de session. */
type ExpiryListener = (reason: string) => void | Promise<void>;
const expiryListeners: ExpiryListener[] = [];

export function onSessionLost(fn: ExpiryListener): void {
  expiryListeners.push(fn);
}

async function emitSessionLost(reason: string): Promise<void> {
  for (const fn of expiryListeners) {
    try {
      await fn(reason);
    } catch (err) {
      console.error("[pronote] listener expiry en erreur:", err);
    }
  }
}

export function isLinked(): boolean {
  return getCredentials() !== null;
}

function persist(refresh: RefreshInformation, deviceUUID: string): StoredCredentials {
  const credentials: StoredCredentials = {
    url: refresh.url,
    kind: refresh.kind,
    username: refresh.username,
    token: refresh.token,
    deviceUUID,
    navigatorIdentifier: refresh.navigatorIdentifier,
    lastRefresh: Date.now(),
  };
  saveCredentials(credentials);
  return credentials;
}

// ------------------------------------------------- double authentification

/** Ce que PRONOTE exige avant de terminer la connexion. */
export interface SecurityRequest {
  /** Saisir le code PIN de double authentification deja configure. */
  pin: boolean;
  /** Choisir un nouveau mot de passe (premiere connexion, mot de passe provisoire). */
  password: boolean;
  /** Configurer la double authentification (choisir un PIN). */
  setupDoubleAuth: boolean;
  passwordRules: { min: number; max: number } | null;
}

interface PendingSecurity {
  handle: SessionHandle;
  error: SecurityError;
  deviceUUID: string;
  createdAt: number;
}

let pendingSecurity: PendingSecurity | null = null;

export class SecurityRequiredError extends Error {
  constructor(public readonly request: SecurityRequest) {
    super("PRONOTE demande une verification de securite");
    this.name = "SecurityRequiredError";
  }
}

function describe(modal: SecurityModal): SecurityRequest {
  return {
    pin: modal.shouldEnterPIN,
    password: modal.shouldCustomPassword,
    setupDoubleAuth: modal.shouldCustomDoubleAuth,
    passwordRules: modal.passwordRules
      ? { min: modal.passwordRules.minLength, max: modal.passwordRules.maxLength }
      : null,
  };
}

/**
 * Tente de resoudre la verification sans intervention : quand PRONOTE ne
 * demande qu'un nom d'appareil, on enregistre « Mnemosyne » et on termine.
 * Sinon, on garde la session en attente et on remonte ce qu'il faut saisir.
 */
async function resolveSecurity(
  handle: SessionHandle,
  error: SecurityError,
  deviceUUID: string,
): Promise<RefreshInformation> {
  const modal = error.handle;
  const onlySource =
    modal.shouldEnterSource && !modal.shouldEnterPIN && !modal.shouldCustomPassword && !modal.shouldCustomDoubleAuth;

  if (onlySource) {
    await securitySource(handle, DEVICE_NAME);
    await securitySave(handle, modal, { mode: DoubleAuthMode.MGDA_NotificationSeulement, deviceName: DEVICE_NAME });
    const ctx = modal.context;
    return finishLoginManually(handle, ctx.authentication, ctx.identity, ctx.initialUsername);
  }

  pendingSecurity = { handle, error, deviceUUID, createdAt: Date.now() };
  throw new SecurityRequiredError(describe(modal));
}

export function pendingSecurityRequest(): SecurityRequest | null {
  if (!pendingSecurity) return null;
  // Le serveur oublie la session au bout de quelques minutes.
  if (Date.now() - pendingSecurity.createdAt > 10 * 60 * 1000) {
    pendingSecurity = null;
    return null;
  }
  return describe(pendingSecurity.error.handle);
}

/** Termine une connexion bloquee par la double authentification. */
export async function completeSecurity(input: { pin?: string; newPassword?: string }): Promise<SessionHandle> {
  const pending = pendingSecurity;
  if (!pending) throw new Error("Aucune verification en attente : recommence la connexion.");
  const { handle, error, deviceUUID } = pending;
  const modal = error.handle;

  if (modal.shouldEnterPIN || modal.shouldCustomDoubleAuth) {
    if (!input.pin || !/^\d{4}$/.test(input.pin)) throw new Error("Le code PIN doit contenir 4 chiffres.");
  }

  if (modal.shouldEnterPIN) {
    const ok = await securityCheckPIN(handle, input.pin!);
    if (!ok) throw new Error("Code PIN refuse par PRONOTE.");
  }

  if (modal.shouldCustomPassword) {
    if (!input.newPassword) throw new Error("PRONOTE demande un nouveau mot de passe.");
    const ok = await securityCheckCustomPassword(handle, input.newPassword);
    if (!ok) throw new Error("Ce mot de passe ne respecte pas les regles de l'etablissement.");
  }

  if (modal.shouldEnterSource || modal.shouldCustomDoubleAuth) {
    await securitySource(handle, DEVICE_NAME);
  }

  await securitySave(handle, modal, {
    pin: input.pin,
    mode: modal.shouldCustomDoubleAuth ? DoubleAuthMode.MGDA_SaisieCodePIN : undefined,
    deviceName: DEVICE_NAME,
    password: input.newPassword,
  });

  const ctx = modal.context;
  const refresh = await finishLoginManually(handle, ctx.authentication, ctx.identity, ctx.initialUsername);
  persist(refresh, deviceUUID);
  pendingSecurity = null;
  session = handle;
  return handle;
}

// --------------------------------------------------------------- connexions

function guardSuspension(): void {
  const left = suspensionRemaining();
  if (left > 0) {
    throw new Error(
      `PRONOTE a temporairement bloque cette adresse IP. Nouvelle tentative possible dans ${Math.ceil(left / 60000)} min.`,
    );
  }
}

async function run(
  deviceUUID: string,
  login: (handle: SessionHandle) => Promise<RefreshInformation>,
): Promise<SessionHandle> {
  guardSuspension();
  const handle = newHandle();
  let refresh: RefreshInformation;
  try {
    refresh = await login(handle);
  } catch (err) {
    if (err instanceof SecurityError) {
      refresh = await resolveSecurity(handle, err, deviceUUID);
    } else {
      if (err instanceof SuspendedIPError) suspendedUntil = Date.now() + SUSPENSION_COOLDOWN_MS;
      throw err;
    }
  }
  persist(refresh, deviceUUID);
  pendingSecurity = null;
  session = handle;
  return handle;
}

/** Premiere connexion par identifiant et mot de passe PRONOTE. */
export function firstLogin(params: {
  url: string;
  kind: AccountKind;
  username: string;
  password: string;
  deviceUUID: string;
}): Promise<SessionHandle> {
  return run(params.deviceUUID, (handle) =>
    loginCredentials(handle, {
      url: params.url,
      kind: params.kind,
      username: params.username,
      password: params.password,
      deviceUUID: params.deviceUUID,
    }),
  );
}

/**
 * Connexion par QR code PRONOTE — la voie qui marche avec tous les ENT :
 * le QR est genere apres authentification sur le portail, le bot n'a donc
 * jamais a manipuler les identifiants ENT.
 */
export function qrLogin(params: { qr: unknown; pin: string; deviceUUID: string }): Promise<SessionHandle> {
  return run(params.deviceUUID, (handle) =>
    loginQrCode(handle, { deviceUUID: params.deviceUUID, pin: params.pin, qr: params.qr as never }),
  );
}

/**
 * Connexion par jeton deja emis (import depuis une autre application
 * PRONOTE, ou reconnexion). Le jeton tourne a chaque authentification.
 */
export function tokenLogin(params: {
  url: string;
  kind: AccountKind;
  username: string;
  token: string;
  deviceUUID: string;
}): Promise<SessionHandle> {
  return run(params.deviceUUID, (handle) => loginToken(handle, params));
}

/**
 * Reconnexion silencieuse via le jeton stocke. PRONOTE fait tourner le jeton
 * a chaque authentification : on resauvegarde imperativement le nouveau.
 */
async function loginFromStore(): Promise<SessionHandle> {
  const creds = getCredentials();
  if (!creds) throw new Error("NOT_LINKED");
  guardSuspension();

  const handle = newHandle();
  let refresh: RefreshInformation;
  try {
    refresh = await loginToken(handle, {
      url: creds.url,
      kind: creds.kind,
      username: creds.username,
      token: creds.token,
      deviceUUID: creds.deviceUUID,
      navigatorIdentifier: creds.navigatorIdentifier,
    });
  } catch (err) {
    if (err instanceof SuspendedIPError) suspendedUntil = Date.now() + SUSPENSION_COOLDOWN_MS;
    if (err instanceof SecurityError) {
      // Rare en reconnexion : la double authentification a ete reactivee
      // cote etablissement. On tente le cas simple, sinon on previent.
      refresh = await resolveSecurity(handle, err, creds.deviceUUID);
    } else {
      throw err;
    }
  }

  saveCredentials({
    ...creds,
    url: refresh.url,
    token: refresh.token,
    username: refresh.username,
    navigatorIdentifier: refresh.navigatorIdentifier,
    lastRefresh: Date.now(),
  });
  return handle;
}

/** Renvoie une session vivante, en se reconnectant si necessaire. */
export async function getSession(forceNew = false): Promise<SessionHandle> {
  if (session && !forceNew) return session;
  // Plusieurs appels concurrents partagent la meme connexion.
  if (loggingIn) return loggingIn;

  loggingIn = loginFromStore()
    .then((handle) => {
      session = handle;
      return handle;
    })
    .finally(() => {
      loggingIn = null;
    });

  return loggingIn;
}

export function dropSession(): void {
  session = null;
}

/** Oublie tout : session, verification en attente, identifiants. */
export function unlink(): void {
  session = null;
  pendingSecurity = null;
  saveCredentials(null);
}

/**
 * Execute un appel PRONOTE en gerant la reconnexion automatique.
 * Une session expiree est retentee une fois avec une connexion neuve ;
 * si le jeton lui-meme est refuse, on previent le proprietaire.
 */
export async function withSession<T>(fn: (s: SessionHandle) => Promise<T>): Promise<T> {
  let handle: SessionHandle;
  try {
    handle = await getSession();
  } catch (err) {
    await reportLoginFailure(err);
    throw err;
  }

  try {
    return await fn(handle);
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) {
      if (err instanceof RateLimitedError) console.warn("[pronote] limite de requetes atteinte, cycle ignore");
      throw err;
    }
    dropSession();
    try {
      handle = await getSession(true);
    } catch (retryErr) {
      await reportLoginFailure(retryErr);
      throw retryErr;
    }
    return fn(handle);
  }
}

async function reportLoginFailure(err: unknown): Promise<void> {
  dropSession();
  if (err instanceof BadCredentialsError) {
    await emitSessionLost("Le jeton de connexion n'est plus accepte par PRONOTE (mot de passe change ou appareil retire).");
  } else if (err instanceof SecurityRequiredError) {
    await emitSessionLost("PRONOTE demande une verification de securite (code PIN). Reconnecte-toi depuis le panneau web.");
  } else if (err instanceof SuspendedIPError) {
    await emitSessionLost("PRONOTE a temporairement suspendu l'adresse IP du bot. Reprise automatique dans 30 minutes.");
  }
}

/** Message d'erreur lisible pour l'interface. */
export function explainLoginError(err: unknown): string {
  if (err instanceof SecurityRequiredError) return err.message;
  if (!(err instanceof Error)) return "Erreur inconnue.";
  switch (err.name) {
    case "BadCredentialsError":
      return "Identifiant ou mot de passe incorrect. Si ton etablissement passe par un ENT, utilise plutot le QR code.";
    case "PageUnavailableError":
      return "PRONOTE ne repond pas a cette adresse, ou l'espace mobile est desactive. Verifie l'URL ou utilise le QR code.";
    case "SuspendedIPError":
      return "PRONOTE a temporairement bloque l'adresse IP du bot apres trop de tentatives. Patiente 30 minutes.";
    case "AccountDisabledError":
      return "Ce compte PRONOTE est desactive.";
    case "AccessDeniedError":
      return "Acces refuse a cet espace PRONOTE.";
    case "BusyPageError":
      return "PRONOTE est momentanement indisponible (maintenance ?). Reessaie un peu plus tard.";
    case "AuthenticateError":
      return `PRONOTE a refuse la connexion : ${err.message}`;
    default:
      return err.message || "Erreur inconnue.";
  }
}
