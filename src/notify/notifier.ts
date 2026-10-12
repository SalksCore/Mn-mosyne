import { ButtonStyle, type Client, type MessageCreateOptions } from "discord.js";
import { getConfig, getPending, getSeen, getSnapshot, markSeen, savePending, unmarkSeen } from "../store/db.js";
import { renderDay } from "../render/timetable.js";
import { renderChanges } from "../render/changes.js";
import { renderBag } from "../render/bag.js";
import { isImminent } from "../pronote/diff.js";
import { subjectKey, subjectColor } from "../render/theme.js";
import { attach, button, card, cardMessage, row } from "../ui/components.js";
import type { Change, Snapshot } from "../types.js";
import { sameDay } from "../render/util.js";

/** Envoie un message en DM au proprietaire configure. */
export async function sendToOwner(client: Client, payload: MessageCreateOptions): Promise<void> {
  const cfg = getConfig();
  if (!cfg.ownerId) {
    console.warn("[notify] aucun proprietaire configure, message ignore");
    return;
  }
  try {
    const user = await client.users.fetch(cfg.ownerId);
    await user.send(payload);
    console.log(`[notify] DM envoye a ${cfg.ownerId} (${payload.files?.length ?? 0} fichier(s))`);
  } catch (err) {
    console.error("[notify] impossible d'envoyer le DM:", err);
  }
}

const KIND_TO_TOGGLE: Record<string, keyof ReturnType<typeof getConfig>["notifications"]> = {
  lesson_canceled: "timetable",
  lesson_restored: "timetable",
  lesson_room: "timetable",
  lesson_teacher: "timetable",
  lesson_moved: "timetable",
  lesson_added: "timetable",
  lesson_removed: "timetable",
  lesson_status: "timetable",
  lesson_test: "evaluations",
  grade_new: "grades",
  average_change: "grades",
  homework_new: "homework",
  homework_done: "homework",
  discussion_new: "discussions",
  news_new: "news",
  absence_new: "attendance",
  absence_justified: "attendance",
};

/** Filtre les changements selon les bascules de notification de la config. */
export function filterChanges(changes: Change[]): Change[] {
  const cfg = getConfig();
  return changes.filter((c) => {
    const toggle = KIND_TO_TOGGLE[c.kind];
    return toggle ? cfg.notifications[toggle] : true;
  });
}

