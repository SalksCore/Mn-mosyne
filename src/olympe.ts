import { getSeen } from "./store/db.js";
import { isLinked } from "./pronote/client.js";

/**
 * Statistiques envoyées à Olympe, l'API centrale des projets Salks.
 *
 * Désactivé par défaut : seule une instance qui a OLYMPE_URL et OLYMPE_BOT_TOKEN
 * dans son .env envoie quelque chose (l'instance officielle). Uniquement des
 * compteurs : PRONOTE connecté ou non, notifications des dernières 24 h, heures
 * en ligne. Jamais de note, de devoir, de nom ni d'identifiant.
 */
const EVERY_MS = 15 * 60_000;
const startedAt = Date.now();

const OLYMPE_URL = (process.env.OLYMPE_URL ?? "").replace(/\/$/, "");
const BOT_ID = process.env.OLYMPE_BOT_ID ?? "mnemosyne-bot";
const TOKEN = process.env.OLYMPE_BOT_TOKEN ?? "";

async function push(): Promise<void> {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const metrics = {
    users: isLinked() ? 1 : 0,
    notifications: Object.values(getSeen()).filter((at) => at > dayAgo).length,
    uptime: Math.round((Date.now() - startedAt) / 3_600_000),
  };
  const res = await fetch(`${OLYMPE_URL}/api/public/bots/${BOT_ID}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ metrics, version: process.env.npm_package_version ?? "" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) console.warn("[olympe] jeton refusé : vérifie OLYMPE_BOT_TOKEN.");
}

export function startOlympeStats(): void {
  if (!OLYMPE_URL || !TOKEN) return;
  const run = () => push().catch((err) => console.warn("[olympe] envoi impossible :", (err as Error).message));
  run();
  setInterval(run, EVERY_MS).unref();
}
