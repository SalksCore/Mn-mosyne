import {
  ButtonStyle,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { DEFAULT_CONFIG, getConfig, getSnapshot, resetAll, saveConfig } from "../store/db.js";
import { isLinked, unlink } from "../pronote/client.js";
import { pollOnce, rescheduleAll, sendBrief } from "../scheduler/jobs.js";
import { panelLink } from "../web/server.js";
import { renderDay } from "../render/timetable.js";
import { renderGrades } from "../render/grades.js";
import { normalizeHex, subjectKey, subjectColor } from "../render/theme.js";
import { sameDay } from "../render/util.js";
import {
  attach,
  button,
  card,
  cardMessage,
  errorCard,
  linkButton,
  row,
  V2_FLAGS,
} from "../ui/components.js";
import { buildBagStep, buildBrief, colorDot, uniqueSubjects } from "../notify/notifier.js";
import type { BotConfig } from "../types.js";

/** Etat en memoire des sessions de preparation du sac. */
export const bagSessions = new Map<string, { subjects: string[]; checked: boolean[] }>();

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Interprete "aujourd'hui", "demain", ou une date ISO. */
function parseDay(input: string | null): Date | null {
  const today = new Date();
  if (!input) return today;
  const v = input.trim().toLowerCase();
  if (["aujourd'hui", "aujourdhui", "today", "auj"].includes(v)) return today;
  if (["demain", "tomorrow"].includes(v)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (["hier", "yesterday"].includes(v)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

/**
 * Reponse en Components V2.
 * Le bot n'utilise pas de messages ephemeres : tout se passe en message
 * prive, ou la confidentialite est deja acquise et ou un message visible
 * reste consultable dans l'historique.
 */
async function replyCard(
  interaction: ChatInputCommandInteraction,
  payload: ReturnType<typeof cardMessage>,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ ...payload, flags: V2_FLAGS } as never);
  } else {
    await interaction.reply({ ...payload, flags: V2_FLAGS } as never);
  }
}

function requireSnapshot(interaction: ChatInputCommandInteraction) {
  const snap = getSnapshot();
  if (!snap) {
    void replyCard(
      interaction,
      errorCard(
        "Aucune donnee",
        isLinked()
          ? "Le premier chargement PRONOTE n'est pas encore termine. Reessaie dans une minute, ou lance `/sync`."
          : "Aucun compte PRONOTE lie. Lance `/setup` pour commencer.",
      ),
    );
    return null;
  }
  return snap;
}

// ---------------------------------------------------------------- /setup

export async function handleSetup(
  interaction: ChatInputCommandInteraction,
  _client: Client,
): Promise<void> {
  // La premiere personne a lancer /setup devient la destinataire des alertes.
  const cfg = getConfig();
  if (!cfg.ownerId) saveConfig({ ownerId: interaction.user.id });

  await replyCard(
    interaction,
    cardMessage(
      card({
        accent: "#f472b6",
        title: "🏛️ Bienvenue dans Mnémosyne",
        body: [
          "Toute la configuration se fait dans ton **panneau en ligne** : connexion PRONOTE, prénom, horaires des briefs, alertes, sac et trajets.",
          [
            "**01** Connecter PRONOTE (identifiants, QR code ou ENT)",
            "**02** Choisir ton prénom et tes horaires",
            "**03** Régler les alertes",
            "**04** Optionnel : ton réseau de bus, tram ou car",
          ].join("\n"),
          "-# Lien personnel, valable 15 minutes et utilisable une seule fois. Ensuite, le panneau te reconnaît pendant 30 jours.",
        ],
        rows: [row(linkButton(panelLink("/"), "Ouvrir mon panneau", "🔐"))],
        footer: "Je t'écris ici dès que ton compte PRONOTE est relié",
      }),
    ),
  );
}

/** /settings : un lien vers le panneau, ou se trouvent tous les reglages. */
export async function handleSettings(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!getConfig().ownerId) saveConfig({ ownerId: interaction.user.id });
  await replyCard(
    interaction,
    cardMessage(
      card({
        accent: "#f472b6",
        title: "⚙️ Tous tes réglages",
        body: [
          "PRONOTE, prénom, briefs, alertes et heures calmes, trajets et réseau, sac, thèmes et couleurs : tout se règle dans ton panneau.",
          "-# Lien personnel, valable 15 minutes, utilisable une fois.",
        ],
        rows: [row(linkButton(panelLink("/"), "Ouvrir les réglages", "⚙️"))],
      }),
    ),
  );
}