const changeKey = (change: Change): string => `pronote:${change.key}`;

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Sommes-nous dans la plage silencieuse (qui peut enjamber minuit) ? */
export function inQuietHours(now = new Date()): boolean {
  const q = getConfig().quietHours;
  if (!q.enabled) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(q.start);
  const end = toMinutes(q.end);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

const ACCENTS = {
  pink: "#f472b6",
  violet: "#a78bfa",
  sky: "#38bdf8",
};

function lineOf(c: Change): string {
  return `• **${c.title}**\n-# ${c.detail.split("\n")[0].slice(0, 180)}`;
}

/** Messages et actualites : une carte chacun, le contenu compte. */
async function notifyStandalone(client: Client, changes: Change[]): Promise<void> {
  if (changes.length > 3) {
    await sendToOwner(
      client,
      cardMessage(
        card({
          accent: ACCENTS.violet,
          title: `💬 ${changes.length} nouveautés dans ta messagerie PRONOTE`,
          body: [changes.slice(0, 10).map(lineOf).join("\n")],
          footer: "Messagerie et informations PRONOTE",
        }),
      ),
    );
    return;
  }
  for (const change of changes) {
    const isDiscussion = change.kind === "discussion_new";
    await sendToOwner(
      client,
      cardMessage(
        card({
          accent: isDiscussion ? ACCENTS.violet : ACCENTS.sky,
          title: isDiscussion ? `💬 ${change.title}` : `📰 ${change.title}`,
          body: [change.detail.slice(0, 1500)],
          footer: isDiscussion ? "Nouveau message PRONOTE" : "Nouvelle information PRONOTE",
        }),
      ),
    );
  }
}

async function notifyGroup(client: Client, changes: Change[], opts: { accent: string; title: string; lead: string; heading: string; file: string; footer: string }): Promise<void> {
  const img = renderChanges(changes, opts.heading);
  await sendToOwner(
    client,
    cardMessage(
      card({
        accent: opts.accent,
        title: opts.title,
        body: [opts.lead, changes.slice(0, 6).map(lineOf).join("\n")],
        image: opts.file,
        footer: opts.footer,
      }),
      [attach(img, opts.file)],
    ),
  );
}

/**
 * Envoie les changements, regroupes par urgence :
 *  - aujourd'hui / demain (rouge), puis plus tard (ambre) pour l'emploi du temps et les devoirs ;
 *  - notes, absences ;
 *  - messagerie et actualites, a part.
 * Pendant les heures calmes, tout est mis de cote et part au reveil.
 */
export async function notifyChanges(client: Client, changes: Change[], force = false): Promise<void> {
  const cfg = getConfig();
  const seen = getSeen();
  const fresh = filterChanges(changes).filter((c) => !(changeKey(c) in seen));
  console.log(`[notify] changements recus=${changes.length} nouveaux=${fresh.length}`);
  if (!fresh.length) return;

  if (!force && inQuietHours()) {
    const pending = getPending<Change>();
    const keys = new Set(pending.map((c) => c.key));
    savePending([...pending, ...fresh.filter((c) => !keys.has(c.key))]);
    markSeen(fresh.map(changeKey));
    console.log(`[notify] heures calmes : ${fresh.length} changement(s) mis de cote`);
    return;
  }

  const name = cfg.displayName || "toi";
  const standalone = fresh.filter((c) => c.kind === "discussion_new" || c.kind === "news_new");
  const school = fresh.filter((c) => ["grade_new", "average_change", "absence_new", "absence_justified"].includes(c.kind));
  const dated = fresh.filter((c) => !standalone.includes(c) && !school.includes(c));
  const imminent = dated.filter(isImminent);
  const future = dated.filter((c) => !isImminent(c));

  if (imminent.length) {
    await notifyGroup(client, imminent, {
      accent: cfg.colorImminent,
      title: `🔔 ${name}, ça change pour aujourd'hui ou demain`,
      lead: `**${imminent.length} changement${imminent.length > 1 ? "s" : ""}** à connaître tout de suite.`,
      heading: "Aujourd'hui et demain",
      file: "changements-imminents.png",
      footer: "Rouge : aujourd'hui ou demain",
    });
  }
  if (future.length) {
    await notifyGroup(client, future, {
      accent: cfg.colorFuture,
      title: `📅 ${name}, changements à venir`,
      lead: `**${future.length} changement${future.length > 1 ? "s" : ""}** sur les prochains jours.`,
      heading: "Les prochains jours",
      file: "changements-a-venir.png",
      footer: "Ambre : date plus lointaine",
    });
  }
  if (school.length) {
    await notifyGroup(client, school, {
      accent: ACCENTS.pink,
      title: school.every((c) => c.kind === "grade_new" || c.kind === "average_change") ? "📝 Du nouveau dans tes notes" : "🏫 Vie scolaire",
      lead: `**${school.length} nouveauté${school.length > 1 ? "s" : ""}**.`,
      heading: "Notes et vie scolaire",
      file: "notes-vie-scolaire.png",
      footer: "PRONOTE",
    });
  }
  await notifyStandalone(client, standalone);

  markSeen(fresh.map(changeKey));
}

/** Envoie ce qui a ete retenu pendant la nuit, des la fin des heures calmes. */
export async function flushPending(client: Client): Promise<void> {
  if (inQuietHours()) return;
  const pending = getPending<Change>();
  if (!pending.length) return;
  savePending([]);
  // Ces changements avaient ete marques comme vus en les mettant de cote.
  unmarkSeen(pending.map(changeKey));
  console.log(`[notify] fin des heures calmes : envoi de ${pending.length} changement(s)`);
  await notifyChanges(client, pending, true);
}

/** Prevenir le proprietaire que la session PRONOTE est morte. */
export async function notifySessionLost(client: Client, reason: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg.notifications.sessionExpiry) return;

  await sendToOwner(
    client,
    cardMessage(
      card({
        accent: "#f87171",
        title: "⚠️ Session PRONOTE expiree",
        body: [
          reason,
          "Les notifications sont suspendues jusqu'a la reconnexion.",
          "Lance **`/config connexion`** pour obtenir un nouveau lien de connexion.",
        ],
        footer: "Le bot retentera automatiquement au prochain cycle",
      }),
    ),
  );
}

