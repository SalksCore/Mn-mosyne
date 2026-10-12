import cron, { type ScheduledTask } from "node-cron";
import type { Client } from "discord.js";
import { getConfig, getSeen, markSeen } from "../store/db.js";
import { sendToOwner } from "../notify/notifier.js";
import { alternatives, commonLines, currentIndex, disruptions, stopById } from "./engine.js";
import { planEvening, planMorning, type MorningPlan, type PlanOption } from "./plan.js";
import { buildAlternativesCard, buildDisruptionsCard, buildEveningCard, buildIncidentCard, buildMorningCard } from "./notify.js";

/**
 * Alertes de transport.
 *
 *  - Preavis : N minutes avant l'heure de depart calculee.
 *  - Depart  : « c'est l'heure », avec le bus retenu.
 *  - Veille  : la course choisie est surveillee jusqu'au depart ; seule
 *    elle declenche une alerte (l'ancienne version alertait sur les quatre
 *    prochains passages, y compris des bus qui ne concernaient personne).
 *  - Retour  : a la fin des cours, prochains departs vers le domicile.
 *  - Perturbations : messages du reseau sur les lignes reellement utilisees.
 */

let daily: ScheduledTask | null = null;
let disruptionTimer: NodeJS.Timeout | null = null;
const timers: NodeJS.Timeout[] = [];
let lastSignature = "";

const hm = (d: Date): string => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function clearTimers(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
}

function at(when: Date, fn: () => void | Promise<void>): void {
  const delay = when.getTime() - Date.now();
  if (delay < -60000 || delay > 22 * 3600 * 1000) return;
  timers.push(
    setTimeout(() => {
      Promise.resolve(fn()).catch((err) => console.warn("[transport] tache en erreur:", err instanceof Error ? err.message : err));
    }, Math.max(0, delay)),
  );
}

const enabled = (): boolean => {
  const cfg = getConfig();
  return cfg.transport.enabled && cfg.notifications.transport;
};

/** Une alerte n'est envoyee qu'une fois par course et par etat. */
function once(key: string): boolean {
  const k = `transport:${key}`;
  if (k in getSeen()) return false;
  markSeen([k]);
  return true;
}

const tripKey = (o: PlanOption): string => `${o.journey.tripId}|${o.journey.serviceDate}`;

async function sendAlternatives(client: Client, plan: MorningPlan, reason: string): Promise<void> {
  const ctx = await currentIndex();
  if (!ctx || !plan.deadline) return;
  const t = getConfig().transport;
  const alts = await alternatives(
    ctx.network,
    ctx.index,
    { stop: plan.fromStop, walk: t.walkToHomeStop },
    { stop: plan.toStop, walk: t.walkFromSchoolStop },
    new Date(),
    plan.deadline,
  );
  await sendToOwner(client, buildAlternativesCard(alts.slice(0, 5), reason, plan.deadline));
}

/**
 * Surveille la course retenue : suppression, retard, ou course devenue
 * impossible a attraper. Propose un repli des que le plan ne tient plus.
 */
function watchMorning(client: Client, chosen: PlanOption, until: Date): void {
  const key = tripKey(chosen);
  const tick = async (): Promise<void> => {
    if (Date.now() > until.getTime() || !enabled()) return;
    const plan = await planMorning(new Date());
    if (!plan) return;
    const t = getConfig().transport;
    const current = plan.options.find((o) => tripKey(o) === key) ?? null;

    if (!current || current.journey.cancelled) {
      if (once(`${key}|cancel`)) {
        await sendToOwner(client, buildIncidentCard(chosen, plan.best, "cancel"));
        if (!plan.best) await sendAlternatives(client, plan, "Ton bus est supprimé et aucun autre ne passe à temps sur ta ligne.");
      }
      return;
    }

    const delay = current.journey.delayMinutes ?? 0;
    if (Math.abs(delay) >= t.delayAlertMinutes && once(`${key}|delay|${Math.round(delay / 3)}`)) {
      await sendToOwner(client, buildIncidentCard(current, plan.best !== current ? plan.best : null, delay > 0 ? "late" : "early"));
    }
    if (!current.viable && current.issue && once(`${key}|late-arrival`)) {
      await sendAlternatives(client, plan, `Avec ce retard, tu arriverais après le début des cours (${current.issue.toLowerCase()}).`);
    }

    timers.push(setTimeout(() => void tick(), 2 * 60 * 1000));
  };
  void tick();
}

