import { ButtonStyle, type MessageCreateOptions } from "discord.js";
import { getConfig } from "../store/db.js";
import { renderAlternatives, renderDisruptions, renderTransport } from "../render/transport.js";
import { attach, button, card, cardMessage, row } from "../ui/components.js";
import type { EveningPlan, MorningPlan, Plan, PlanOption } from "./plan.js";
import type { Disruption, Journey, Network } from "./types.js";

const hm = (d: Date): string => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const PINK = "#f472b6";
const RED = "#f87171";
const AMBER = "#fbbf24";

function lineLabel(j: Journey): string {
  return `${j.mode} **${j.line.short}**`;
}

function source(plan: { network: Network; options: PlanOption[] }): string {
  const realtime = plan.options.some((o) => o.journey.realtime);
  return `${plan.network.name} · ${realtime ? "temps réel" : "horaires théoriques"} · ${hm(new Date())}`;
}

const buttons = (sens: "aller" | "retour") =>
  row(
    button(`transport:refresh:${sens}`, "Actualiser", ButtonStyle.Primary, "🔄"),
    button(`transport:alt:${sens}`, "Plan B", ButtonStyle.Secondary, "🔀"),
    button("transport:disruptions", "Info trafic", ButtonStyle.Secondary, "⚠️"),
  );

/** Preavis du matin (urgent = false) ou « c'est l'heure » (urgent = true). */
export function buildMorningCard(plan: MorningPlan, urgent: boolean): MessageCreateOptions {
  const name = getConfig().displayName || "toi";
  const best = plan.best;
  const title = best ? (urgent ? "C'est l'heure de partir" : `Pars à ${hm(best.leaveAt)}`) : "Aucun passage à l'heure";
  const file = "trajet-matin.png";
  const img = renderTransport(plan, title);

  const body: string[] = [];
  if (best) {
    const j = best.journey;
    body.push(
      urgent
        ? `${name}, file ! Ton ${lineLabel(j)} passe à **${hm(j.departure)}** à **${j.fromStop.name}**.`
        : `${name}, quitte la maison à **${hm(best.leaveAt)}** pour le ${lineLabel(j)} de **${hm(j.departure)}**.`,
      [
        `🚶 ${j.walkTo} min jusqu'à **${j.fromStop.name}**`,
        `🚌 descente à **${j.toStop.name}** à ${hm(j.arrival)}`,
        `🏫 arrivée **${hm(best.arriveAt)}**${best.marginMinutes !== null ? ` · ${best.marginMinutes} min avant l'heure limite` : ""}`,
      ].join("\n"),
    );
    const earlier = plan.options.filter((o) => o.viable && o !== best).slice(-2);
    if (earlier.length) body.push(`-# Plus tôt si tu veux de la marge : ${earlier.map((o) => `${o.journey.line.short} ${hm(o.journey.departure)}`).join(" · ")}`);
  } else {
    body.push("⚠️ Aucun passage direct n'arrive avant ton premier cours. Le **Plan B** cherche les autres lignes autour de chez toi.");
  }

  return cardMessage(
    card({ accent: urgent ? RED : PINK, title: `${urgent ? "🚨" : "🚌"} ${title}`, body, image: file, rows: [buttons("aller")], footer: source(plan) }),
    [attach(img, file)],
  );
}

/** Fiche de retour, envoyee a la fin des cours. */
export function buildEveningCard(plan: EveningPlan): MessageCreateOptions {
  const best = plan.best;
  const file = "trajet-retour.png";
  const title = best ? `Retour : ${best.journey.line.short} à ${hm(best.journey.departure)}` : "Retour à la maison";
  const img = renderTransport(plan, title);
  const body: string[] = [];
  if (best) {
    body.push(
      `Prochain départ utile : ${lineLabel(best.journey)} à **${hm(best.journey.departure)}** depuis **${plan.fromStop.name}**.`,
      `🚶 quitte l'établissement à **${hm(best.leaveAt)}** · 🏠 à la maison vers **${hm(best.arriveAt)}**`,
    );
    const next = plan.options.filter((o) => o.viable && o !== best).slice(0, 3);
    if (next.length) body.push(`-# Suivants : ${next.map((o) => `${o.journey.line.short} ${hm(o.journey.departure)}`).join(" · ")}`);
  } else {
    body.push("Aucun passage direct trouvé pour le moment.");
  }
  return cardMessage(
    card({ accent: PINK, title: `🏠 ${title}`, body, image: file, rows: [buttons("retour")], footer: source(plan) }),
    [attach(img, file)],
  );
}