export type BriefWhen = "morning" | "evening" | "manual";

/**
 * Construit le brief journalier : image de l'emploi du temps du jour cible,
 * resume texte, et bouton pour lancer la preparation du sac.
 */
export function buildBrief(
  snapshot: Snapshot,
  target: Date,
  when: BriefWhen,
): MessageCreateOptions {
  const cfg = getConfig();
  const name = cfg.displayName || snapshot.studentName.split(" ")[0] || "toi";

  const lessons = snapshot.lessons
    .filter((l) => sameDay(l.start, target))
    .sort((a, b) => a.start - b.start);
  const homework = snapshot.assignments.filter((h) => sameDay(h.deadline, target));
  console.log(
    `[brief] cible=${target.toLocaleDateString("fr-FR")} cours=${lessons.length} devoirs=${homework.length}/${snapshot.assignments.length}`,
  );

  const caption =
    when === "morning"
      ? `Bonjour ${name}`
      : when === "evening"
        ? `Bonsoir ${name} — demain`
        : `Ta journee, ${name}`;

  const img = renderDay({
    date: target,
    lessons: snapshot.lessons,
    assignments: snapshot.assignments,
    studentName: snapshot.studentName,
    className: snapshot.className,
    caption,
  });
  const file = `edt-${target.toISOString().slice(0, 10)}.png`;

  // Resume textuel
  const canceled = lessons.filter((l) => l.canceled);
  const tests = lessons.filter((l) => l.test);
  const undone = homework.filter((h) => !h.done);

  const body: string[] = [];

  if (!lessons.length) {
    body.push("**Aucun cours** ce jour. Profites-en.");
  } else {
    const first = lessons.find((l) => !l.canceled);
    const last = [...lessons].reverse().find((l) => !l.canceled);
    body.push(
      [
        `**${lessons.length} cours**`,
        first ? `debut **${fmt(first.start)}**` : null,
        last ? `fin **${fmt(last.end)}**` : null,
      ]
        .filter(Boolean)
        .join(" • "),
    );
  }

  if (canceled.length) {
    body.push(
      `🚫 **Annulations**\n${canceled
        .map((l) => `• ${l.subject} (${fmt(l.start)})${l.status ? ` — ${l.status}` : ""}`)
        .join("\n")}`,
    );
  }

  const roomed = lessons.filter((l) => !l.canceled && l.rooms.length);
  if (roomed.length) {
    body.push(
      `📍 **Salles**\n${roomed
        .slice(0, 12)
        .map((l) => `• ${fmt(l.start)} ${l.subject} → **${l.rooms.join(", ")}**`)
        .join("\n")}`,
    );
  }

  if (tests.length) {
    body.push(
      `📝 **Evaluations annoncees**\n${tests.map((l) => `• ${l.subject} a ${fmt(l.start)}`).join("\n")}`,
    );
  }

  if (homework.length) {
    body.push(
      `📚 **Devoirs (${homework.length - undone.length}/${homework.length} faits)**\n${homework
        .map(
          (h) =>
            `${h.done ? "✅" : "⬜"} **${h.subject}** — ${h.description.replace(/\s+/g, " ").slice(0, 110)}`,
        )
        .join("\n")}`,
    );
  } else {
    body.push("📚 **Devoirs** — rien a rendre.");
  }

  const subjects = uniqueSubjects(lessons);
  const bagReady = subjects.some((s) => (cfg.bag[subjectKey(s)] ?? []).length > 0);

  const rows = [
    row(
      button(
        `bag:start:${target.toISOString().slice(0, 10)}`,
        bagReady ? "Preparer mon sac" : "Configurer mon sac",
        ButtonStyle.Primary,
        "🎒",
      ),
      button(`brief:refresh:${target.toISOString().slice(0, 10)}`, "Actualiser", ButtonStyle.Secondary, "🔄"),
    ),
  ];

  return cardMessage(
    card({
      accent: canceled.length ? cfg.colorImminent : "#f472b6",
      title: `${when === "evening" ? "🌙" : "☀️"} ${caption}`,
      body,
      image: file,
      rows,
      footer: `Donnees a jour du ${new Date(snapshot.fetchedAt).toLocaleTimeString("fr-FR")}`,
    }),
    [attach(img, file)],
  );
}

