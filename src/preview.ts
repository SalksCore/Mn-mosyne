import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Mode apercu : le panneau web tourne seul, avec des donnees fictives et un
 * reseau de transport de demonstration. Aucun token Discord, aucun compte
 * PRONOTE, aucune requete reseau. Pratique pour contribuer a l'interface.
 *
 *   npm run preview           panneau deja configure
 *   npm run preview -- --vide parcours de premiere configuration
 */

const fresh = process.argv.includes("--vide");
process.env.MNEMO_DEMO = "1";
process.env.DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "mnemosyne-apercu-"));

const { getConfig, saveConfig, saveCredentials, saveSnapshot } = await import("./store/db.js");
const { setBridge } = await import("./web/bridge.js");
const { panelLink, startWebServer } = await import("./web/server.js");
const { demoSnapshot } = await import("./web/demo.js");

// Applique le fuseau configure avant de fabriquer les dates de demonstration.
getConfig();
let discordReady = !fresh;

if (!fresh) {
  saveSnapshot(demoSnapshot());
  saveCredentials({
    url: "https://demo.index-education.net/pronote",
    kind: 6,
    username: "lea.demo",
    token: "apercu",
    deviceUUID: "00000000-0000-0000-0000-000000000000",
    lastRefresh: Date.now(),
  });
  saveConfig({ ownerId: "0", displayName: "Léa", setupComplete: true });

  // Reseau de demonstration, arrets « Mairie » -> « Lycée Victor-Hugo ».
  const { networkById } = await import("./transport/catalog.js");
  const { loadIndex } = await import("./transport/gtfs/feed.js");
  const { searchStops } = await import("./transport/engine.js");
  const network = (await networkById("demo-aster"))!;
  const index = await loadIndex(network);
  saveConfig({
    transport: {
      ...getConfig().transport,
      enabled: true,
      networkId: network.id,
      networkName: network.name,
      networkLogo: network.logo,
      homeStopId: searchStops(index, "Mairie")[0].id,
      schoolStopId: searchStops(index, "Lycée")[0].id,
    },
  });
}

setBridge({
  preview: true,
  async discord() {
    return {
      configured: discordReady,
      ready: discordReady,
      botTag: discordReady ? "Mnémosyne#0420" : null,
      botAvatar: null,
      installUrl: discordReady ? "https://discord.com/oauth2/authorize?client_id=0&integration_type=1&scope=applications.commands" : null,
      fromEnv: false,
      ownerTag: discordReady ? "Léa" : null,
      ownerAvatar: null,
      error: null,
    };
  },
  async connectDiscord() {
    discordReady = true;
    return { tag: "Mnémosyne#0420" };
  },
  configChanged() {},
  transportChanged() {},
  pronoteLinked() {},
  async syncNow() {
    return null;
  },
  syncStatus: () => ({ running: false, lastError: null, lastSuccess: Date.now() }),
  async sendTestBrief() {},
  async sendTestAlert() {},
  async sendTestTransport() {},
});

startWebServer();
console.log(`\n  ▸ Aperçu du panneau : ${panelLink("/")}\n    (données fictives dans ${process.env.DATA_DIR})\n`);
