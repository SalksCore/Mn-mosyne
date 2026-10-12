import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer le bot de A a Z : compte PRONOTE, prenom, horaires")
    ,

  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Ouvrir le panneau en ligne : tous les reglages au meme endroit"),
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Consulter et modifier la configuration du bot")
    .addSubcommand((s) => s.setName("voir").setDescription("Afficher toute la configuration"))
    .addSubcommand((s) => s.setName("web").setDescription("Ouvrir le panneau de configuration en ligne"))
    .addSubcommand((s) =>
      s.setName("connexion").setDescription("Relier ou reconnecter le compte PRONOTE"),
    )
    .addSubcommand((s) =>
      s
        .setName("nom")
        .setDescription("Changer le prenom utilise par le bot")
        .addStringOption((o) =>
          o.setName("prenom").setDescription("Ton prenom").setRequired(true).setMaxLength(40),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("horaires")
        .setDescription("Regler les heures des briefs matin et soir")
        .addStringOption((o) =>
          o.setName("matin").setDescription("Heure du brief matin, ex 06:00").setRequired(false),
        )
        .addStringOption((o) =>
          o.setName("soir").setDescription("Heure du brief soir, ex 20:00").setRequired(false),
        )
        .addBooleanOption((o) =>
          o.setName("matin_actif").setDescription("Activer le brief du matin").setRequired(false),
        )
        .addBooleanOption((o) =>
          o.setName("soir_actif").setDescription("Activer le brief du soir").setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName("fuseau")
            .setDescription("Fuseau horaire IANA, ex Europe/Paris")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("intervalle")
        .setDescription("Frequence de verification PRONOTE")
        .addIntegerOption((o) =>
          o
            .setName("minutes")
            .setDescription("Minutes entre deux appels (defaut 6)")
            .setMinValue(2)
            .setMaxValue(120)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("notifications")
        .setDescription("Activer ou desactiver un type de notification")
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Categorie de notification")
            .setRequired(true)
            .addChoices(
              { name: "Emploi du temps", value: "timetable" },
              { name: "Notes", value: "grades" },
              { name: "Devoirs", value: "homework" },
              { name: "Messagerie", value: "discussions" },
              { name: "Actualites", value: "news" },
              { name: "Absences", value: "attendance" },
              { name: "Evaluations", value: "evaluations" },
              { name: "Expiration de session", value: "sessionExpiry" },
              { name: "Trajets", value: "transport" },
            ),
        )
        .addBooleanOption((o) =>
          o.setName("actif").setDescription("Activer ou non").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("couleur")
        .setDescription("Definir la couleur d'une matiere dans l'emploi du temps")
        .addStringOption((o) =>
          o.setName("matiere").setDescription("Nom de la matiere").setRequired(true).setAutocomplete(true),
        )
        .addStringOption((o) =>
          o.setName("hex").setDescription("Couleur hexadecimale, ex #e63946").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("accents")
        .setDescription("Couleurs des notifications imminentes et futures")
        .addStringOption((o) =>
          o.setName("imminent").setDescription("Hex pour aujourd'hui/demain").setRequired(false),
        )
        .addStringOption((o) =>
          o.setName("futur").setDescription("Hex pour les dates plus lointaines").setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("theme")
        .setDescription("Fond clair ou sombre des images generees")
        .addStringOption((o) =>
          o
            .setName("cible")
            .setDescription("Quelles images")
            .setRequired(true)
            .addChoices(
              { name: "Toutes", value: "all" },
              { name: "Emploi du temps", value: "timetable" },
              { name: "Notes", value: "grades" },
              { name: "Notifications", value: "notifications" },
              { name: "Sac", value: "bag" },
            ),
        )
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("Clair ou sombre")
            .setRequired(true)
            .addChoices({ name: "Clair", value: "clair" }, { name: "Sombre", value: "sombre" }),
        ),
    )
    .addSubcommand((s) =>
      s.setName("reset").setDescription("Effacer toute la configuration et la connexion"),
    ),

  new SlashCommandBuilder()
    .setName("edt")
    .setDescription("Consulter l'emploi du temps")
    .addSubcommand((s) =>
      s
        .setName("jour")
        .setDescription("Emploi du temps d'un jour")
        .addStringOption((o) =>
          o
            .setName("date")
            .setDescription("Date AAAA-MM-JJ, ou 'demain'. Defaut : aujourd'hui")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("semaine")
        .setDescription("Emploi du temps de la semaine, jour par jour")
        .addIntegerOption((o) =>
          o
            .setName("decalage")
            .setDescription("0 = cette semaine, 1 = la suivante")
            .setMinValue(0)
            .setMaxValue(4)
            .setRequired(false),
        ),
    ),

  new SlashCommandBuilder()
    .setName("notes")
    .setDescription("Consulter les notes et moyennes")
    .addStringOption((o) =>
      o
        .setName("periode")
        .setDescription("Trimestre ou semestre. Defaut : periode en cours")
        .setRequired(false)
        .setAutocomplete(true),
    ),

  new SlashCommandBuilder()
    .setName("devoirs")
    .setDescription("Lister les devoirs a faire")
    .addIntegerOption((o) =>
      o
        .setName("jours")
        .setDescription("Horizon en jours (defaut 7)")
        .setMinValue(1)
        .setMaxValue(21)
        .setRequired(false),
    )
    .addBooleanOption((o) =>
      o.setName("non_faits").setDescription("Uniquement les devoirs non faits").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("sac")
    .setDescription("Gerer le contenu de ton sac par matiere")
    .addSubcommand((s) => s.setName("voir").setDescription("Voir tout le contenu configure"))
    .addSubcommand((s) =>
      s
        .setName("ajouter")
        .setDescription("Ajouter un element pour une matiere")
        .addStringOption((o) =>
          o.setName("matiere").setDescription("Matiere").setRequired(true).setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName("objet")
            .setDescription("Cahier, classeur, trieur, pochette, manuel...")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("couleur").setDescription("Couleur hexadecimale, ex #2a9d8f").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("retirer")
        .setDescription("Retirer un element d'une matiere")
        .addStringOption((o) =>
          o.setName("matiere").setDescription("Matiere").setRequired(true).setAutocomplete(true),
        )
        .addStringOption((o) => o.setName("objet").setDescription("Nom de l'element").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("preparer")
        .setDescription("Preparer le sac etape par etape")
        .addStringOption((o) =>
          o.setName("date").setDescription("Date AAAA-MM-JJ ou 'demain'").setRequired(false),
        ),
    ),

  new SlashCommandBuilder()
    .setName("brief")
    .setDescription("Recevoir immediatement le recapitulatif journalier")
    .addStringOption((o) =>
      o
        .setName("jour")
        .setDescription("aujourd'hui, demain, ou une date AAAA-MM-JJ")
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("messages")
    .setDescription("Voir les discussions et actualites PRONOTE")
    ,

  new SlashCommandBuilder()
    .setName("absences")
    .setDescription("Voir les absences et retards enregistres")
    ,

  new SlashCommandBuilder()
    .setName("statut")
    .setDescription("Etat du bot : connexion, dernier appel, prochain brief")
    ,

  new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Forcer une verification PRONOTE immediate")
    ,
  new SlashCommandBuilder()
    .setName("transport")
    .setDescription("Tes trajets : prochain depart, plan B, info trafic")
    .addSubcommand((s) =>
      s
        .setName("maintenant")
        .setDescription("Le prochain depart utile pour ton trajet")
        .addStringOption((o) =>
          o
            .setName("sens")
            .setDescription("Direction. Par defaut, deduite de l'heure")
            .addChoices(
              { name: "Vers l'etablissement", value: "aller" },
              { name: "Vers la maison", value: "retour" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("planb")
        .setDescription("Autres lignes autour de tes arrets, si tu as rate le tien")
        .addStringOption((o) =>
          o
            .setName("sens")
            .setDescription("Direction. Par defaut, deduite de l'heure")
            .addChoices(
              { name: "Vers l'etablissement", value: "aller" },
              { name: "Vers la maison", value: "retour" },
            ),
        ),
    )
    .addSubcommand((s) => s.setName("info").setDescription("Perturbations en cours sur tes lignes"))
    .addSubcommand((s) => s.setName("config").setDescription("Reseau, arrets et marges : ouvre le panneau web")),

  new SlashCommandBuilder()
    .setName("debug")
    .setDescription("Outils de test : simuler les briefs et les trajets")
    .addSubcommand((s) =>
      s
        .setName("brief")
        .setDescription("Simuler un brief pour un jour donne")
        .addStringOption((o) => o.setName("jour").setDescription("aujourd'hui, demain, hier ou AAAA-MM-JJ"))
        .addStringOption((o) =>
          o
            .setName("moment")
            .setDescription("Variante du brief")
            .addChoices(
              { name: "Matin", value: "morning" },
              { name: "Soir", value: "evening" },
              { name: "Manuel", value: "manual" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("transport")
        .setDescription("Voir le detail du calcul de trajet")
        .addStringOption((o) =>
          o
            .setName("sens")
            .setDescription("Direction")
            .setRequired(true)
            .addChoices({ name: "Aller (matin)", value: "aller" }, { name: "Retour (soir)", value: "retour" }),
        )
        .addStringOption((o) => o.setName("jour").setDescription("aujourd'hui, demain ou AAAA-MM-JJ")),
    )
    .addSubcommand((s) => s.setName("replanifier").setDescription("Recalculer les alertes de trajet de la journee"))
    .addSubcommand((s) =>
      s
        .setName("pronote")
        .setDescription("Forcer un appel PRONOTE")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Type d'appel")
            .setRequired(true)
            .addChoices({ name: "Sync avec notifications", value: "sync" }, { name: "Sync silencieux", value: "sync_silencieux" }),
        ),
    )
    .addSubcommand((s) => s.setName("etat").setDescription("Etat de PRONOTE et du reseau de transport")),
].map((c) => {
  const json = c.toJSON() as unknown as Record<string, unknown>;
  // Installation sur le compte utilisateur uniquement (integration_types: [1])
  // et utilisable partout, ce qui inclut les MP. Le bot refuse ensuite
  // explicitement toute commande envoyee depuis un serveur.
  json.integration_types = [1];
  json.contexts = [1, 2];
  return json;
});
