import type { AccountKind } from "pawnote";

/** Identifiants persistes apres le premier login web. */
export interface StoredCredentials {
  url: string;
  kind: AccountKind;
  username: string;
  /** Token de rafraichissement — remplace le mot de passe. */
  token: string;
  deviceUUID: string;
  navigatorIdentifier?: string;
  /** Timestamp du dernier refresh reussi. */
  lastRefresh: number;
}

export interface BagItem {
  /** "Cahier", "Classeur", "Trieur", "Pochette", "Manuel"... */
  label: string;
  /** Couleur hexadecimale de l'objet, ex "#e63946". */
  color: string;
}

export interface NotificationToggles {
  timetable: boolean;
  grades: boolean;
  homework: boolean;
  discussions: boolean;
  news: boolean;
  attendance: boolean;
  evaluations: boolean;
  sessionExpiry: boolean;
  transport: boolean;
}

export interface TransportConfig {
  enabled: boolean;
  /** Jeu de donnees du Point d'Acces National (transport.data.gouv.fr). */
  networkId: string;
  networkName: string;
  networkLogo: string | null;
  /**
   * Reseau hors catalogue (etranger, flux prive) : `networkId` vaut "custom"
   * et ces adresses remplacent celles du Point d'Acces National.
   */
  customGtfsUrl: string;
  customTripUpdatesUrl: string;
  customAlertsUrl: string;
  /** Arret proche du domicile (identifiant d'arret de l'index GTFS). */
  homeStopId: string;
  homeStopName: string;
  /** Arret proche de l'etablissement. */
  schoolStopId: string;
  schoolStopName: string;
  /** Lignes autorisees (route_id GTFS). Vide = toutes les liaisons directes. */
  lines: string[];
  /** Marche domicile -> arret, en minutes. */
  walkToHomeStop: number;
  /** Marche arret -> etablissement. */
  walkFromSchoolStop: number;
  /** Marche etablissement -> arret (retour). */
  walkToSchoolStop: number;
  /** Marche arret -> domicile (retour). */
  walkFromHomeStop: number;
  /** Arriver au moins N minutes avant le premier cours. */
  arriveMinBefore: number;
  /** Preavis avant l'heure de depart, en minutes. */
  notifyLeadMinutes: number;
  /** Retard a partir duquel une alerte est envoyee, en minutes. */
  delayAlertMinutes: number;
  /** Envoyer aussi la fiche de retour apres les cours. */
  eveningEnabled: boolean;
  /** Surveillance de la course choisie avant le depart, en minutes. */
  morningWatchMinutes: number;
  /** Surveillance apres la fin des cours, en minutes. */
  eveningWatchMinutes: number;
  /** Messages de perturbation sur les lignes empruntees. */
  disruptionAlerts: boolean;
}

export interface QuietHours {
  enabled: boolean;
  /** "HH:MM" — debut de la plage silencieuse. */
  start: string;
  /** "HH:MM" — fin ; les alertes retenues partent a ce moment. */
  end: string;
}

export interface BotConfig {
  /** ID Discord du proprietaire — destinataire de toutes les notifications. */
  ownerId: string | null;
  /** Prenom utilise par le bot pour s'adresser a l'utilisateur. */
  displayName: string;
  setupComplete: boolean;
  timezone: string;

  /** "HH:MM" — brief du matin pour le jour meme. */
  morningBriefTime: string;
  /** "HH:MM" — brief du soir pour le lendemain. */
  eveningBriefTime: string;
  morningBriefEnabled: boolean;
  eveningBriefEnabled: boolean;

  /** Intervalle de polling en minutes (defaut 6 => 10 appels/heure). */
  pollIntervalMinutes: number;

  notifications: NotificationToggles;
  /** Pas de notification la nuit : les changements sont regroupes au reveil. */
  quietHours: QuietHours;

  /** Couleur par matiere pour l'emploi du temps — cle = nom de matiere normalise. */
  subjectColors: Record<string, string>;
  /** Contenu du sac par matiere — cle = nom de matiere normalise. */
  bag: Record<string, BagItem[]>;

  /** Theme des images generees, reglable par type de rendu. */
  imageTheme: {
    timetable: "clair" | "sombre";
    grades: "clair" | "sombre";
    notifications: "clair" | "sombre";
    bag: "clair" | "sombre";
    transport: "clair" | "sombre";
  };

  transport: TransportConfig;

  /** Accent des changements concernant aujourd'hui/demain. */
  colorImminent: string;
  /** Accent des changements concernant une date plus lointaine. */
  colorFuture: string;
}

/** Forme aplatie et serialisable d'un cours, utilisee pour le diff. */
export interface FlatLesson {
  id: string;
  subject: string;
  teachers: string[];
  rooms: string[];
  groups: string[];
  start: number;
  end: number;
  canceled: boolean;
  exempted: boolean;
  test: boolean;
  status?: string;
  backgroundColor?: string;
}

export interface FlatAssignment {
  id: string;
  subject: string;
  description: string;
  done: boolean;
  deadline: number;
  difficulty: number;
  backgroundColor?: string;
}

export interface FlatGrade {
  id: string;
  subject: string;
  value: number | null;
  outOf: number | null;
  coefficient: number;
  date: number;
  comment: string;
  average: number | null;
  periodName: string;
}

export interface FlatAverage {
  subject: string;
  student: number | null;
  classAverage: number | null;
  outOf: number | null;
}

export interface FlatDiscussion {
  id: string;
  subject: string;
  sender: string;
  lastMessage: number;
  unread: number;
}

export interface FlatNews {
  id: string;
  title: string;
  author: string;
  date: number;
  read: boolean;
  content?: string;
}

export interface FlatAbsence {
  id: string;
  from: number;
  to: number;
  justified: boolean;
  reason: string;
  hours: string;
}

export type SnapshotPart = "lessons" | "assignments" | "grades" | "discussions" | "news" | "absences";

/** Instantane complet recupere a chaque cycle de polling. */
export interface Snapshot {
  fetchedAt: number;
  /** Plage couverte par l'emploi du temps : le diff ne compare que l'intersection. */
  range: { from: number; to: number };
  /** Categories effectivement recuperees lors de ce cycle. */
  ok: Record<SnapshotPart, boolean>;
  studentName: string;
  className: string;
  lessons: FlatLesson[];
  assignments: FlatAssignment[];
  grades: FlatGrade[];
  averages: FlatAverage[];
  overallAverage: number | null;
  discussions: FlatDiscussion[];
  news: FlatNews[];
  absences: FlatAbsence[];
  periods: { id: string; name: string; start: number; end: number }[];
  currentPeriodName: string | null;
}

export type ChangeKind =
  | "lesson_canceled"
  | "lesson_restored"
  | "lesson_room"
  | "lesson_teacher"
  | "lesson_moved"
  | "lesson_added"
  | "lesson_removed"
  | "lesson_status"
  | "lesson_test"
  | "grade_new"
  | "average_change"
  | "homework_new"
  | "homework_done"
  | "discussion_new"
  | "news_new"
  | "absence_new"
  | "absence_justified";

export interface Change {
  kind: ChangeKind;
  /** Cle stable de deduplication (independante de la formulation). */
  key: string;
  /** Date concernee par le changement (pour le code couleur imminent/futur). */
  targetDate: number | null;
  title: string;
  detail: string;
  subject?: string;
}