export function uniqueSubjects(lessons: { subject: string; canceled: boolean }[]): string[] {
  const set = new Set<string>();
  for (const l of lessons) if (!l.canceled) set.add(l.subject);
  return [...set];
}

const fmt = (ts: number): string =>
  new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/**
 * Etape de preparation du sac : carte Components V2 (texte + boutons)
 * ET image de checklist, regenerees ensemble a chaque clic pour rester
 * strictement synchronisees.
 */
export function buildBagStep(
  dateISO: string,
  subjects: string[],
  index: number,
  checked: boolean[],
): MessageCreateOptions {
  const cfg = getConfig();
  const name = cfg.displayName || "toi";
  const snap = getSnapshot();

  const dateLabel = new Date(`${dateISO}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // L'image reflete l'etat complet, pas seulement l'etape courante.
  const img = renderBag({
    subjects,
    checked,
    current: index,
    dateLabel: dateLabel.replace(/^./, (c) => c.toUpperCase()),
    studentName: snap?.studentName ?? name,
  });
  const file = `sac-${dateISO}.png`;

  const doneCount = checked.filter(Boolean).length;
  const finished = index >= subjects.length;

  // --- Etape finale ---
  if (finished) {
    const complete = doneCount === subjects.length;
    return cardMessage(
      card({
        accent: complete ? "#34d399" : "#fbbf24",
        title: complete ? "🎒 Sac pret" : "🎒 Sac incomplet",
        body: [
          `**${doneCount}/${subjects.length}** matiere${subjects.length > 1 ? "s" : ""} validee${doneCount > 1 ? "s" : ""}.`,
          complete
            ? `Tout y est, ${name}. Bonne journee.`
            : `Non validees : ${subjects.filter((_, i) => !checked[i]).join(", ")}.`,
        ],
        image: file,
        rows: [row(button(`bag:restart:${dateISO}`, "Recommencer", ButtonStyle.Secondary, "🔄"))],
      }),
      [attach(img, file)],
    );
  }

  // --- Etape en cours ---
  const subject = subjects[index];
  const items = cfg.bag[subjectKey(subject)] ?? [];
  const color = subjectColor(subject);

  const body: string[] = [
    `**Etape ${index + 1}/${subjects.length}** — ${doneCount} validee(s)`,
    items.length
      ? items.map((it) => `${colorDot(it.color)} **${it.label}** \`${it.color}\``).join("\n")
      : "_Aucun materiel configure pour cette matiere._\nAjoute-le avec `/sac ajouter`.",
  ];

  return cardMessage(
    card({
      accent: color,
      title: `🎒 ${subject}`,
      body,
      image: file,
      rows: [
        row(
          button(`bag:ok:${dateISO}:${index}`, "C'est dans le sac", ButtonStyle.Success, "✅"),
          button(`bag:skip:${dateISO}:${index}`, "Passer", ButtonStyle.Secondary, "⏭️"),
        ),
      ],
      footer: "Les pastilles du message sont approximatives — l'image affiche tes couleurs exactes",
    }),
    [attach(img, file)],
  );
}

/**
 * Discord n'affiche pas de couleur arbitraire dans le texte : on approxime
 * la couleur hexadecimale configuree par la pastille unicode la plus proche.
 */
export function colorDot(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  if (max - min < 28) {
    if (lum > 0.8) return "⚪";
    if (lum < 0.22) return "⚫";
    return "🔘";
  }
  if (r === max && g > b + 40) return "🟠";
  if (r === max && b > g + 60) return "🟣";
  if (r === max) return "🔴";
  if (g === max && r > b + 40) return "🟡";
  if (g === max) return "🟢";
  if (b === max && r > g + 30) return "🟣";
  if (b === max) return "🔵";
  return "🟤";
}
