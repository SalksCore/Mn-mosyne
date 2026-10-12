# Héberger Mnémosyne sur Pterodactyl

## 1. Créer le serveur

- **Egg** : Node.js générique (par exemple « Node.js » des eggs parkervcp).
- **Image Docker** : Node.js **20, 22 ou plus récent** (`ghcr.io/parkervcp/yolks:nodejs_22` conseillé).
- **Allocation** : un port libre. C'est lui qui sert au panneau web de Mnémosyne.
- **Variables de démarrage** :
  - `MAIN_FILE` (ou « Main file ») : `index.js`
  - Installation automatique des dépendances : laisse l'egg lancer `npm install` au démarrage (comportement par défaut quand un `package.json` est présent).

## 2. Envoyer les fichiers

Dans le gestionnaire de fichiers du serveur, téléverse `mnemosyne.zip`, puis **Décompresser**. Les fichiers (`index.js`, `package.json`, `src/`, `web/`…) doivent être à la racine du conteneur, pas dans un sous-dossier.

## 3. Adresse publique

Crée un fichier `.env` à la racine :

```
PUBLIC_URL=http://IP_DU_SERVEUR:PORT_ALLOUÉ
```

Avec un nom de domaine et un proxy HTTPS : `PUBLIC_URL=https://mnemo.exemple.fr`.
Sans ce fichier, Mnémosyne utilise l'IP et le port fournis par Pterodactyl.

Le token Discord peut aussi être mis ici (`DISCORD_TOKEN=…`), mais le plus simple est de le coller dans le panneau.

## 4. Démarrer

Clique sur **Start**. La console affiche :

```
  ▸ Panneau Mnémosyne : http://IP:PORT/entrer/…
```

Ouvre ce lien dans les 15 minutes : le panneau te guide pour Discord, PRONOTE, les alertes et les trajets. Plus tard, `/settings` sur Discord te donne un nouveau lien.

## Données

Tout est dans le dossier `data/` du conteneur (configuration, jeton PRONOTE, horaires de transport). Pour une sauvegarde, utilise l'onglet **Backups** de Pterodactyl ou télécharge ce dossier.

## En cas de souci

| Symptôme | Solution |
|---|---|
| `Cannot find package 'tsx'` | Les dépendances ne sont pas installées : lance `npm install` (ou vérifie que l'egg l'exécute au démarrage). |
| `@napi-rs/canvas` introuvable | Image Docker basée sur Alpine : choisis une image Debian (yolks `nodejs_22`). |
| Le lien du panneau ne s'ouvre pas | Vérifie que `PUBLIC_URL` utilise bien le port de l'allocation, et que ce port est ouvert. |
