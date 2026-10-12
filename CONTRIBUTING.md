# Contribuer à Mnémosyne

Merci de ton intérêt ! Quelques repères pour que ta contribution arrive vite.

## Lancer le projet

```bash
npm install
npm run preview        # panneau avec données fictives, sans Discord ni PRONOTE
npm start              # le vrai bot (le panneau te guide pour le reste)
```

## Avant d'ouvrir une pull request

```bash
npm run typecheck
npm test
```

- Le code et les commentaires sont en français, sans dépendance inutile.
- Le panneau (`web/`) est en HTML, CSS et JavaScript sans étape de build : garde-le ainsi.
- Les images générées suivent la direction artistique du projet (`src/render/theme.ts`, `src/render/util.ts`). Après une modification, `npm run samples` régénère `docs/images`.
- Aucun réseau de transport ne doit être codé en dur : tout passe par GTFS / GTFS-RT.
- Ne committe jamais le dossier `data/` ni ton fichier `.env`.

## Signaler un problème PRONOTE

Indique la version de PRONOTE (visible dans le panneau, section PRONOTE), la méthode de connexion (identifiants, QR code, ENT) et le message d'erreur. Ne partage jamais tes identifiants, ton jeton ni l'adresse de ton établissement en public.