// --------------------------------------------------------------- /config

export async function handleConfig(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const cfg = getConfig();

  switch (sub) {
    case "voir": {
      const subjectLines = Object.entries(cfg.subjectColors);
      const bagCount = Object.values(cfg.bag).reduce((a, b) => a + b.length, 0);

      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: "#f472b6",
            title: "⚙️ Configuration",
            body: [
              [
                `**Prenom** — ${cfg.displayName || "_non defini_"}`,
                `**Compte PRONOTE** — ${isLinked() ? "✅ lie" : "❌ non lie"}`,
                `**Fuseau** — ${cfg.timezone}`,
              ].join("\n"),
              [
                `**Brief matin** — ${cfg.morningBriefTime} ${cfg.morningBriefEnabled ? "✅" : "❌"}`,
                `**Brief soir** — ${cfg.eveningBriefTime} ${cfg.eveningBriefEnabled ? "✅" : "❌"}`,
                `**Verification** — toutes les ${cfg.pollIntervalMinutes} min (${(60 / cfg.pollIntervalMinutes).toFixed(1)} appels/h)`,
              ].join("\n"),
              `**Notifications**\n${Object.entries(cfg.notifications)
                .map(([k, v]) => `${v ? "✅" : "❌"} ${k}`)
                .join("  •  ")}`,
              [
                `**Couleurs d'accent** — ${colorDot(cfg.colorImminent)} imminent \`${cfg.colorImminent}\` · ${colorDot(cfg.colorFuture)} futur \`${cfg.colorFuture}\``,
                `**Couleurs de matiere** — ${subjectLines.length} definie(s)`,
                `**Sac** — ${bagCount} element(s) sur ${Object.keys(cfg.bag).length} matiere(s)`,
              ].join("\n"),
            ],
            footer: "Modifie avec /config <sous-commande>",
          }),
        ),
      );
      return;
    }

    case "connexion":
    case "web": {
      if (!cfg.ownerId) saveConfig({ ownerId: interaction.user.id });
      const target = sub === "connexion" ? "/pronote" : "/";
      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: "#f472b6",
            title: sub === "connexion" ? "🔐 Connexion PRONOTE" : "🛠️ Panneau de configuration",
            body: ["Ouvre ton panneau pour modifier tes réglages.", "-# Lien personnel, valable 15 minutes, utilisable une fois."],
            rows: [row(linkButton(panelLink(target), "Ouvrir le panneau", "🔗"))],
          }),
        ),
      );
      return;
    }

    case "nom": {
      const prenom = interaction.options.getString("prenom", true).trim();
      saveConfig({ displayName: capitalize(prenom) });
      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: "#34d399",
            title: "✅ Prenom mis a jour",
            body: [`Je t'appellerai desormais **${capitalize(prenom)}**.`],
          }),
        ),
      );
      return;
    }

    case "horaires": {
      const matin = interaction.options.getString("matin");
      const soir = interaction.options.getString("soir");
      const matinActif = interaction.options.getBoolean("matin_actif");
      const soirActif = interaction.options.getBoolean("soir_actif");
      const fuseau = interaction.options.getString("fuseau");

      const patch: Partial<BotConfig> = {};

      if (matin) {
        if (!HHMM.test(matin)) {
          await replyCard(interaction, errorCard("Heure invalide", "Format attendu : `HH:MM`, ex `06:00`."));
          return;
        }
        patch.morningBriefTime = matin;
      }
      if (soir) {
        if (!HHMM.test(soir)) {
          await replyCard(interaction, errorCard("Heure invalide", "Format attendu : `HH:MM`, ex `20:00`."));
          return;
        }
        patch.eveningBriefTime = soir;
      }
      if (matinActif !== null) patch.morningBriefEnabled = matinActif;
      if (soirActif !== null) patch.eveningBriefEnabled = soirActif;
      if (fuseau) {
        try {
          new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau });
          patch.timezone = fuseau;
        } catch {
          await replyCard(interaction, errorCard("Fuseau invalide", "Utilise un identifiant IANA, ex `Europe/Paris`."));
          return;
        }
      }

      if (!Object.keys(patch).length) {
        await replyCard(interaction, errorCard("Rien a modifier", "Renseigne au moins une option."));
        return;
      }

      const next = saveConfig(patch);
      rescheduleAll(client);

      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: "#34d399",
            title: "✅ Horaires mis a jour",
            body: [
              `**Matin** — ${next.morningBriefTime} ${next.morningBriefEnabled ? "actif" : "desactive"}`,
              `**Soir** — ${next.eveningBriefTime} ${next.eveningBriefEnabled ? "actif" : "desactive"}`,
              `**Fuseau** — ${next.timezone}`,
            ],
          }),
        ),
      );
      return;
    }

    case "intervalle": {
      const minutes = interaction.options.getInteger("minutes", true);
      saveConfig({ pollIntervalMinutes: minutes });
      rescheduleAll(client);
      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: "#34d399",
            title: "✅ Intervalle mis a jour",
            body: [
              `Verification toutes les **${minutes} minutes**, soit **${(60 / minutes).toFixed(1)} appels par heure**.`,
              minutes < 5
                ? "-# ⚠️ Un intervalle tres court augmente le risque de limitation par PRONOTE."
                : "",
            ].filter(Boolean),
          }),
        ),
      );
      return;
    }

    case "notifications": {
      const type = interaction.options.getString("type", true) as keyof BotConfig["notifications"];
      const actif = interaction.options.getBoolean("actif", true);
      const notifications = { ...cfg.notifications, [type]: actif };
      saveConfig({ notifications });
      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: actif ? "#34d399" : "#9aa1b1",
            title: "✅ Notification mise a jour",
            body: [`**${type}** — ${actif ? "activee" : "desactivee"}.`],
          }),
        ),
      );
      return;
    }

    case "couleur": {
      const matiere = interaction.options.getString("matiere", true);
      const hex = normalizeHex(interaction.options.getString("hex", true));
      if (!hex) {
        await replyCard(interaction, errorCard("Couleur invalide", "Format attendu : `#rrggbb`, ex `#e63946`."));
        return;
      }
      const subjectColors = { ...cfg.subjectColors, [subjectKey(matiere)]: hex };
      saveConfig({ subjectColors });
      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: hex,
            title: "🎨 Couleur enregistree",
            body: [`${colorDot(hex)} **${matiere}** → \`${hex}\``, "Elle sera utilisee dans toutes les images d'emploi du temps."],
          }),
        ),
      );
      return;
    }

    case "accents": {
      const imminent = interaction.options.getString("imminent");
      const futur = interaction.options.getString("futur");
      const patch: Partial<BotConfig> = {};

      if (imminent) {
        const h = normalizeHex(imminent);
        if (!h) {
          await replyCard(interaction, errorCard("Couleur invalide", "`imminent` doit etre un hex, ex `#f87171`."));
          return;
        }
        patch.colorImminent = h;
      }
      if (futur) {
        const h = normalizeHex(futur);
        if (!h) {
          await replyCard(interaction, errorCard("Couleur invalide", "`futur` doit etre un hex, ex `#fbbf24`."));
          return;
        }
        patch.colorFuture = h;
      }
      if (!Object.keys(patch).length) {
        await replyCard(interaction, errorCard("Rien a modifier", "Renseigne au moins une couleur."));
        return;
      }

      const next = saveConfig(patch);
      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: next.colorImminent,
            title: "🎨 Couleurs d'accent mises a jour",
            body: [
              `${colorDot(next.colorImminent)} **Imminent** (aujourd'hui/demain) — \`${next.colorImminent}\``,
              `${colorDot(next.colorFuture)} **Futur** (plus tard) — \`${next.colorFuture}\``,
            ],
          }),
        ),
      );
      return;
    }

    case "theme": {
      const cible = interaction.options.getString("cible", true);
      const mode = interaction.options.getString("mode", true) as "clair" | "sombre";

      const imageTheme = { ...cfg.imageTheme };
      if (cible === "all") {
        imageTheme.timetable = mode;
        imageTheme.grades = mode;
        imageTheme.notifications = mode;
        imageTheme.bag = mode;
      } else {
        imageTheme[cible as keyof typeof imageTheme] = mode;
      }
      saveConfig({ imageTheme });

      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: mode === "clair" ? "#f472b6" : "#f472b6",
            title: "🎨 Theme des images mis a jour",
            body: [
              [
                `**Emploi du temps** — ${imageTheme.timetable}`,
                `**Notes** — ${imageTheme.grades}`,
                `**Notifications** — ${imageTheme.notifications}`,
                `**Sac** — ${imageTheme.bag}`,
              ].join("\n"),
              "-# Ne concerne que les images generees. Les cartes Discord suivent le theme de ton client.",
            ],
          }),
        ),
      );
      return;
    }

    case "reset": {
      unlink();
      resetAll();
      saveConfig({ ...DEFAULT_CONFIG });
      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: "#f87171",
            title: "🗑️ Configuration effacee",
            body: ["Toutes les donnees locales ont ete supprimees.", "Relance `/setup` pour repartir de zero."],
          }),
        ),
      );
      return;
    }
  }
}

