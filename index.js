// Point d'entree pour les hebergeurs qui lancent `node index.js`
// (Pterodactyl, Pebblehost, etc.). Le code source est en TypeScript :
// tsx le compile a la volee, sans etape de build.
import { register } from "tsx/esm/api";

register();
await import("./src/index.ts");
