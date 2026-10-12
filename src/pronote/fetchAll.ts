import {
  timetableFromWeek,
  parseTimetable,
  assignmentsFromIntervals,
  assignmentsFromWeek,
  gradesOverview,
  discussions,
  news,
  notebook,
  translateToWeekNumber,
  GradeKind,
  type SessionHandle,
  type Period,
  type GradeValue,
} from "pawnote";
import { withSession } from "./client.js";
import type {
  FlatAbsence,
  FlatAssignment,
  FlatAverage,
  FlatDiscussion,
  FlatGrade,
  FlatLesson,
  FlatNews,
  Snapshot,
} from "../types.js";

/** Convertit une GradeValue en nombre, ou null si non note/absent. */
export function gradeNumber(g?: GradeValue): number | null {
  if (!g) return null;
  if (g.kind !== GradeKind.Grade) return null;
  return g.points;
}

export function weekNumberFor(session: SessionHandle, date: Date): number {
  return translateToWeekNumber(date, session.instance.firstMonday);
}

/** Periode active a la date donnee, sinon la derniere periode connue. */
export function periodFor(session: SessionHandle, date = new Date()): Period | null {
  const periods = session.instance.periods;
  if (!periods.length) return null;
  const now = date.getTime();
  const active = periods.find((p) => p.startDate.getTime() <= now && now <= p.endDate.getTime());
  return active ?? periods[periods.length - 1] ?? null;
}

/**
 * Recupere l'emploi du temps sur une plage de semaines et renvoie
 * les cours a plat. `parseTimetable` est indispensable : sans lui les
 * cours annules et les superpositions ne sont pas resolus correctement.
 */
