import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Donnees isolees et reseau de demonstration : aucun acces reseau.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mnemo-test-"));
process.env.MNEMO_DEMO = "1";

const { saveConfig, getConfig, saveSnapshot } = await import("../src/store/db.js");
const { networkById } = await import("../src/transport/catalog.js");
const { loadIndex } = await import("../src/transport/gtfs/feed.js");
const { searchStops } = await import("../src/transport/engine.js");
const { planMorning, planEvening } = await import("../src/transport/plan.js");

/** Prochain jour ouvre (lundi-samedi), a l'heure donnee. */
function nextSchoolDay(h: number, m = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d;
}

const hm = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

test("le depart du matin est le dernier qui arrive a l'heure, pas le premier bus de la journee", async () => {
  const network = await networkById("demo-aster");
  assert.ok(network, "reseau de demo present dans le catalogue");
  const index = await loadIndex(network!);
  const home = searchStops(index, "Mairie")[0];
  const school = searchStops(index, "Lycée Victor")[0];
  assert.ok(home && school, "arrets trouves");
  assert.equal(home.quays.length, 2, "quais bus + tram regroupes");

  saveConfig({
    timezone: "Europe/Paris",
    transport: {
      ...getConfig().transport,
      enabled: true,
      networkId: network!.id,
      networkName: network!.name,
      homeStopId: home.id,
      schoolStopId: school.id,
      walkToHomeStop: 6,
      walkFromSchoolStop: 5,
      arriveMinBefore: 5,
    },
  });

  const first = nextSchoolDay(8, 0);
  saveSnapshot({
    fetchedAt: Date.now(),
    range: { from: first.getTime() - 86400000, to: first.getTime() + 86400000 },
    ok: { lessons: true, assignments: true, grades: true, discussions: true, news: true, absences: true },
    studentName: "Test",
    className: "",
    lessons: [
      { id: "l1", subject: "Maths", teachers: [], rooms: [], groups: [], start: first.getTime(), end: first.getTime() + 3600000, canceled: false, exempted: false, test: false },
      { id: "l2", subject: "SES", teachers: [], rooms: [], groups: [], start: first.getTime() + 7 * 3600000, end: first.getTime() + 8 * 3600000, canceled: false, exempted: false, test: false },
    ],
    assignments: [], grades: [], averages: [], overallAverage: null, discussions: [], news: [], absences: [], periods: [], currentPeriodName: null,
  });

  const plan = await planMorning(first);
  assert.ok(plan?.best, "un trajet est retenu");
  const best = plan!.best!;
  // Tram A toutes les 8 min des 5:45, 13 min de trajet : le dernier qui
  // arrive avant 7:50 (8:00 - 5 min de marge - 5 min de marche) part a 7:37.
  assert.equal(hm(best.journey.departure), "07:37");
  assert.equal(best.journey.line.short, "A");
  assert.equal(hm(best.leaveAt), "07:31");
  assert.ok(best.marginMinutes! >= 0 && best.marginMinutes! < 8, `marge ${best.marginMinutes}`);
  assert.equal(hm(plan!.notifyAt!), "07:16");

  // Si le premier cours saute, le depart recule d'autant.
  const later = nextSchoolDay(10, 0);
  const snapshot = (await import("../src/store/db.js")).getSnapshot()!;
  snapshot.lessons[0].start = later.getTime();
  snapshot.lessons[0].end = later.getTime() + 3600000;
  saveSnapshot(snapshot);
  const plan2 = await planMorning(first);
  assert.ok(plan2!.best!.journey.departure.getHours() >= 9, "depart recale sur 10 h");

  const evening = await planEvening(first);
  assert.ok(evening?.best, "retour trouve");
  assert.ok(evening!.best!.journey.departure.getTime() >= first.getTime() + 8 * 3600000 + 5 * 60000, "apres la sortie + marche");
});
