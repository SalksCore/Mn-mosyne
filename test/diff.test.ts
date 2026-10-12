import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots } from "../src/pronote/diff.js";
import type { FlatLesson, Snapshot } from "../src/types.js";

const H = 3600 * 1000;
const base = Date.now() + 24 * H;

function lesson(id: string, offsetH: number, subject: string, extra: Partial<FlatLesson> = {}): FlatLesson {
  return { id, subject, teachers: ["M. X"], rooms: ["B1"], groups: [], start: base + offsetH * H, end: base + (offsetH + 1) * H, canceled: false, exempted: false, test: false, ...extra };
}

function snap(lessons: FlatLesson[], range = { from: base - 48 * H, to: base + 14 * 24 * H }): Snapshot {
  return {
    fetchedAt: Date.now(), range,
    ok: { lessons: true, assignments: true, grades: true, discussions: true, news: true, absences: true },
    studentName: "", className: "", lessons, assignments: [], grades: [], averages: [], overallAverage: null,
    discussions: [], news: [], absences: [], periods: [], currentPeriodName: "T1",
  };
}

test("une annulation produit une seule alerte, meme avec un statut", () => {
  const before = snap([lesson("a", 0, "Anglais")]);
  const after = snap([lesson("a", 0, "Anglais", { canceled: true, status: "Cours annulé" })]);
  const changes = diffSnapshots(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "lesson_canceled");
});

test("la semaine qui sort de la fenetre ne declenche pas de « cours retire »", () => {
  const before = snap([lesson("old", -30, "Maths"), lesson("b", 2, "SES")], { from: base - 7 * 24 * H, to: base + 7 * 24 * H });
  const after = snap([lesson("b", 2, "SES")], { from: base - 1 * H, to: base + 14 * 24 * H });
  assert.deepEqual(diffSnapshots(before, after), []);
});

test("pas de faux « deplace » entre deux cours differents de la meme matiere", () => {
  const before = snap([lesson("m1", 0, "Maths"), lesson("m2", 48, "Maths")]);
  const after = snap([lesson("m2", 48, "Maths")]);
  const changes = diffSnapshots(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "lesson_removed");
});

test("un changement de salle garde une cle stable d'un cycle a l'autre", () => {
  const before = snap([lesson("r", 3, "Histoire")]);
  const after = snap([lesson("r", 3, "Histoire", { rooms: ["C105"] })]);
  const a = diffSnapshots(before, after);
  const b = diffSnapshots(before, after);
  assert.equal(a[0].kind, "lesson_room");
  assert.equal(a[0].key, b[0].key);
});

test("une categorie non recuperee n'est pas comparee", () => {
  const before = snap([lesson("x", 1, "Maths")]);
  const after = { ...snap([]), ok: { ...snap([]).ok, lessons: false } };
  assert.deepEqual(diffSnapshots(before, after), []);
});
