import type { ChatInputCommandInteraction, Client } from "discord.js";
import { getConfig, getSnapshot } from "../store/db.js";
import { currentIndex, alternatives as findAlternatives } from "../transport/engine.js";
import { planEvening, planMorning, planNow, type Plan } from "../transport/plan.js";
import { buildAlternativesCard, buildPlanCard } from "../transport/notify.js";
import { checkDisruptions, planDay } from "../transport/scheduler.js";
import { card, cardMessage, errorCard, linkButton, row, V2_FLAGS } from "../ui/components.js";
import { pollOnce } from "../scheduler/jobs.js";
import { buildBrief } from "../notify/notifier.js";
import { panelLink } from "../web/server.js";
import { suspensionRemaining } from "../pronote/client.js";

const hm = (d: Date): string => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

async function edit(interaction: ChatInputCommandInteraction, payload: ReturnType<typeof cardMessage>): Promise<void> {
  await interaction.editReply({ ...payload, flags: V2_FLAGS } as never);
}

function notConfigured(): ReturnType<typeof cardMessage> {
  return cardMessage(
    card({
      accent: "#f472b6",
      title: "🚌 Trajets non configurés",
      body: [
        "Choisis ton réseau, tes arrêts et tes temps de marche depuis le panneau web : tous les réseaux publiés sur transport.data.gouv.fr sont disponibles.",
      ],
      rows: [row(linkButton(panelLink("/transport"), "Configurer mes trajets", "🛠️"))],
    }),
  );
}

/** Le sens par defaut se deduit de l'heure : avant midi, on va en cours. */
function direction(value: string | null): "aller" | "retour" {
  if (value === "aller" || value === "retour") return value;
  return new Date().getHours() < 12 ? "aller" : "retour";
}

export async function planFor(sens: "aller" | "retour"): Promise<Plan | null> {
  return planNow(sens);
}

export async function alternativesCard(sens: "aller" | "retour"): Promise<ReturnType<typeof cardMessage> | null> {
  const ctx = await currentIndex();
  if (!ctx) return null;
  const t = getConfig().transport;
  const plan = await planNow(sens);
  if (!plan) return null;
  const deadline = plan.kind === "morning" ? plan.deadline : null;
  const walkFrom = sens === "aller" ? t.walkToHomeStop : t.walkToSchoolStop;
  const walkTo = sens === "aller" ? t.walkFromSchoolStop : t.walkFromHomeStop;
  const alts = await findAlternatives(
    ctx.network,
    ctx.index,
    { stop: plan.fromStop, walk: walkFrom },
    { stop: plan.toStop, walk: walkTo },
    new Date(),
    deadline ?? new Date(Date.now() + 2 * 3600 * 1000),
  );
  return buildAlternativesCard(alts.slice(0, 5), "Recherche sur toutes les lignes autour de tes arrêts.", deadline, ctx.network);
}

export async function handleTransport(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const t = getConfig().transport;

  if (sub === "config" || !t.enabled || !t.homeStopId || !t.schoolStopId) {
    await interaction.reply({ ...notConfigured(), flags: V2_FLAGS } as never);
    return;
  }

  await interaction.deferReply();
  const sens = direction(interaction.options.getString("sens"));

  try {
    if (sub === "maintenant") {
      const plan = await planFor(sens);
      await edit(interaction, plan ? buildPlanCard(plan) : notConfigured());
      return;
    }

    if (sub === "planb") {
      await edit(interaction, (await alternativesCard(sens)) ?? notConfigured());
      return;
    }

    if (sub === "info") {
      const n = await checkDisruptions(interaction.client, true);
      if (!n) {
        await edit(
          interaction,
          cardMessage(card({ accent: "#34d399", title: "✅ Rien à signaler", body: ["Aucune perturbation publiée sur tes lignes."] })),
        );
      } else {
        await edit(interaction, cardMessage(card({ accent: "#fbbf24", title: "⚠️ Info trafic", body: [`${n} message(s) envoyé(s) ci-dessus.`] })));
      }
    }
  } catch (err) {
    await edit(interaction, errorCard("Réseau injoignable", err instanceof Error ? err.message : String(err)));
  }
}

