import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Regenere les images d'exemple de la documentation (docs/images) a partir
 * des donnees fictives et du reseau de demonstration. Aucun acces reseau.
 *   npm run samples
 */
process.env.MNEMO_DEMO = "1";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mnemosyne-samples-"));

const { getConfig, saveConfig, saveSnapshot } = await import("../src/store/db.js");
getConfig();
const { demoSnapshot } = await import("../src/web/demo.js");
const { renderDay } = await import("../src/render/timetable.js");
const { renderGrades } = await import("../src/render/grades.js");
const { renderBag } = await import("../src/render/bag.js");
const { renderChanges } = await import("../src/render/changes.js");
const { renderTransport } = await import("../src/render/transport.js");
const { networkById } = await import("../src/transport/catalog.js");
const { loadIndex } = await import("../src/transport/gtfs/feed.js");
const { searchStops } = await import("../src/transport/engine.js");
const { planMorning } = await import("../src/transport/plan.js");

const out = path.resolve("docs/images");
fs.mkdirSync(out, { recursive: true });
const snap = demoSnapshot();
saveSnapshot(snap);
saveConfig({
  displayName: "Léa",
  bag: {
    mathematiques: [{ label: "Calculatrice", color: "#38bdf8" }, { label: "Classeur bleu", color: "#2563eb" }],
    histoire_geographie: [{ label: "Cahier", color: "#fbbf24" }],
    philosophie: [{ label: "Livre « La République »", color: "#a78bfa" }],
    physique_chimie: [{ label: "Blouse", color: "#f2f0f4" }],
  },
});

const day = new Date(snap.lessons[0].start);
const write = (name: string, png: Buffer) => fs.writeFileSync(path.join(out, name), png);

write("brief.png", renderDay({ date: day, lessons: snap.lessons, assignments: snap.assignments, studentName: snap.studentName, className: snap.className, caption: "Bonjour Léa" }));
write("notes.png", renderGrades({ periodName: "Trimestre 1", overallAverage: snap.overallAverage, averages: snap.averages, recentGrades: snap.grades, studentName: snap.studentName }));
const subjects = [...new Set(snap.lessons.filter((l) => new Date(l.start).toDateString() === day.toDateString() && !l.canceled).map((l) => l.subject))];
write("sac.png", renderBag({ subjects, checked: subjects.map((_, i) => i < 2), current: 2, dateLabel: day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), studentName: snap.studentName }));
write("alertes.png", renderChanges([
  { kind: "lesson_canceled", key: "a", targetDate: Date.now() + 3600000, subject: "Anglais", title: "Cours annulé — Anglais", detail: "demain, 10:15-11:15 · Prof. absent" },
  { kind: "lesson_room", key: "b", targetDate: Date.now() + 7200000, subject: "Histoire-Géographie", title: "Changement de salle — Histoire-Géographie", detail: "salle A012 → C105" },
  { kind: "homework_new", key: "c", targetDate: Date.now() + 5 * 86400000, subject: "Philosophie", title: "Nouveau devoir — Philosophie", detail: "Dissertation : « Peut-on se fier à sa mémoire ? »" },
], "Ton PRONOTE a changé"));

const network = (await networkById("demo-aster"))!;
const index = await loadIndex(network);
saveConfig({
  transport: {
    ...getConfig().transport,
    enabled: true,
    networkId: network.id,
    networkName: network.name,
    homeStopId: searchStops(index, "Mairie")[0].id,
    schoolStopId: searchStops(index, "Lycée")[0].id,
  },
});
const upcoming = snap.lessons.find((l) => l.start > Date.now()) ?? snap.lessons[5];
const plan = (await planMorning(new Date(upcoming.start)))!;
write("trajet.png", renderTransport(plan, plan.best ? `Pars à ${plan.best.leaveAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Aucun passage"));
console.log(`Images ecrites dans ${out}`);
