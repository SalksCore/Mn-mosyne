import cron, { type ScheduledTask } from "node-cron";
import type { Client } from "discord.js";
import { getConfig, getSnapshot, saveSnapshot } from "../store/db.js";
import { buildSnapshot } from "../pronote/fetchAll.js";
import { diffSnapshots } from "../pronote/diff.js";
import { isLinked } from "../pronote/client.js";
import { buildBrief, flushPending, notifyChanges, sendToOwner } from "../notify/notifier.js";
import { replanIfNeeded } from "../transport/scheduler.js";

let pollTimer: NodeJS.Timeout | null = null;
let morningTask: ScheduledTask | null = null;
let eveningTask: ScheduledTask | null = null;
let running = false;
let lastError: string | null = null;
let lastSuccess: number | null = null;

/** Etat de la synchronisation, affiche par le panneau web et /statut. */
export function pollStatus(): { running: boolean; lastError: string | null; lastSuccess: number | null; intervalMinutes: number } {
  return { running, lastError, lastSuccess, intervalMinutes: getConfig().pollIntervalMinutes };
}

/**
 * Un cycle de polling : snapshot complet, diff avec le precedent,
 * notification, persistance. Les erreurs sont avalees pour ne jamais
 * casser la boucle.
 */
export async function pollOnce(client: Client, silent = false): Promise<string | null> {
  if (running) return "Une synchronisation est deja en cours.";
  if (!isLinked()) return "Aucun compte PRONOTE n'est lie.";
  running = true;

  try {
    const previous = getSnapshot();
    const next = await buildSnapshot(previous);
    console.log(`[poll] snapshot construit cours=${next.lessons.length} devoirs=${next.assignments.length} notes=${next.grades.length}`);

    if (!silent) {
      const changes = diffSnapshots(previous, next);
      if (changes.length) {
        console.log(`[poll] ${changes.length} changement(s) detecte(s)`);
        await notifyChanges(client, changes);
      }
    }

    saveSnapshot(next);
    console.log(`[poll] snapshot enregistre a ${new Date(next.fetchedAt).toISOString()}`);
    lastError = null;
    lastSuccess = next.fetchedAt;
    await flushPending(client);
    await replanIfNeeded(client);
    return null;
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[poll] cycle en echec:", message);
    lastError = message;
    return message;
  } finally {
    running = false;
  }
}

export function startPolling(client: Client): void {
  stopPolling();
  const minutes = Math.max(1, getConfig().pollIntervalMinutes);
  pollTimer = setInterval(() => void pollOnce(client), minutes * 60 * 1000);
  console.log(`[poll] intervalle de ${minutes} min (${(60 / minutes).toFixed(1)} appels/heure)`);
}

export function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/** Envoie le brief pour une date donnee, en rafraichissant d'abord. */
export async function sendBrief(
  client: Client,
  target: Date,
  when: "morning" | "evening" | "manual",
): Promise<void> {
  await pollOnce(client, true);
  const snapshot = getSnapshot();
  if (!snapshot) {
    await sendToOwner(client, {
      content: undefined,
      ...(await import("../ui/components.js")).errorCard(
        "Aucune donnee",
        "Le bot n'a pas encore recupere de donnees PRONOTE. Reessaie dans quelques instants.",
      ),
    });
    return;
  }
  await sendToOwner(client, buildBrief(snapshot, target, when));
}

function cronFor(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${m} ${h} * * *`;
}

/** (Re)programme les briefs du matin et du soir depuis la config. */
export function scheduleBriefs(client: Client): void {
  const cfg = getConfig();

  morningTask?.destroy();
  eveningTask?.destroy();
  morningTask = null;
  eveningTask = null;

  if (cfg.morningBriefEnabled) {
    morningTask = cron.schedule(
      cronFor(cfg.morningBriefTime),
      () => {
        void sendBrief(client, new Date(), "morning");
      },
      { timezone: cfg.timezone },
    );
    console.log(`[cron] brief du matin a ${cfg.morningBriefTime} (${cfg.timezone})`);
  }

  if (cfg.eveningBriefEnabled) {
    eveningTask = cron.schedule(
      cronFor(cfg.eveningBriefTime),
      () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        void sendBrief(client, tomorrow, "evening");
      },
      { timezone: cfg.timezone },
    );
    console.log(`[cron] brief du soir a ${cfg.eveningBriefTime} (${cfg.timezone})`);
  }
}

/** A appeler apres toute modification de config touchant les horaires. */
export function rescheduleAll(client: Client): void {
  scheduleBriefs(client);
  startPolling(client);
}