// ------------------------------------------------------------------ /edt

export async function handleEdt(interaction: ChatInputCommandInteraction): Promise<void> {
  const snap = requireSnapshot(interaction);
  if (!snap) return;

  const sub = interaction.options.getSubcommand();
  await interaction.deferReply();

  if (sub === "jour") {
    const date = parseDay(interaction.options.getString("date"));
    if (!date) {
      await interaction.editReply({
        ...errorCard("Date invalide", "Utilise `AAAA-MM-JJ`, `demain` ou `aujourd'hui`."),
        flags: V2_FLAGS,
      } as never);
      return;
    }

    const img = renderDay({
      date,
      lessons: snap.lessons,
      assignments: snap.assignments,
      studentName: snap.studentName,
      className: snap.className,
      caption: "Emploi du temps",
    });
    const file = `edt-${date.toISOString().slice(0, 10)}.png`;
    const lessons = snap.lessons.filter((l) => sameDay(l.start, date));

    await interaction.editReply({
      ...cardMessage(
        card({
          accent: "#f472b6",
          title: `📅 ${date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`,
          body: [`**${lessons.length}** cours • **${lessons.filter((l) => l.canceled).length}** annule(s)`],
          image: file,
        }),
        [attach(img, file)],
      ),
      flags: V2_FLAGS,
    } as never);
    return;
  }

  // Semaine : une image par jour ouvre.
  const offset = interaction.options.getInteger("decalage") ?? 0;
  const monday = new Date();
  const dow = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dow + offset * 7);
  monday.setHours(0, 0, 0, 0);

  const days: Date[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    if (snap.lessons.some((l) => sameDay(l.start, d))) days.push(d);
  }

  if (!days.length) {
    await interaction.editReply({
      ...errorCard("Semaine vide", "Aucun cours trouve sur cette semaine dans les donnees chargees."),
      flags: V2_FLAGS,
    } as never);
    return;
  }

  const files = days.map((d) => {
    const buf = renderDay({
      date: d,
      lessons: snap.lessons,
      assignments: snap.assignments,
      studentName: snap.studentName,
      className: snap.className,
      caption: d.toLocaleDateString("fr-FR", { weekday: "long" }).replace(/^./, (c) => c.toUpperCase()),
    });
    return attach(buf, `edt-${d.toISOString().slice(0, 10)}.png`);
  });

  const summary = days
    .map((d) => {
      const ls = snap.lessons.filter((l) => sameDay(l.start, d));
      const cancels = ls.filter((l) => l.canceled).length;
      return `• **${d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })}** — ${ls.length} cours${cancels ? `, ${cancels} annule(s)` : ""}`;
    })
    .join("\n");

  const container = card({
    accent: "#f472b6",
    title: `📆 Semaine du ${monday.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`,
    body: [summary],
  });
  for (const f of files) {
    container.addMediaGalleryComponents(
      (await import("../ui/components.js")).imageGallery(f.name ?? "edt.png"),
    );
  }

  await interaction.editReply({ flags: V2_FLAGS, components: [container], files } as never);
}

