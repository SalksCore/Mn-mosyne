import { getConfig, getSnapshot } from "../store/db.js";
import { sameDay } from "../render/util.js";
import type { FlatLesson } from "../types.js";
import { currentIndex, directJourneys, stopById, type Endpoint } from "./engine.js";
import type { Journey, Network, Stop } from "./types.js";
import type { FeedIndex } from "./gtfs/feed.js";

/**
 * Planification des trajets domicile <-> etablissement.
 *
 * L'ancienne version demandait « les 12 prochains passages » au moment du
 * calcul (4 h du matin) puis gardait le dernier qui arrivait a l'heure :
 * avec des bus toutes les dix minutes, cela tombait vers 5 h 50 pour un
 * cours a 8 h. Desormais, on part de l'heure limite (debut du premier cours
 * moins la marge) et on remonte le temps : le bon bus est le DERNIER qui
 * arrive encore a l'heure, ce qui laisse dormir le plus longtemps possible.
 */

export interface PlanOption {
  journey: Journey;
  /** Heure a laquelle quitter le point de depart (domicile ou etablissement). */
  leaveAt: Date;
  /** Arrivee a destination finale, marche comprise. */
  arriveAt: Date;
  /** Marge par rapport a l'heure limite, en minutes. Negatif = en retard. */
  marginMinutes: number | null;
  viable: boolean;
  issue?: string;
}

interface PlanBase {
  date: Date;
  network: Network;
  fromStop: Stop;
  toStop: Stop;
  options: PlanOption[];
  best: PlanOption | null;
}

export interface MorningPlan extends PlanBase {
  kind: "morning";
  firstLesson: FlatLesson | null;
  /** Heure limite d'arrivee : debut du premier cours moins la marge. */
  deadline: Date | null;
  /** Heure d'envoi du preavis. */
  notifyAt: Date | null;
}

export interface EveningPlan extends PlanBase {
  kind: "evening";
  lastLesson: FlatLesson | null;
  releaseAt: Date | null;
}

export type Plan = MorningPlan | EveningPlan;

/** Cours maintenus du jour, dans l'ordre. */
export function lessonsOn(date: Date): FlatLesson[] {
  const snap = getSnapshot();
  if (!snap) return [];
  return snap.lessons
    .filter((l) => sameDay(l.start, date) && !l.canceled && !l.exempted)
    .sort((a, b) => a.start - b.start);
}

async function context(): Promise<{ network: Network; index: FeedIndex; home: Stop; school: Stop } | null> {
  const t = getConfig().transport;
  if (!t.homeStopId || !t.schoolStopId) return null;
  const ctx = await currentIndex();
  if (!ctx) return null;
  const home = stopById(ctx.index, t.homeStopId);
  const school = stopById(ctx.index, t.schoolStopId);
  if (!home || !school) return null;
  return { ...ctx, home, school };
}

function option(j: Journey, deadline: Date | null, now: number, live: boolean): PlanOption {
  const leaveAt = new Date(j.departure.getTime() - j.walkTo * 60000);
  const arriveAt = new Date(j.arrival.getTime() + j.walkFrom * 60000);
  const marginMinutes = deadline ? Math.floor((deadline.getTime() - arriveAt.getTime()) / 60000) : null;
  let issue: string | undefined;
  if (j.cancelled) issue = "Course supprimée";
  else if (live && leaveAt.getTime() < now - 60000) issue = "Trop tard pour l'attraper";
  else if (marginMinutes !== null && marginMinutes < 0) issue = `Arrivée ${-marginMinutes} min trop tard`;
  return { journey: j, leaveAt, arriveAt, marginMinutes, viable: !issue, issue };
}

/** Le plan concerne-t-il la journee en cours (on ne peut plus remonter le temps) ? */
const isToday = (d: Date): boolean => sameDay(Date.now(), d);

