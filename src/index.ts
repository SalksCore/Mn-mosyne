import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type ButtonInteraction,
} from "discord.js";
import { getConfig, getSecrets, getSnapshot, saveConfig, saveSecrets } from "./store/db.js";
import { isLinked, onSessionLost } from "./pronote/client.js";
import { notifySessionLost, buildBagStep, buildBrief, notifyChanges, sendToOwner, uniqueSubjects } from "./notify/notifier.js";
import { sameDay } from "./render/util.js";
import { pollOnce, pollStatus, rescheduleAll, sendBrief } from "./scheduler/jobs.js";
import { V2_FLAGS, card, cardMessage, errorCard } from "./ui/components.js";
import {
  bagSessions,
  handleAbsences,
  handleAutocomplete,
  handleBrief,
  handleConfig,
  handleDevoirs,
  handleEdt,
  handleMessages,
  handleNotes,
  handleSac,
  handleSetup,
  handleSettings,
  handleStatut,
  handleSync,
  startBagSession,
} from "./commands/handlers.js";
import { alternativesCard, handleDebug, handleTransport, planFor } from "./commands/transport.js";
import { commands } from "./commands/definitions.js";
import { checkDisruptions, startTransport } from "./transport/scheduler.js";
import { buildPlanCard } from "./transport/notify.js";
import { panelLink, startWebServer } from "./web/server.js";
import { setBridge, type DiscordStatus } from "./web/bridge.js";
import { hasAnySession } from "./web/auth.js";
import type { Change } from "./types.js";

/**
 * Point d'entree. Le panneau web demarre toujours, meme sans token
 * Discord : c'est lui qui permet de tout configurer en ligne. Le bot
 * Discord se connecte des qu'un token est disponible (.env ou panneau).
 */

getConfig(); // applique le fuseau horaire configure avant tout calcul de date

let client: Client | null = null;
let discordError: string | null = null;
let applicationId: string | null = process.env.CLIENT_ID ?? getSecrets().clientId ?? null;
let ownerInfo: { tag: string; avatar: string | null } | null = null;

const tokenFromEnv = (): string | undefined => process.env.DISCORD_TOKEN?.trim() || undefined;
const currentToken = (): string | undefined => tokenFromEnv() ?? getSecrets().discordToken;

const installUrl = (): string | null =>
  applicationId ? `https://discord.com/oauth2/authorize?client_id=${applicationId}&integration_type=1&scope=applications.commands` : null;

/** Verifie un token, recupere l'application et publie les commandes. */
async function prepareApplication(token: string): Promise<{ id: string; ownerId: string | null }> {
  const rest = new REST({ version: "10" }).setToken(token);
  let app: { id: string; owner?: { id: string } | null; team?: { owner_user_id?: string } | null };
  try {
    app = (await rest.get(Routes.currentApplication())) as typeof app;
  } catch {
    throw new Error("Discord refuse ce token. Régénère-le dans le portail développeur (Bot → Reset Token).");
  }
  await rest.put(Routes.applicationCommands(app.id), { body: commands });
  return { id: app.id, ownerId: app.owner?.id ?? app.team?.owner_user_id ?? null };
}

async function startDiscord(token: string): Promise<string> {
  const prepared = await prepareApplication(token);
  applicationId = prepared.id;
  // Sans /setup, la personne qui a cree l'application recoit les alertes.
  if (!getConfig().ownerId && prepared.ownerId) saveConfig({ ownerId: prepared.ownerId });

  if (client) await client.destroy();
  const next = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });
  wire(next);
  await next.login(token);
  client = next;
  discordError = null;
  return next.user?.tag ?? "bot";
}

function wire(c: Client): void {
  c.once(Events.ClientReady, async (ready) => {
    console.log(`[bot] connecte en tant que ${ready.user.tag}`);
    await refreshOwner();
    rescheduleAll(ready);
    startTransport(ready);
    if (isLinked()) {
      // Le tout premier instantane est silencieux ; ensuite, les changements
      // survenus pendant un redemarrage sont bien notifies.
      await pollOnce(ready, getSnapshot() === null);
    } else {
      console.log("[bot] aucun compte PRONOTE lie — termine la configuration dans le panneau");
    }
  });
  c.on(Events.InteractionCreate, (interaction) => void onInteraction(c, interaction));
}

async function refreshOwner(): Promise<void> {
  const id = getConfig().ownerId;
  if (!client || !id) return;
  try {
    const user = await client.users.fetch(id);
    ownerInfo = { tag: user.globalName ?? user.username, avatar: user.displayAvatarURL({ size: 64 }) };
  } catch {
    ownerInfo = null;
  }
}

function requireClient(): Client {
  if (!client?.isReady()) throw new Error("Le bot Discord n'est pas connecté.");
  return client;
}