// ---------------------------------------------------------------- /notes

export async function handleNotes(interaction: ChatInputCommandInteraction): Promise<void> {
  const snap = requireSnapshot(interaction);
  if (!snap) return;
  await interaction.deferReply();

  const wanted = interaction.options.getString("periode");
  const periodName = wanted ?? snap.currentPeriodName ?? "Periode";

  // Le snapshot ne contient que la periode courante : pour une autre
  // periode, on interroge PRONOTE a la demande.
  let grades = snap.grades;
  let averages = snap.averages;
  let overall = snap.overallAverage;

  if (wanted && wanted !== snap.currentPeriodName) {
    try {
      const { withSession } = await import("../pronote/client.js");
      const { gradesOverview } = await import("pawnote");
      const { gradeNumber } = await import("../pronote/fetchAll.js");

      const result = await withSession(async (session) => {
        const period = session.instance.periods.find((p) => p.name === wanted);
        if (!period) return null;
        return gradesOverview(session, period);
      });

      if (result) {
        grades = result.grades.map((g) => ({
          id: g.id,
          subject: g.subject?.name ?? "Matiere",
          value: gradeNumber(g.value),
          outOf: gradeNumber(g.outOf),
          coefficient: g.coefficient,
          date: g.date.getTime(),
          comment: (g.comment ?? "").trim(),
          average: gradeNumber(g.average),
          periodName: wanted,
        }));
        averages = result.subjectsAverages.map((s) => ({
          subject: s.subject?.name ?? "Matiere",
          student: gradeNumber(s.student),
          classAverage: gradeNumber(s.class_average),
          outOf: gradeNumber(s.outOf),
        }));
        overall = gradeNumber(result.overallAverage);
      }
    } catch {
      /* on retombe sur les donnees du snapshot */
    }
  }

  const sorted = [...grades].sort((a, b) => b.date - a.date);
  const img = renderGrades({
    periodName,
    overallAverage: overall,
    averages,
    recentGrades: sorted,
    studentName: snap.studentName,
  });
  const file = "notes.png";

  const best = [...averages].filter((a) => a.student !== null).sort((a, b) => b.student! - a.student!)[0];
  const worst = [...averages].filter((a) => a.student !== null).sort((a, b) => a.student! - b.student!)[0];

  await interaction.editReply({
    ...cardMessage(
      card({
        accent: overall !== null && overall >= 10 ? "#34d399" : "#fbbf24",
        title: `📊 Notes — ${periodName}`,
        body: [
          overall !== null
            ? `**Moyenne generale : ${overall.toFixed(2)}**`
            : "_Moyenne generale indisponible._",
          best && worst && best.subject !== worst.subject
            ? `⬆️ Meilleure : **${best.subject}** ${best.student!.toFixed(2)}\n⬇️ Plus faible : **${worst.subject}** ${worst.student!.toFixed(2)}`
            : "",
          `**${grades.length}** note(s) sur la periode.`,
        ].filter(Boolean),
        image: file,
      }),
      [attach(img, file)],
    ),
    flags: V2_FLAGS,
  } as never);
}