/** Carte a la demande (/transport maintenant). */
export function buildPlanCard(plan: Plan): MessageCreateOptions {
  return plan.kind === "morning" ? buildMorningCard(plan, false) : buildEveningCard(plan);
}

/** Alerte sur la course retenue : supprimee, en retard ou en avance. */
export function buildIncidentCard(chosen: PlanOption, replacement: PlanOption | null, kind: "cancel" | "late" | "early"): MessageCreateOptions {
  const j = chosen.journey;
  const body: string[] = [];
  if (kind === "cancel") {
    body.push(`Le ${lineLabel(j)} de **${hm(j.aimedDeparture)}** est **supprimé**.`);
  } else {
    const d = j.delayMinutes ?? 0;
    body.push(
      kind === "late"
        ? `Ton ${lineLabel(j)} a **${d} min de retard** : il passera à **${hm(j.departure)}** au lieu de ${hm(j.aimedDeparture)}.`
        : `Ton ${lineLabel(j)} a **${-d} min d'avance** : il passera dès **${hm(j.departure)}**. Pars à **${hm(chosen.leaveAt)}**.`,
    );
  }
  if (replacement && replacement !== chosen) {
    body.push(
      `**Solution** — ${lineLabel(replacement.journey)} à **${hm(replacement.journey.departure)}** : quitte la maison à **${hm(replacement.leaveAt)}**${
        replacement.marginMinutes !== null ? ` (${replacement.marginMinutes} min de marge)` : ""
      }.`,
    );
  } else if (kind === "cancel") {
    body.push("Je cherche un plan B sur les autres lignes…");
  }
  return cardMessage(
    card({
      accent: kind === "cancel" ? RED : AMBER,
      title: kind === "cancel" ? "🔴 Bus supprimé" : kind === "late" ? "🟠 Bus en retard" : "⏩ Bus en avance",
      body,
      rows: [buttons("aller")],
      footer: "Alerte temps réel",
    }),
  );
}

export function buildAlternativesCard(alts: Journey[], reason: string, deadline: Date | null, network?: Network): MessageCreateOptions {
  const name = getConfig().displayName || "toi";
  const file = "plan-b.png";
  const img = renderAlternatives(alts, reason, deadline, network?.name ?? getConfig().transport.networkName);
  const body = [`⚠️ ${reason}`];
  const best = alts[0];
  if (best) {
    const leave = new Date(best.departure.getTime() - best.walkTo * 60000);
    const arrive = new Date(best.arrival.getTime() + best.walkFrom * 60000);
    body.push(
      `**Le plus rapide — ${lineLabel(best)}**\n` +
        `🚶 ${best.walkTo} min jusqu'à **${best.fromStop.name}** · départ **${hm(best.departure)}**\n` +
        `🏁 descente **${best.toStop.name}**, arrivée **${hm(arrive)}**\n` +
        `➡️ **Pars à ${hm(leave)}**`,
    );
  } else {
    body.push("Aucune liaison directe dans un rayon accessible à pied. Prévois un autre moyen (vélo, voiture, prévenir la vie scolaire).");
  }
  return cardMessage(
    card({ accent: best ? AMBER : RED, title: `🔀 ${name}, ton plan B`, body, image: file, footer: "Liaisons directes, toutes lignes, arrêts à moins de 900 m" }),
    [attach(img, file)],
  );
}

export function buildDisruptionsCard(items: Disruption[], network: Network): MessageCreateOptions {
  const file = "info-trafic.png";
  const img = renderDisruptions(items, network.name);
  return cardMessage(
    card({
      accent: AMBER,
      title: "⚠️ Info trafic sur tes lignes",
      body: [items.slice(0, 4).map((d) => `• ${d.lines.length ? `**${d.lines.join(", ")}** — ` : ""}${d.summary}`).join("\n")],
      image: file,
      footer: `${network.name} · GTFS-RT`,
    }),
    [attach(img, file)],
  );
}