/** Trajet du matin, domicile -> etablissement, pour le jour donne. */
export async function planMorning(date: Date): Promise<MorningPlan | null> {
  const ctx = await context();
  if (!ctx) return null;
  const t = getConfig().transport;

  const firstLesson = lessonsOn(date)[0] ?? null;
  const base = { kind: "morning" as const, date, network: ctx.network, fromStop: ctx.home, toStop: ctx.school, firstLesson };
  if (!firstLesson) return { ...base, deadline: null, notifyAt: null, options: [], best: null };

  const deadline = new Date(firstLesson.start - t.arriveMinBefore * 60000);
  const from: Endpoint = { stop: ctx.home, walk: t.walkToHomeStop };
  const to: Endpoint = { stop: ctx.school, walk: t.walkFromSchoolStop };

  // Fenetre de recherche : on monte au plus tard a l'heure limite, au plus
  // tot trois heures avant (trajets interurbains longs compris).
  const journeys = await directJourneys(
    ctx.network,
    ctx.index,
    from,
    to,
    new Date(deadline.getTime() - 3 * 3600 * 1000),
    deadline,
    t.lines,
  );

  const live = isToday(date);
  const now = Date.now();
  const all = journeys.map((j) => option(j, deadline, now, live));
  const viable = all.filter((o) => o.viable);
  const best = viable.length ? viable[viable.length - 1] : null;

  // On montre le bus retenu, ceux qui le precedent (replis plus surs) et le
  // suivant (trop tard), pour que la decision soit lisible.
  const index = best ? all.indexOf(best) : all.findIndex((o) => !o.viable && !o.journey.cancelled);
  const options = index >= 0 ? all.slice(Math.max(0, index - 3), index + 2) : all.slice(-5);
  const notifyAt = best ? new Date(best.leaveAt.getTime() - t.notifyLeadMinutes * 60000) : null;

  return { ...base, deadline, notifyAt, options, best };
}

/** Trajet du soir, etablissement -> domicile, apres le dernier cours. */
export async function planEvening(date: Date): Promise<EveningPlan | null> {
  const ctx = await context();
  if (!ctx) return null;
  const t = getConfig().transport;

  const lessons = lessonsOn(date);
  const lastLesson = lessons.length ? lessons[lessons.length - 1] : null;
  const base = { kind: "evening" as const, date, network: ctx.network, fromStop: ctx.school, toStop: ctx.home, lastLesson };
  if (!lastLesson) return { ...base, releaseAt: null, options: [], best: null };

  const releaseAt = new Date(lastLesson.end);
  const live = isToday(date);
  const now = Date.now();
  // Si la sortie est deja passee, on part de maintenant.
  const earliest = new Date(Math.max(releaseAt.getTime(), live ? now : 0) + t.walkToSchoolStop * 60000);

  const journeys = await directJourneys(
    ctx.network,
    ctx.index,
    { stop: ctx.school, walk: t.walkToSchoolStop },
    { stop: ctx.home, walk: t.walkFromHomeStop },
    earliest,
    new Date(earliest.getTime() + 3 * 3600 * 1000),
    t.lines,
  );

  const options = journeys.map((j) => option(j, null, now, live)).slice(0, 6);
  const best = options.find((o) => o.viable) ?? null;
  return { ...base, releaseAt, options, best };
}

/** Trajet a la demande depuis maintenant, dans un sens ou l'autre. */
export async function planNow(direction: "aller" | "retour"): Promise<Plan | null> {
  const ctx = await context();
  if (!ctx) return null;
  const t = getConfig().transport;
  const now = new Date();
  const aller = direction === "aller";
  const from: Endpoint = aller ? { stop: ctx.home, walk: t.walkToHomeStop } : { stop: ctx.school, walk: t.walkToSchoolStop };
  const to: Endpoint = aller ? { stop: ctx.school, walk: t.walkFromSchoolStop } : { stop: ctx.home, walk: t.walkFromHomeStop };

  const firstLesson = aller ? (lessonsOn(now).find((l) => l.start > now.getTime()) ?? null) : null;
  const deadline = firstLesson ? new Date(firstLesson.start - t.arriveMinBefore * 60000) : null;
  const journeys = await directJourneys(
    ctx.network,
    ctx.index,
    from,
    to,
    new Date(now.getTime() + from.walk * 60000),
    new Date(now.getTime() + 2 * 3600 * 1000),
    t.lines,
  );
  const options = journeys.map((j) => option(j, deadline, now.getTime(), true)).slice(0, 6);
  const best = options.find((o) => o.viable) ?? null;

  if (aller) {
    return { kind: "morning", date: now, network: ctx.network, fromStop: from.stop, toStop: to.stop, firstLesson, deadline, notifyAt: null, options, best };
  }
  return { kind: "evening", date: now, network: ctx.network, fromStop: from.stop, toStop: to.stop, lastLesson: null, releaseAt: null, options, best };
}