// -------------------------------------------------------------- /devoirs

export async function handleDevoirs(interaction: ChatInputCommandInteraction): Promise<void> {
  const snap = requireSnapshot(interaction);
  if (!snap) return;

  const days = interaction.options.getInteger("jours") ?? 7;
  const onlyUndone = interaction.options.getBoolean("non_faits") ?? false;

  const now = Date.now();
  const limit = now + days * 24 * 3600 * 1000;

  let list = snap.assignments
    .filter((h) => h.deadline >= now - 12 * 3600 * 1000 && h.deadline <= limit)
    .sort((a, b) => a.deadline - b.deadline);
  if (onlyUndone) list = list.filter((h) => !h.done);

  if (!list.length) {
    await replyCard(
      interaction,
      cardMessage(
        card({
          accent: "#34d399",
          title: "📚 Aucun devoir",
          body: [`Rien a rendre dans les **${days}** prochains jours.`],
        }),
      ),
    );
    return;
  }

  // Regroupement par date d'echeance
  const groups = new Map<string, typeof list>();
  for (const h of list) {
    const key = new Date(h.deadline).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(h);
  }

  const body = [...groups.entries()].map(
    ([date, items]) =>
      `**${date.replace(/^./, (c) => c.toUpperCase())}**\n${items
        .map(
          (h) =>
            `${h.done ? "✅" : "⬜"} ${colorDot(subjectColor(h.subject, h.backgroundColor))} **${h.subject}** — ${h.description.replace(/\s+/g, " ").slice(0, 150)}`,
        )
        .join("\n")}`,
  );

  await replyCard(
    interaction,
    cardMessage(
      card({
        accent: "#f472b6",
        title: `📚 Devoirs — ${days} prochains jours`,
        body,
        footer: `${list.filter((h) => !h.done).length} non fait(s) sur ${list.length}`,
      }),
    ),
  );
}

