/**
 * Pont entre le panneau web et le bot Discord.
 *
 * Le serveur web ne depend pas de discord.js : il appelle ces fonctions,
 * que `index.ts` branche sur le vrai client. En mode apercu (`npm run web`),
 * c'est une implementation factice qui repond a la place du bot.
 */

export interface DiscordStatus {
  /** Un token est disponible (.env ou saisi depuis le web). */
  configured: boolean;
  /** Le client est connecte a la passerelle Discord. */
  ready: boolean;
  botTag: string | null;
  botAvatar: string | null;
  /** Lien d'installation sur un compte utilisateur (User Install). */
  installUrl: string | null;
  /** Le token vient de .env : il n'est pas modifiable depuis le web. */
  fromEnv: boolean;
  ownerTag: string | null;
  ownerAvatar: string | null;
  /** Derniere erreur de connexion a Discord. */
  error: string | null;
}

export interface BotBridge {
  preview: boolean;
  discord(): Promise<DiscordStatus>;
  /** Valide un token, l'enregistre, publie les commandes et connecte le bot. */
  connectDiscord(token: string): Promise<{ tag: string }>;
  /** A appeler apres toute modification de configuration. */
  configChanged(): void;
  /** Les reglages de trajet ont change : replanifier la journee. */
  transportChanged(): void;
  /** Un compte PRONOTE vient d'etre lie : premiere synchronisation silencieuse. */
  pronoteLinked(): void;
  /** Synchronisation PRONOTE immediate ; renvoie un message d'erreur ou null. */
  syncNow(silent: boolean): Promise<string | null>;
  syncStatus(): { running: boolean; lastError: string | null; lastSuccess: number | null };
  /** Envoie le brief du jour en MP, pour verifier que tout fonctionne. */
  sendTestBrief(): Promise<void>;
  /** Envoie une notification de demonstration en MP. */
  sendTestAlert(): Promise<void>;
  /** Envoie la fiche de trajet du moment en MP. */
  sendTestTransport(): Promise<void>;
}

let current: BotBridge | null = null;

export function setBridge(bridge: BotBridge): void {
  current = bridge;
}

export function bridge(): BotBridge {
  if (!current) throw new Error("Pont bot/web non initialise");
  return current;
}
