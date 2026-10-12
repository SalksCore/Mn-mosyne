import type { Change, ChangeKind, FlatLesson, Snapshot, SnapshotPart } from "../types.js";

/**
 * Detection des changements entre deux synchronisations.
 *
 * Problemes corriges par rapport a l'ancienne version :
 *  - « Cours retire » en rafale chaque lundi : la semaine passee sortait de
 *    la fenetre telechargee. On ne compare plus que la periode couverte
 *    par les DEUX instantanes, et jamais le passe.
 *  - Faux « cours deplace » : un cours etait rapproche de n'importe quel
 *    cours de la meme matiere dans les 7 jours. Le rapprochement se fait
 *    maintenant par identifiant, puis par creneau exact, et un deplacement
 *    n'est retenu que s'il n'y a qu'un seul candidat possible.
 *  - Trois notifications pour une seule annulation (annule + statut +
 *    deplace) : tous les changements d'un meme cours sont fusionnes.
 *  - Avalanche apres une panne : une categorie qui n'a pas pu etre
 *    recuperee n'est pas comparee.
 *  - Re-notification quand un texte change : la cle de deduplication
 *    decrit l'etat, pas la formulation.
 */

const fmtTime = (ts: number): string => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtDate = (ts: number): string => new Date(ts).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const when = (l: FlatLesson): string => `${fmtDate(l.start)}, ${fmtTime(l.start)}-${fmtTime(l.end)}`;

const list = (values: string[]): string =>
  values
    .map((v) => v.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "fr"))
    .join(", ");

/** Un statut PRONOTE qui ne fait que redire l'annulation n'apporte rien. */
const meaningfulStatus = (s?: string): string => {
  const v = (s ?? "").trim();
  return /annul|absent/i.test(v) ? "" : v;
};

const slotKey = (l: FlatLesson): string => `${new Date(l.start).toISOString().slice(0, 16)}|${l.subject}`;

/** Les instantanes anterieurs a cette version n'avaient ni plage ni etat. */
function rangeOf(s: Snapshot): { from: number; to: number } {
  if (s.range) return s.range;
  if (!s.lessons.length) return { from: 0, to: 0 };
  return { from: Math.min(...s.lessons.map((l) => l.start)), to: Math.max(...s.lessons.map((l) => l.end)) };
}

function okOf(s: Snapshot, part: SnapshotPart): boolean {
  return s.ok ? s.ok[part] : true;
}

function lessonChange(kind: ChangeKind, l: FlatLesson, title: string, details: string[], state: string): Change {
  return {
    kind,
    key: `lesson:${slotKey(l)}:${state}`,
    targetDate: l.start,
    subject: l.subject,
    title,
    detail: details.join(" · "),
  };
}