// ------------------------------------------------------------------ /sac

export async function handleSac(interaction: ChatInputCommandInteraction): Promise<void> {
  const cfg = getConfig();
  const sub = interaction.options.getSubcommand();

  if (sub === "voir") {
    const entries = Object.entries(cfg.bag).filter(([, v]) => v.length);
    if (!entries.length) {
      await replyCard(
        interaction,
        cardMessage(
          card({
            accent: "#fbbf24",
            title: "🎒 Sac vide",
            body: ["Aucun materiel configure.", "Ajoute-en avec `/sac ajouter matiere:Maths objet:Cahier couleur:#e63946`."],
          }),
        ),
      );
      return;
    }

    const body = entries.map(([key, items]) => {
      const display = prettySubject(key, cfg);
      return `**${display}**\n${items.map((i) => `${colorDot(i.color)} ${i.label} \`${i.color}\``).join("\n")}`;
    });

    await replyCard(
      interaction,
      cardMessage(
        card({
          accent: "#f472b6",
          title: "🎒 Contenu du sac",
          body,
          footer: `${entries.reduce((a, [, v]) => a + v.length, 0)} element(s)`,
        }),
      ),
    );
    return;
  }

  if (sub === "ajouter") {
    const matiere = interaction.options.getString("matiere", true).trim();
    const objet = interaction.options.getString("objet", true).trim();
    const hex = normalizeHex(interaction.options.getString("couleur", true));

    if (!hex) {
      await replyCard(interaction, errorCard("Couleur invalide", "Format attendu : `#rrggbb`, ex `#2a9d8f`."));
      return;
    }

    const key = subjectKey(matiere);
    const existing = cfg.bag[key] ?? [];
    if (existing.some((i) => i.label.toLowerCase() === objet.toLowerCase())) {
      await replyCard(interaction, errorCard("Deja present", `**${objet}** est deja configure pour ${matiere}.`));
      return;
    }

    const bag = { ...cfg.bag, [key]: [...existing, { label: objet, color: hex }] };
    saveConfig({ bag });

    await replyCard(
      interaction,
      cardMessage(
        card({
          accent: hex,
          title: "🎒 Element ajoute",
          body: [`${colorDot(hex)} **${objet}** ajoute a **${matiere}**.`, `${bag[key].length} element(s) pour cette matiere.`],
        }),
      ),
    );
    return;
  }

  if (sub === "retirer") {
    const matiere = interaction.options.getString("matiere", true).trim();
    const objet = interaction.options.getString("objet", true).trim();
    const key = subjectKey(matiere);
    const existing = cfg.bag[key] ?? [];
    const next = existing.filter((i) => i.label.toLowerCase() !== objet.toLowerCase());

    if (next.length === existing.length) {
      await replyCard(interaction, errorCard("Introuvable", `Aucun element **${objet}** pour ${matiere}.`));
      return;
    }

    const bag = { ...cfg.bag };
    if (next.length) bag[key] = next;
    else delete bag[key];
    saveConfig({ bag });

    await replyCard(
      interaction,
      cardMessage(card({ accent: "#34d399", title: "🎒 Element retire", body: [`**${objet}** retire de **${matiere}**.`] })),
    );
    return;
  }

  // preparer
  const snap = requireSnapshot(interaction);
  if (!snap) return;

  const date = parseDay(interaction.options.getString("date"));
  if (!date) {
    await replyCard(interaction, errorCard("Date invalide", "Utilise `AAAA-MM-JJ`, `demain` ou `aujourd'hui`."));
    return;
  }

  await startBagSession(interaction, snap, date);
}