setBridge({
  preview: false,
  async discord(): Promise<DiscordStatus> {
    return {
      configured: !!currentToken(),
      ready: !!client?.isReady(),
      botTag: client?.user?.tag ?? null,
      botAvatar: client?.user?.displayAvatarURL({ size: 64 }) ?? null,
      installUrl: installUrl(),
      fromEnv: !!tokenFromEnv(),
      ownerTag: ownerInfo?.tag ?? null,
      ownerAvatar: ownerInfo?.avatar ?? null,
      error: discordError,
    };
  },
  async connectDiscord(token: string) {
    if (tokenFromEnv()) throw new Error("Le token est défini dans .env : modifie-le là-bas.");
    const tag = await startDiscord(token);
    saveSecrets({ discordToken: token, clientId: applicationId ?? undefined });
    return { tag };
  },
  configChanged() {
    if (!client?.isReady()) return;
    rescheduleAll(client);
    startTransport(client);
    void refreshOwner();
  },
  transportChanged() {
    if (client?.isReady()) startTransport(client);
  },
  pronoteLinked() {
    const cfg = getConfig();
    if (!cfg.setupComplete) saveConfig({ setupComplete: true });
    if (!client?.isReady()) return;
    const c = client;
    void (async () => {
      await pollOnce(c, true);
      const snap = getSnapshot();
      if (!snap) return;
      if (!getConfig().displayName) {
        const first = snap.studentName.split(" ").pop() ?? "";
        saveConfig({ displayName: first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() });
      }
      await sendToOwner(
        c,
        cardMessage(
          card({
            accent: "#34d399",
            title: `✅ PRONOTE est relié, ${getConfig().displayName || snap.studentName}`,
            body: ["Je surveille désormais ton emploi du temps, tes notes, tes devoirs et ta messagerie.", "Voici ta journée :"],
          }),
        ),
      );
      await sendToOwner(c, buildBrief(snap, new Date(), "manual"));
    })().catch((err) => console.warn("[bot] premiere synchro:", err));
  },
  async syncNow(silent: boolean) {
    return pollOnce(requireClient(), silent);
  },
  syncStatus: () => pollStatus(),
  async sendTestBrief() {
    await sendBrief(requireClient(), new Date(), "manual");
  },
  async sendTestAlert() {
    const c = requireClient();
    const at = Date.now() + 2 * 3600 * 1000;
    const sample: Change[] = [
      {
        kind: "lesson_canceled",
        key: `test:${Date.now()}`,
        targetDate: at,
        subject: "Exemple",
        title: "Cours annulé — Exemple",
        detail: "Ceci est une alerte de test envoyée depuis le panneau.",
      },
    ];
    await notifyChanges(c, sample, true);
  },
  async sendTestTransport() {
    const c = requireClient();
    const plan = await planFor(new Date().getHours() < 12 ? "aller" : "retour");
    if (!plan) throw new Error("Configure d'abord ton réseau et tes arrêts.");
    await sendToOwner(c, buildPlanCard(plan));
  },
});

startWebServer();

const token = currentToken();
if (token) {
  startDiscord(token).catch((err) => {
    discordError = err instanceof Error ? err.message : String(err);
    console.error("[bot] connexion Discord impossible:", discordError);
  });
} else {
  console.log("[bot] aucun token Discord : renseigne-le dans le panneau web");
}

// Premier demarrage, ou personne n'est encore connecte au panneau : on
// affiche un lien d'acces dans la console.
if (!getConfig().setupComplete || !hasAnySession()) {
  console.log(`\n  ▸ Panneau Mnémosyne : ${panelLink("/")}\n    (lien personnel, valable 15 minutes)\n`);
}

// La perte de session PRONOTE remonte jusqu'a une notification Discord.
onSessionLost(async (reason) => {
  if (client?.isReady()) await notifySessionLost(client, reason);
});

async function onInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(client, interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // Le bot fonctionne exclusivement en message prive. Refuser ailleurs
    // evite qu'un emploi du temps ou des notes se retrouvent dans un salon.
    if (interaction.guildId) {
      await interaction.reply({
        ...errorCard(
          "Message prive uniquement",
          "Ce bot ne repond qu'en message prive. Ecris-moi directement pour utiliser tes commandes.",
        ),
        flags: V2_FLAGS,
      } as never);
      return;
    }

    // Le bot est mono-utilisateur : seul le proprietaire configure peut agir.
    const cfg = getConfig();
    if (cfg.ownerId && interaction.user.id !== cfg.ownerId && interaction.commandName !== "setup") {
      await interaction.reply({
        ...errorCard("Acces refuse", "Ce bot est configure pour un seul utilisateur."),
        flags: V2_FLAGS,
      } as never);
      return;
    }

    switch (interaction.commandName) {
      case "setup":
        await handleSetup(interaction, client);
        break;
      case "settings":
        await handleSettings(interaction);
        break;
      case "config":
        await handleConfig(interaction, client);
        break;
      case "edt":
        await handleEdt(interaction);
        break;
      case "notes":
        await handleNotes(interaction);
        break;
      case "devoirs":
        await handleDevoirs(interaction);
        break;
      case "sac":
        await handleSac(interaction);
        break;
      case "brief":
        await handleBrief(interaction, client);
        break;
      case "messages":
        await handleMessages(interaction);
        break;
      case "absences":
        await handleAbsences(interaction);
        break;
      case "statut":
        await handleStatut(interaction);
        break;
      case "sync":
        await handleSync(interaction, client);
        break;
      case "transport":
        await handleTransport(interaction);
        break;
      case "debug":
        await handleDebug(interaction, client);
        break;
    }
  } catch (err) {
    console.error("[interaction] erreur:", err);
    const payload = {
      ...errorCard(
        "Erreur interne",
        `Une erreur est survenue : \`${err instanceof Error ? err.message : "inconnue"}\``,
      ),
      flags: V2_FLAGS,
    };
    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ ...payload, flags: V2_FLAGS } as never);
        } else {
          await interaction.reply(payload as never);
        }
      }
    } catch {
      /* interaction deja expiree */
    }
  }
}