/** Calcule la journee et programme toutes les alertes de transport. */
export async function planDay(client: Client): Promise<void> {
  clearTimers();
  if (!enabled()) return;
  const t = getConfig().transport;
  const today = new Date();

  try {
    const morning = await planMorning(today);
    const best = morning?.best;
    if (morning && best && morning.notifyAt) {
      lastSignature = `${morning.firstLesson?.start}|${tripKey(best)}`;
      at(morning.notifyAt, async () => {
        const fresh = await planMorning(new Date());
        if (fresh && once(`${tripKey(best)}|notice`)) await sendToOwner(client, buildMorningCard(fresh, false));
      });
      at(best.leaveAt, async () => {
        const fresh = await planMorning(new Date());
        if (fresh && once(`${tripKey(best)}|go`)) await sendToOwner(client, buildMorningCard(fresh, true));
      });
      // La veille commence un peu avant le preavis et s'arrete au depart du bus.
      const watchFrom = new Date(morning.notifyAt.getTime() - 10 * 60000);
      const watchUntil = new Date(Math.max(best.journey.departure.getTime(), watchFrom.getTime() + t.morningWatchMinutes * 60000));
      at(watchFrom, () => watchMorning(client, best, watchUntil));
      console.log(`[transport] matin : preavis ${hm(morning.notifyAt)}, depart ${hm(best.leaveAt)} (${best.journey.line.short} de ${hm(best.journey.departure)})`);
    } else if (morning?.firstLesson) {
      console.log("[transport] matin : aucun passage n'arrive a l'heure");
      if (morning.deadline) {
        at(new Date(morning.deadline.getTime() - 90 * 60000), async () => {
          if (once(`none|${morning.deadline!.toISOString()}`)) {
            await sendAlternatives(client, morning, "Aucun passage de ta ligne n'arrive à l'heure ce matin.");
          }
        });
      }
    }
  } catch (err) {
    console.warn("[transport] plan du matin:", err instanceof Error ? err.message : err);
  }

  if (!t.eveningEnabled) return;
  try {
    const evening = await planEvening(today);
    if (evening?.releaseAt) {
      at(new Date(evening.releaseAt.getTime() - 5 * 60000), async () => {
        const fresh = await planEvening(new Date());
        if (fresh && once(`evening|${evening.releaseAt!.toISOString()}`)) await sendToOwner(client, buildEveningCard(fresh));
      });
      console.log(`[transport] soir : sortie ${hm(evening.releaseAt)}`);
    }
  } catch (err) {
    console.warn("[transport] plan du soir:", err instanceof Error ? err.message : err);
  }
}

/**
 * A appeler apres chaque synchronisation PRONOTE : si le premier cours du
 * jour a change (cours annule, deplace), l'heure de depart change aussi.
 */
export async function replanIfNeeded(client: Client): Promise<void> {
  if (!enabled()) return;
  try {
    const morning = await planMorning(new Date());
    const signature = `${morning?.firstLesson?.start}|${morning?.best ? tripKey(morning.best) : ""}`;
    if (signature !== lastSignature) {
      console.log("[transport] emploi du temps modifie, replanification");
      await planDay(client);
    }
  } catch {
    /* on retentera au prochain cycle */
  }
}

export async function checkDisruptions(client: Client, force = false): Promise<number> {
  const cfg = getConfig();
  if (!enabled() || (!cfg.transport.disruptionAlerts && !force)) return 0;
  const ctx = await currentIndex();
  if (!ctx) return 0;
  const home = stopById(ctx.index, cfg.transport.homeStopId);
  const school = stopById(ctx.index, cfg.transport.schoolStopId);
  if (!home || !school) return 0;

  const routes = cfg.transport.lines.length ? cfg.transport.lines : commonLines(ctx.index, home, school).map((l) => l.id);
  let items;
  try {
    items = await disruptions(ctx.network, ctx.index, routes);
  } catch (err) {
    console.warn("[transport] perturbations indisponibles:", err instanceof Error ? err.message : err);
    return 0;
  }
  const seen = getSeen();
  const fresh = force ? items : items.filter((d) => !(`disruption:${ctx.network.id}:${d.id}` in seen));
  if (!fresh.length) return 0;
  await sendToOwner(client, buildDisruptionsCard(fresh, ctx.network));
  markSeen(fresh.map((d) => `disruption:${ctx.network.id}:${d.id}`));
  return fresh.length;
}

export function startTransport(client: Client): void {
  stopTransport();
  const cfg = getConfig();
  if (!cfg.transport.enabled) {
    console.log("[transport] desactive");
    return;
  }
  daily = cron.schedule("5 3 * * *", () => void planDay(client), { timezone: cfg.timezone });
  disruptionTimer = setInterval(() => void checkDisruptions(client), 10 * 60 * 1000);
  void planDay(client);
  console.log(`[transport] actif sur ${cfg.transport.networkName || cfg.transport.networkId}`);
}

export function stopTransport(): void {
  daily?.destroy();
  daily = null;
  if (disruptionTimer) clearInterval(disruptionTimer);
  disruptionTimer = null;
  clearTimers();
  lastSignature = "";
}