export async function startBagSession(
  interaction: ChatInputCommandInteraction | import("discord.js").ButtonInteraction,
  snap: NonNullable<ReturnType<typeof getSnapshot>>,
  date: Date,
): Promise<void> {
  const lessons = snap.lessons.filter((l) => sameDay(l.start, date));
  const subjects = uniqueSubjects(lessons);

  if (!subjects.length) {
    const payload = cardMessage(
      card({
        accent: "#fbbf24",
        title: "🎒 Rien a preparer",
        body: ["Aucun cours ce jour-la, donc rien a mettre dans le sac."],
      }),
    );
    if (interaction.isButton()) await interaction.reply({ ...payload, flags: V2_FLAGS } as never);
    else await replyCard(interaction, payload);
    return;
  }

  const dateISO = date.toISOString().slice(0, 10);
  bagSessions.set(`${interaction.user.id}:${dateISO}`, {
    subjects,
    checked: new Array(subjects.length).fill(false),
  });

  const payload = buildBagStep(dateISO, subjects, 0, new Array(subjects.length).fill(false));
  if (interaction.isButton()) await interaction.reply({ ...payload, flags: V2_FLAGS } as never);
  else await replyCard(interaction, payload);
}

// ---------------------------------------------------------------- /brief

export async function handleBrief(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  const date = parseDay(interaction.options.getString("jour"));
  if (!date) {
    await replyCard(interaction, errorCard("Date invalide", "Utilise `aujourd'hui`, `demain` ou `AAAA-MM-JJ`."));
    return;
  }

  await interaction.deferReply();
  await pollOnce(client, true);
  const snap = getSnapshot();

  if (!snap) {
    await interaction.editReply({
      ...errorCard("Aucune donnee", "Impossible de recuperer les donnees PRONOTE pour l'instant."),
      flags: V2_FLAGS,
    } as never);
    return;
  }

  await interaction.editReply({ ...buildBrief(snap, date, "manual"), flags: V2_FLAGS } as never);
}

// ------------------------------------------------------------- /messages

export async function handleMessages(interaction: ChatInputCommandInteraction): Promise<void> {
  const snap = requireSnapshot(interaction);
  if (!snap) return;

  const disc = [...snap.discussions].sort((a, b) => b.lastMessage - a.lastMessage).slice(0, 10);
  const news = [...snap.news].sort((a, b) => b.date - a.date).slice(0, 8);

  const body: string[] = [];

  body.push(
    disc.length
      ? `**💬 Discussions**\n${disc
          .map(
            (d) =>
              `${d.unread > 0 ? "🔴" : "⚪"} **${d.subject}** — ${d.sender}\n-# ${new Date(d.lastMessage).toLocaleString("fr-FR")}${d.unread ? ` • ${d.unread} non lu(s)` : ""}`,
          )
          .join("\n")}`
      : "**💬 Discussions** — aucune.",
  );

  body.push(
    news.length
      ? `**📰 Actualites**\n${news
          .map(
            (n) =>
              `${n.read ? "⚪" : "🔵"} **${n.title}**\n-# ${n.author} • ${new Date(n.date).toLocaleDateString("fr-FR")}`,
          )
          .join("\n")}`
      : "**📰 Actualites** — aucune.",
  );

  const unread = snap.discussions.reduce((a, d) => a + d.unread, 0);

  await replyCard(
    interaction,
    cardMessage(
      card({
        accent: unread ? "#fbbf24" : "#f472b6",
        title: "📨 Messagerie PRONOTE",
        body,
        footer: unread ? `${unread} message(s) non lu(s)` : "Tout est lu",
      }),
    ),
  );
}

// ------------------------------------------------------------- /absences

export async function handleAbsences(interaction: ChatInputCommandInteraction): Promise<void> {
  const snap = requireSnapshot(interaction);
  if (!snap) return;

  if (!snap.absences.length) {
    await replyCard(
      interaction,
      cardMessage(card({ accent: "#34d399", title: "✅ Aucune absence", body: ["Aucune absence enregistree sur la periode."] })),
    );
    return;
  }

  const sorted = [...snap.absences].sort((a, b) => b.from - a.from);
  const unjustified = sorted.filter((a) => !a.justified).length;

  await replyCard(
    interaction,
    cardMessage(
      card({
        accent: unjustified ? "#f87171" : "#fbbf24",
        title: "🚷 Absences",
        body: [
          sorted
            .slice(0, 15)
            .map(
              (a) =>
                `${a.justified ? "✅" : "❌"} **${new Date(a.from).toLocaleDateString("fr-FR")}** — ${a.hours}\n-# ${a.reason}`,
            )
            .join("\n"),
        ],
        footer: `${sorted.length} absence(s) • ${unjustified} non justifiee(s)`,
      }),
    ),
  );
}