// ------------------------------------------------------------------ /debug

function parseDay(input: string): Date | null {
  const v = input.trim().toLowerCase();
  const d = new Date();
  if (["aujourd'hui", "aujourdhui", "auj", "today"].includes(v)) return d;
  if (["demain", "tomorrow"].includes(v)) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (["hier", "yesterday"].includes(v)) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export async function handleDebug(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply();

  switch (sub) {
    case "brief": {
      const date = parseDay(interaction.options.getString("jour") ?? "aujourd'hui");
      const moment = (interaction.options.getString("moment") ?? "manual") as "morning" | "evening" | "manual";
      const snap = getSnapshot();
      if (!date || !snap) {
        await edit(interaction, errorCard("Impossible", !date ? "Date invalide." : "Aucune donnée : lance `/sync`."));
        return;
      }
      await interaction.followUp({ ...buildBrief(snap, date, moment), flags: V2_FLAGS } as never);
      await edit(interaction, cardMessage(card({ accent: "#34d399", title: "🧪 Brief simulé", body: [`${date.toLocaleDateString("fr-FR")} · ${moment}`] })));
      return;
    }

    case "transport": {
      const date = parseDay(interaction.options.getString("jour") ?? "aujourd'hui") ?? new Date();
      const sens = interaction.options.getString("sens", true);
      const plan = sens === "aller" ? await planMorning(date) : await planEvening(date);
      if (!plan) {
        await edit(interaction, notConfigured());
        return;
      }
      const lines =
        plan.kind === "morning"
          ? [
              `**Premier cours** — ${plan.firstLesson ? `${plan.firstLesson.subject} à ${hm(new Date(plan.firstLesson.start))}` : "aucun"}`,
              `**Heure limite** — ${plan.deadline ? hm(plan.deadline) : "—"} · **préavis** ${plan.notifyAt ? hm(plan.notifyAt) : "—"}`,
            ]
          : [`**Sortie** — ${plan.releaseAt ? hm(plan.releaseAt) : "—"}`];
      lines.push(
        plan.options
          .map((o) => `${o === plan.best ? "➡️" : o.viable ? "▫️" : "✖️"} ${o.journey.line.short} ${hm(o.journey.departure)} → ${hm(o.journey.arrival)} · partir ${hm(o.leaveAt)}${o.issue ? ` · ${o.issue}` : ""}`)
          .join("\n") || "Aucun passage.",
      );
      await edit(interaction, cardMessage(card({ accent: "#f472b6", title: `🧪 Calcul ${sens}`, body: lines })));
      return;
    }

    case "replanifier": {
      await planDay(client);
      await edit(interaction, cardMessage(card({ accent: "#34d399", title: "🔁 Journée replanifiée", body: ["Les alertes de trajet ont été recalculées."] })));
      return;
    }

    case "pronote": {
      const silent = interaction.options.getString("action") === "sync_silencieux";
      const error = await pollOnce(client, silent);
      await edit(
        interaction,
        error ? errorCard("Synchronisation en échec", error) : cardMessage(card({ accent: "#34d399", title: "✅ Synchronisé", body: [silent ? "Sans notification." : "Notifications envoyées si besoin."] })),
      );
      return;
    }

    default: {
      const snap = getSnapshot();
      const ctx = await currentIndex().catch(() => null);
      const pause = suspensionRemaining();
      await edit(
        interaction,
        cardMessage(
          card({
            accent: "#f472b6",
            title: "🩺 État",
            body: [
              `**PRONOTE** — ${snap ? `dernière synchro ${new Date(snap.fetchedAt).toLocaleString("fr-FR")}` : "jamais synchronisé"}${pause ? ` · en pause ${Math.ceil(pause / 60000)} min` : ""}`,
              `**Transport** — ${ctx ? `${ctx.network.name}, ${ctx.index.stops.length} arrêts, ${Object.keys(ctx.index.lines).length} lignes` : "non configuré"}`,
            ],
          }),
        ),
      );
    }
  }
}