export async function fetchLessons(
  session: SessionHandle,
  weeks: number[],
): Promise<FlatLesson[]> {
  const out: FlatLesson[] = [];

  for (const week of weeks) {
    if (week < 1 || week > 62) continue;
    let raw;
    try {
      raw = await timetableFromWeek(session, week);
    } catch (err) {
      // Une session expiree doit remonter telle quelle pour etre renouvelee.
      if (err instanceof Error && err.name === "SessionExpiredError") throw err;
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new Error(`Emploi du temps PRONOTE indisponible pour la semaine ${week} (${reason})`);
    }
    // parseTimetable mute l'objet en place et ne renvoie rien : on lit
    // ensuite `raw.classes`, desormais resolu (annulations, superpositions).
    parseTimetable(session, raw, {
      withSuperposedCanceledClasses: false,
      withCanceledClasses: true,
      withPlannedClasses: true,
    });

    for (const item of raw.classes) {
      if (item.is !== "lesson") continue;
      out.push({
        id: item.id,
        subject: item.subject?.name ?? "Cours",
        teachers: item.teacherNames ?? [],
        rooms: item.classrooms ?? [],
        groups: item.groupNames ?? [],
        start: item.startDate.getTime(),
        end: item.endDate.getTime(),
        canceled: item.canceled,
        exempted: item.exempted,
        test: item.test,
        status: item.status,
        backgroundColor: item.backgroundColor,
      });
    }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

export async function buildSnapshot(previous: Snapshot | null = null): Promise<Snapshot> {
  return withSession(async (session) => {
    const now = new Date();
    const thisWeek = weekNumberFor(session, now);

    // On couvre la semaine courante + les deux suivantes : suffisant pour
    // detecter les changements futurs sans exploser le nombre de requetes.
    const weeks = [thisWeek, thisWeek + 1, thisWeek + 2];
    console.log(`[pronote] snapshot debut semaines=${weeks.join(",")}`);

    const ok: Snapshot["ok"] = { lessons: false, assignments: false, grades: false, discussions: false, news: false, absences: false };

    // Plage exacte couverte : du lundi de la semaine courante au dimanche
    // soir de la derniere semaine demandee.
    const firstMonday = session.instance.firstMonday;
    const weekStart = (w: number) => new Date(firstMonday.getFullYear(), firstMonday.getMonth(), firstMonday.getDate() + (w - 1) * 7).getTime();
    const range = { from: weekStart(weeks[0]), to: weekStart(weeks[weeks.length - 1] + 1) };

    let lessons: FlatLesson[] = previous?.lessons ?? [];
    try {
      lessons = await fetchLessons(session, weeks);
      ok.lessons = true;
    } catch (err) {
      if (err instanceof Error && err.name === "SessionExpiredError") throw err;
      console.warn("[pronote] emploi du temps indisponible, anciennes donnees conservees:", err instanceof Error ? err.message : err);
    }
    console.log(`[pronote] emploi du temps recupere cours=${lessons.length}`);

    let assignments: FlatAssignment[] = previous?.assignments ?? [];
    try {
      const rangeStart = new Date(now);
      rangeStart.setHours(0, 0, 0, 0);
      const rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeEnd.getDate() + 21);
      let assignmentsRaw = await assignmentsFromIntervals(session, rangeStart, rangeEnd);
      if (!assignmentsRaw.length) {
        console.log("[pronote] plage de devoirs vide, repli sur les semaines");
        assignmentsRaw = await assignmentsFromWeek(session, thisWeek, thisWeek + 2);
      }
      assignments = assignmentsRaw.map((a) => ({
        id: a.id,
        subject: a.subject?.name ?? "Matiere",
        description: (a.description ?? "").trim(),
        done: a.done,
        deadline: a.deadline.getTime(),
        difficulty: a.difficulty,
        backgroundColor: a.backgroundColor,
      }));
      ok.assignments = true;
    } catch (err) {
      console.warn("[pronote] devoirs indisponibles, anciennes donnees conservees:", err instanceof Error ? err.message : err);
    }
    console.log(`[pronote] devoirs recuperees=${assignments.length}`);

    const period = periodFor(session, now);
    let grades: FlatGrade[] = [];
    let averages: FlatAverage[] = [];
    let overallAverage: number | null = null;

    if (period) {
      try {
        const overview = await gradesOverview(session, period);
        grades = overview.grades.map((g) => ({
          id: g.id,
          subject: g.subject?.name ?? "Matiere",
          value: gradeNumber(g.value),
          outOf: gradeNumber(g.outOf),
          coefficient: g.coefficient,
          date: g.date.getTime(),
          comment: (g.comment ?? "").trim(),
          average: gradeNumber(g.average),
          periodName: period.name,
        }));
        averages = overview.subjectsAverages.map((s) => ({
          subject: s.subject?.name ?? "Matiere",
          student: gradeNumber(s.student),
          classAverage: gradeNumber(s.class_average),
          outOf: gradeNumber(s.outOf),
        }));
        overallAverage = gradeNumber(overview.overallAverage);
        ok.grades = true;
      } catch (err) {
        grades = previous?.grades ?? [];
        averages = previous?.averages ?? [];
        overallAverage = previous?.overallAverage ?? null;
        console.warn("[pronote] notes indisponibles, anciennes donnees conservees:", err instanceof Error ? err.message : err);
      }
    }
    console.log(`[pronote] notes recuperees=${grades.length} moyennes=${averages.length}`);

    // Les discussions sont facultatives selon l'etablissement : on ne fait
    // pas echouer tout le snapshot si l'onglet est desactive.
    let flatDiscussions: FlatDiscussion[] = [];
    try {
      const disc = await discussions(session);
      flatDiscussions = disc.items.map((d) => ({
        id: d.participantsMessageID,
        subject: d.subject ?? "(sans objet)",
        sender: d.creator ?? d.recipientName ?? "Inconnu",
        lastMessage: d.date.getTime(),
        unread: d.numberOfMessagesUnread,
      }));
      ok.discussions = true;
      console.log(`[pronote] discussions recuperees=${flatDiscussions.length}`);
    } catch (err) {
      flatDiscussions = previous?.discussions ?? [];
      console.warn("[pronote] discussions indisponibles, anciennes donnees conservees:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    }

    let flatNews: FlatNews[] = [];
    try {
      const feed = await news(session);
      flatNews = feed.items.map((n) => ({
        id: n.id,
        title: n.title ?? "(sans titre)",
        author: n.author,
        date: n.creationDate.getTime(),
        read: n.read,
        content: "content" in n ? String(n.content ?? "").trim() : undefined,
      }));
      ok.news = true;
      console.log(`[pronote] informations recuperees=${flatNews.length}`);
    } catch (err) {
      flatNews = previous?.news ?? [];
      console.warn("[pronote] informations indisponibles, anciennes donnees conservees:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    }

    let absences: FlatAbsence[] = previous?.absences ?? [];
    if (period) {
      try {
        const nb = await notebook(session, period);
        absences = nb.absences.map((a) => ({
          id: a.id,
          from: a.startDate.getTime(),
          to: a.endDate.getTime(),
          justified: a.justified,
          reason: a.reason ?? "Motif non precise",
          hours: `${a.hoursMissed}h${String(a.minutesMissed).padStart(2, "0")}`,
        }));
        ok.absences = true;
      } catch {
        /* onglet vie scolaire desactive dans l'etablissement */
      }
    }

    return {
      fetchedAt: Date.now(),
      range,
      ok,
      studentName: session.userResource.name,
      className: session.userResource.className ?? "",
      lessons,
      assignments,
      grades,
      averages,
      overallAverage,
      discussions: flatDiscussions,
      news: flatNews,
      absences,
      periods: session.instance.periods.map((p) => ({
        id: p.id,
        name: p.name,
        start: p.startDate.getTime(),
        end: p.endDate.getTime(),
      })),
      currentPeriodName: period?.name ?? null,
    };
  });
}