// --------------------------------------------------------------- /statut

export async function handleStatut(interaction: ChatInputCommandInteraction): Promise<void> {
  const cfg = getConfig();
  const snap = getSnapshot();

  await replyCard(
    interaction,
    cardMessage(
      card({
        accent: isLinked() ? "#34d399" : "#f87171",
        title: "📡 Statut du bot",
        body: [
          [
            `**Compte PRONOTE** — ${isLinked() ? "✅ lie" : "❌ non lie"}`,
            `**Eleve** — ${snap?.studentName ?? "_inconnu_"}${snap?.className ? ` (${snap.className})` : ""}`,
            `**Periode** — ${snap?.currentPeriodName ?? "_inconnue_"}`,
          ].join("\n"),
          [
            `**Dernier appel** — ${snap ? new Date(snap.fetchedAt).toLocaleString("fr-FR") : "_jamais_"}`,
            `**Frequence** — toutes les ${cfg.pollIntervalMinutes} min`,
            `**Brief matin** — ${cfg.morningBriefEnabled ? cfg.morningBriefTime : "desactive"}`,
            `**Brief soir** — ${cfg.eveningBriefEnabled ? cfg.eveningBriefTime : "desactive"}`,
          ].join("\n"),
          snap
            ? `**Donnees en cache**\n${snap.lessons.length} cours • ${snap.assignments.length} devoirs • ${snap.grades.length} notes • ${snap.discussions.length} discussions`
            : "",
        ].filter(Boolean),
        rows: [row(button("sync:now", "Verifier maintenant", ButtonStyle.Primary, "🔄"))],
      }),
    ),
  );
}

// ----------------------------------------------------------------- /sync

export async function handleSync(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  if (!isLinked()) {
    await replyCard(interaction, errorCard("Non connecte", "Lance `/setup` pour relier ton compte PRONOTE."));
    return;
  }

  await interaction.deferReply();
  const syncError = await pollOnce(client, false);
  if (syncError) {
    await interaction.editReply({
      ...errorCard("Synchronisation echouee", `PRONOTE n'a pas repondu correctement : \`${syncError}\``),
      flags: V2_FLAGS,
    } as never);
    return;
  }
  const snap = getSnapshot();

  await interaction.editReply({
    ...cardMessage(
      card({
        accent: "#34d399",
        title: "🔄 Synchronisation terminee",
        body: [
          snap
            ? `Donnees a jour du **${new Date(snap.fetchedAt).toLocaleTimeString("fr-FR")}**.\nTout changement detecte t'a ete envoye en message separe.`
            : "Aucune donnee recuperee.",
        ],
      }),
    ),
    flags: V2_FLAGS,
  } as never);
}

// --------------------------------------------------------- autocomplete

export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const snap = getSnapshot();
  const cfg = getConfig();

  if (focused.name === "matiere") {
    const fromLessons = snap ? [...new Set(snap.lessons.map((l) => l.subject))] : [];
    const fromConfig = Object.keys(cfg.bag).map((k) => prettySubject(k, cfg));
    const all = [...new Set([...fromLessons, ...fromConfig])];
    const q = focused.value.toLowerCase();
    await interaction.respond(
      all
        .filter((s) => s.toLowerCase().includes(q))
        .slice(0, 25)
        .map((s) => ({ name: s, value: s })),
    );
    return;
  }

  if (focused.name === "periode") {
    const periods = snap?.periods ?? [];
    const q = focused.value.toLowerCase();
    await interaction.respond(
      periods
        .filter((p) => p.name.toLowerCase().includes(q))
        .slice(0, 25)
        .map((p) => ({ name: p.name, value: p.name })),
    );
    return;
  }

  await interaction.respond([]);
}

// -------------------------------------------------------------- helpers

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Retrouve un libelle lisible depuis une cle normalisee, en preferant
 * l'orthographe reelle vue dans l'emploi du temps.
 */
function prettySubject(key: string, _cfg: BotConfig): string {
  const snap = getSnapshot();
  const match = snap?.lessons.find((l) => subjectKey(l.subject) === key);
  return match?.subject ?? key.replace(/_/g, " ");
}