async function handleButton(client: Client, interaction: ButtonInteraction): Promise<void> {
  const [scope, action, ...rest] = interaction.customId.split(":");

  if (scope === "sync" && action === "now") {
    await interaction.deferUpdate();
    await pollOnce(client, false);
    await interaction.followUp({
      ...cardMessage(
        card({ accent: "#34d399", title: "🔄 Verification terminee", body: ["Les donnees ont ete rafraichies."] }),
      ),
      flags: V2_FLAGS,
    } as never);
    return;
  }

  if (scope === "brief" && action === "refresh") {
    const dateISO = rest[0];
    await interaction.deferUpdate();
    await pollOnce(client, true);
    const snap = getSnapshot();
    if (!snap) return;
    const date = new Date(`${dateISO}T00:00:00`);
    await interaction.followUp({
      ...buildBrief(snap, date, "manual"),
      flags: V2_FLAGS,
    } as never);
    return;
  }

  if (scope === "bag") {
    const dateISO = rest[0];
    const key = `${interaction.user.id}:${dateISO}`;

    if (action === "start" || action === "restart") {
      const snap = getSnapshot();
      if (!snap) {
        await interaction.reply({
          ...errorCard("Aucune donnee", "Les donnees PRONOTE ne sont pas encore chargees."),
          flags: V2_FLAGS,
        } as never);
        return;
      }
      if (action === "restart") {
        // On repart d'un etat vierge en editant le message existant.
        const snapSubjects = uniqueSubjects(
          snap.lessons.filter((l) => sameDay(l.start, new Date(`${dateISO}T00:00:00`))),
        );
        const fresh = new Array(snapSubjects.length).fill(false);
        bagSessions.set(key, { subjects: snapSubjects, checked: fresh });
        await interaction.update({
          ...buildBagStep(dateISO, snapSubjects, 0, fresh),
          flags: V2_FLAGS,
          // Sans cette ligne Discord conserve l'ancienne image et la
          // reference attachment:// pointerait sur un fichier perime.
          attachments: [],
        } as never);
        return;
      }
      await startBagSession(interaction, snap, new Date(`${dateISO}T00:00:00`));
      return;
    }

    const session = bagSessions.get(key);
    if (!session) {
      await interaction.reply({
        ...errorCard("Session expiree", "Relance la preparation avec `/sac preparer`."),
        flags: V2_FLAGS,
      } as never);
      return;
    }

    const index = Number(rest[1]);
    if (action === "ok") session.checked[index] = true;
    // "skip" laisse la case a false

    const next = index + 1;

    // Carte et image sont regenerees ensemble : `attachments: []` purge
    // l'ancienne piece jointe, `files` fournit la nouvelle. Les deux
    // restent ainsi toujours coherents.
    await interaction.update({
      ...buildBagStep(dateISO, session.subjects, next, session.checked),
      flags: V2_FLAGS,
      attachments: [],
    } as never);

    if (next >= session.subjects.length) bagSessions.delete(key);
    return;
  }

  if (scope === "transport") {
    await interaction.deferReply();
    try {
      if (action === "disruptions") {
        const n = await checkDisruptions(client, true);
        if (!n) {
          await interaction.editReply({
            ...cardMessage(card({ accent: "#34d399", title: "✅ Rien à signaler", body: ["Aucune perturbation publiée sur tes lignes."] })),
            flags: V2_FLAGS,
          } as never);
        } else {
          await interaction.deleteReply();
        }
        return;
      }
      const sens = rest[0] === "retour" ? "retour" : "aller";
      const payload = action === "alt" ? await alternativesCard(sens) : await planFor(sens).then((p) => (p ? buildPlanCard(p) : null));
      await interaction.editReply({
        ...(payload ?? errorCard("Trajets non configurés", "Configure ton réseau et tes arrêts dans le panneau (`/transport config`).")),
        flags: V2_FLAGS,
        attachments: [],
      } as never);
    } catch (err) {
      await interaction.editReply({
        ...errorCard("Réseau injoignable", err instanceof Error ? err.message : String(err)),
        flags: V2_FLAGS,
      } as never);
    }
    return;
  }
}

process.on("unhandledRejection", (err) => {
  console.error("[process] rejet non gere:", err);
});


