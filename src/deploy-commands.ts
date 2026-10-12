import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands/definitions.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("DISCORD_TOKEN et CLIENT_ID sont requis dans .env");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(TOKEN);

/**
 * Enregistrement global : necessaire pour que les commandes soient
 * disponibles en message prive, y compris quand le bot est ajoute
 * en tant qu'application utilisateur.
 */
try {
  console.log(`Deploiement de ${commands.length} commandes...`);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ Commandes deployees. La propagation globale peut prendre jusqu'a 1 heure.");
} catch (err) {
  console.error("❌ Echec du deploiement:", err);
  process.exit(1);
}