function diffLessons(prev: Snapshot, next: Snapshot): Change[] {
  const a = rangeOf(prev);
  const b = rangeOf(next);
  const from = Math.max(a.from, b.from, Date.now());
  const to = Math.min(a.to, b.to);
  if (to <= from) return [];

  const inWindow = (l: FlatLesson) => l.end > from && l.start < to;
  const before = prev.lessons.filter(inWindow);
  const after = next.lessons.filter(inWindow);

  const byId = new Map(before.map((l) => [l.id, l]));
  const bySlot = new Map(before.map((l) => [slotKey(l), l]));
  const matched = new Set<FlatLesson>();
  const added: FlatLesson[] = [];
  const pairs: Array<[FlatLesson, FlatLesson]> = [];

  for (const cur of after) {
    const old = [byId.get(cur.id), bySlot.get(slotKey(cur))].find((x) => x && !matched.has(x));
    if (old) {
      matched.add(old);
      pairs.push([old, cur]);
    } else {
      added.push(cur);
    }
  }
  const removed = before.filter((l) => !matched.has(l));

  // Deplacement avec nouvel identifiant : un seul cours disparu et un seul
  // apparu, meme matiere, meme professeur, a moins d'une semaine d'ecart.
  for (const cur of [...added]) {
    const candidates = removed.filter(
      (o) => o.subject === cur.subject && list(o.teachers) === list(cur.teachers) && Math.abs(o.start - cur.start) < 7 * 24 * 3600 * 1000,
    );
    const reverse = added.filter((x) => x.subject === cur.subject && list(x.teachers) === list(cur.teachers));
    if (candidates.length === 1 && reverse.length === 1) {
      pairs.push([candidates[0], cur]);
      removed.splice(removed.indexOf(candidates[0]), 1);
      added.splice(added.indexOf(cur), 1);
    }
  }

  const changes: Change[] = [];

  for (const [old, cur] of pairs) {
    const details: string[] = [];
    let kind: ChangeKind | null = null;
    let title = "";

    if (!old.canceled && cur.canceled) {
      kind = "lesson_canceled";
      title = `Cours annulé — ${cur.subject}`;
      details.push(when(cur));
      if (cur.status) details.push(cur.status);
    } else if (old.canceled && !cur.canceled) {
      kind = "lesson_restored";
      title = `Cours rétabli — ${cur.subject}`;
      details.push(when(cur));
    }

    if (old.start !== cur.start || old.end !== cur.end) {
      kind ??= "lesson_moved";
      title ||= `Cours déplacé — ${cur.subject}`;
      details.push(`${when(old)} → ${when(cur)}`);
    }

    if (!cur.canceled) {
      const oldRooms = list(old.rooms);
      const newRooms = list(cur.rooms);
      if (oldRooms !== newRooms) {
        kind ??= "lesson_room";
        title ||= `Changement de salle — ${cur.subject}`;
        if (!details.length) details.push(when(cur));
        details.push(`salle ${oldRooms || "?"} → ${newRooms || "aucune"}`);
      }
      const oldTeachers = list(old.teachers);
      const newTeachers = list(cur.teachers);
      if (oldTeachers !== newTeachers) {
        kind ??= "lesson_teacher";
        title ||= `Changement de professeur — ${cur.subject}`;
        if (!details.length) details.push(when(cur));
        details.push(`${oldTeachers || "aucun"} → ${newTeachers || "aucun"}`);
      }
      const oldStatus = meaningfulStatus(old.status);
      const newStatus = meaningfulStatus(cur.status);
      if (oldStatus !== newStatus && newStatus) {
        kind ??= "lesson_status";
        title ||= `${cur.subject} — ${newStatus}`;
        if (!details.length) details.push(when(cur));
        if (!title.includes(newStatus)) details.push(newStatus);
      }
      if (!old.test && cur.test) {
        kind ??= "lesson_test";
        title ||= `Évaluation annoncée — ${cur.subject}`;
        if (!details.length) details.push(when(cur));
        else details.push("évaluation");
      }
    }

    if (kind) {
      const state = [cur.start, cur.end, cur.canceled ? 1 : 0, list(cur.rooms), list(cur.teachers), meaningfulStatus(cur.status), cur.test ? 1 : 0].join("|");
      changes.push(lessonChange(kind, cur, title, details, state));
    }
  }

  for (const cur of added) {
    const details = [when(cur)];
    if (cur.rooms.length) details.push(`salle ${list(cur.rooms)}`);
    if (cur.canceled) continue; // un cours qui apparait deja annule n'interesse personne
    changes.push(lessonChange("lesson_added", cur, `Cours ajouté — ${cur.subject}`, details, "added"));
  }

  for (const old of removed) {
    if (old.canceled) continue;
    changes.push(lessonChange("lesson_removed", old, `Cours retiré — ${old.subject}`, [when(old)], "removed"));
  }

  return changes;
}

