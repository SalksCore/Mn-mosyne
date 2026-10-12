import type { Snapshot } from "../types.js";

/**
 * Donnees fictives pour le mode apercu et pour les images d'exemple du
 * panneau, avant toute connexion PRONOTE. Eleve, etablissement et
 * professeurs sont inventes.
 */
export function demoSnapshot(): Snapshot {
  const day = (offset: number, h: number, m = 0): number => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    // Le week-end n'a pas de cours : on decale sur le lundi.
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const lesson = (offset: number, h: number, m: number, minutes: number, subject: string, room: string, teacher: string, extra: Partial<Snapshot["lessons"][number]> = {}) => {
    const start = day(offset, h, m);
    return {
      id: `demo-${offset}-${h}-${m}`,
      subject,
      teachers: [teacher],
      rooms: [room],
      groups: [],
      start,
      end: start + minutes * 60000,
      canceled: false,
      exempted: false,
      test: false,
      ...extra,
    };
  };

  const lessons = [
    lesson(0, 8, 0, 60, "Mathématiques", "B204", "M. Hélios"),
    lesson(0, 9, 0, 60, "Histoire-Géographie", "C105", "Mme Clio", { status: "Changement de salle" }),
    lesson(0, 10, 15, 60, "Anglais", "B110", "Mme Iris", { canceled: true, status: "Prof. absent" }),
    lesson(0, 11, 15, 55, "Philosophie", "A012", "M. Socrate"),
    lesson(0, 13, 30, 120, "Physique-Chimie", "Labo 2", "Mme Curie", { test: true }),
    lesson(1, 8, 0, 120, "Sciences économiques", "D301", "M. Keynes"),
    lesson(1, 10, 15, 60, "Espagnol", "B112", "Mme Lorca"),
    lesson(1, 13, 30, 60, "EPS", "Gymnase", "M. Milon"),
  ];

  const now = Date.now();
  return {
    fetchedAt: now,
    range: { from: day(0, 0), to: day(14, 0) },
    ok: { lessons: true, assignments: true, grades: true, discussions: true, news: true, absences: true },
    studentName: "Léa Démo",
    className: "Terminale G2",
    lessons,
    assignments: [
      { id: "hw1", subject: "Mathématiques", description: "Exercices 12 à 18 page 154, fonctions exponentielles.", done: true, deadline: day(0, 8), difficulty: 1 },
      { id: "hw2", subject: "Philosophie", description: "Lire « Le mythe de la caverne » et préparer trois questions.", done: false, deadline: day(0, 11, 15), difficulty: 2 },
      { id: "hw3", subject: "Espagnol", description: "Apprendre le vocabulaire de l'unité 4.", done: false, deadline: day(1, 10, 15), difficulty: 1 },
    ],
    grades: [
      { id: "g1", subject: "Philosophie", value: 16, outOf: 20, coefficient: 2, date: day(-2, 10), comment: "Très bonne copie", average: 11.4, periodName: "Trimestre 1" },
      { id: "g2", subject: "Mathématiques", value: 14.5, outOf: 20, coefficient: 3, date: day(-4, 10), comment: "", average: 12.1, periodName: "Trimestre 1" },
      { id: "g3", subject: "Anglais", value: 17, outOf: 20, coefficient: 1, date: day(-6, 10), comment: "", average: 13, periodName: "Trimestre 1" },
      { id: "g4", subject: "Physique-Chimie", value: 11, outOf: 20, coefficient: 2, date: day(-8, 10), comment: "Revoir la stœchiométrie", average: 10.2, periodName: "Trimestre 1" },
    ],
    averages: [
      { subject: "Philosophie", student: 15.2, classAverage: 11.4, outOf: 20 },
      { subject: "Mathématiques", student: 14.1, classAverage: 12.1, outOf: 20 },
      { subject: "Anglais", student: 16.4, classAverage: 13, outOf: 20 },
      { subject: "Physique-Chimie", student: 12.3, classAverage: 10.2, outOf: 20 },
      { subject: "Histoire-Géographie", student: 13.7, classAverage: 12.5, outOf: 20 },
    ],
    overallAverage: 14.3,
    discussions: [{ id: "d1", subject: "Sortie au musée", sender: "Mme Clio", lastMessage: now - 3600000, unread: 1 }],
    news: [{ id: "n1", title: "Réunion parents-professeurs", author: "Vie scolaire", date: now - 86400000, read: false }],
    absences: [],
    periods: [{ id: "p1", name: "Trimestre 1", start: day(-40, 0), end: day(40, 0) }],
    currentPeriodName: "Trimestre 1",
  };
}