export function diffSnapshots(prev: Snapshot | null, next: Snapshot): Change[] {
  // Premier instantane : on etablit la reference, sans rien signaler.
  if (!prev) return [];
  const both = (part: SnapshotPart) => okOf(prev, part) && okOf(next, part);
  const changes: Change[] = [];

  if (both("lessons")) changes.push(...diffLessons(prev, next));

  if (both("grades")) {
    const known = new Set(prev.grades.map((g) => g.id));
    // Changement de trimestre : toutes les notes ont de nouveaux identifiants.
    const samePeriod = prev.currentPeriodName === next.currentPeriodName;
    if (samePeriod) {
      for (const g of next.grades) {
        if (known.has(g.id)) continue;
        const shown = g.value !== null && g.outOf !== null ? `${g.value}/${g.outOf}` : "non noté";
        changes.push({
          kind: "grade_new",
          key: `grade:${g.id}`,
          targetDate: null,
          subject: g.subject,
          title: `Nouvelle note — ${g.subject}`,
          detail: [`${shown}`, `coef ${g.coefficient}`, g.average !== null ? `moyenne de classe ${g.average}` : "", g.comment].filter(Boolean).join(" · "),
        });
      }

      const before = new Map(prev.averages.map((a) => [a.subject, a]));
      for (const a of next.averages) {
        const old = before.get(a.subject);
        if (!old || old.student === null || a.student === null || Math.abs(old.student - a.student) < 0.01) continue;
        changes.push({
          kind: "average_change",
          key: `avg:${a.subject}:${a.student}`,
          targetDate: null,
          subject: a.subject,
          title: `Moyenne ${a.student > old.student ? "en hausse" : "en baisse"} — ${a.subject}`,
          detail: `${old.student} → ${a.student}${a.outOf ? `/${a.outOf}` : ""}`,
        });
      }
    }
  }

  if (both("assignments")) {
    const known = new Set(prev.assignments.map((h) => h.id));
    for (const h of next.assignments) {
      if (known.has(h.id) || h.done || h.deadline < Date.now()) continue;
      changes.push({
        kind: "homework_new",
        key: `hw:${h.id}`,
        targetDate: h.deadline,
        subject: h.subject,
        title: `Nouveau devoir — ${h.subject}`,
        detail: `Pour ${fmtDate(h.deadline)} · ${h.description.replace(/\s+/g, " ").slice(0, 280)}`,
      });
    }
  }

  if (both("discussions")) {
    const before = new Map(prev.discussions.map((d) => [d.id, d]));
    for (const d of next.discussions) {
      const old = before.get(d.id);
      const fresh = old ? d.lastMessage > old.lastMessage && d.unread > 0 : d.unread > 0;
      if (!fresh) continue;
      changes.push({
        kind: "discussion_new",
        key: `msg:${d.id}:${d.lastMessage}`,
        targetDate: null,
        subject: d.subject,
        title: d.subject,
        detail: `De ${d.sender}${d.unread > 1 ? ` · ${d.unread} messages non lus` : ""}`,
      });
    }
  }

  if (both("news")) {
    const known = new Set(prev.news.map((n) => n.id));
    for (const n of next.news) {
      if (known.has(n.id)) continue;
      changes.push({
        kind: "news_new",
        key: `news:${n.id}`,
        targetDate: null,
        title: n.title,
        detail: `${n.author}, ${fmtDate(n.date)}${n.content ? `\n${n.content.slice(0, 1200)}` : ""}`,
      });
    }
  }

  if (both("absences")) {
    const before = new Map(prev.absences.map((a) => [a.id, a]));
    for (const a of next.absences) {
      const old = before.get(a.id);
      if (!old) {
        changes.push({
          kind: "absence_new",
          key: `abs:${a.id}`,
          targetDate: null,
          title: "Absence enregistrée",
          detail: `${fmtDate(a.from)} · ${a.hours} · ${a.justified ? "justifiée" : "à justifier"}${a.reason ? ` (${a.reason})` : ""}`,
        });
      } else if (!old.justified && a.justified) {
        changes.push({
          kind: "absence_justified",
          key: `absj:${a.id}`,
          targetDate: null,
          title: "Absence justifiée",
          detail: `${fmtDate(a.from)} · ${a.hours}`,
        });
      }
    }
  }

  return changes;
}

/** Un changement est « imminent » s'il concerne aujourd'hui ou demain. */
export function isImminent(change: Change): boolean {
  if (change.targetDate === null) return false;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime();
  return change.targetDate >= startOfToday && change.targetDate < endOfTomorrow;
}
