/** Types communs du moteur de transport (independants de tout reseau). */

/** Un reseau de transport du catalogue national. */
export interface Network {
  /** Identifiant du jeu de donnees sur transport.data.gouv.fr. */
  id: string;
  /** Nom commercial, ex "TBM", "TCL", "Ilévia". */
  name: string;
  /** Autorite organisatrice (collectivite). */
  authority: string;
  /** Territoire couvert, lisible. */
  area: string;
  /** Logo du reseau ou de son editeur, quand il en publie un. */
  logo: string | null;
  publisherId: string | null;
  /** Urbain, Interurbain, Scolaire, Ferroviaire... */
  kinds: string[];
  gtfsUrl: string;
  /** Flux GTFS-RT : retards et annulations. */
  tripUpdatesUrl: string | null;
  /** Flux GTFS-RT : messages de perturbation. */
  alertsUrl: string | null;
  page: string;
}

export interface Stop {
  /** stop_id GTFS, ou identifiant de la station parente quand il y en a une. */
  id: string;
  name: string;
  /** Quais regroupes sous cet arret (stop_id GTFS). */
  quays: string[];
  /** Lignes desservies (route_id GTFS). */
  lines: string[];
  lat: number;
  lon: number;
}

export interface Line {
  id: string;
  /** Nom court, ex "15" ou "A". */
  short: string;
  long: string;
  /** Couleurs officielles de la ligne, "#rrggbb". */
  color: string | null;
  textColor: string | null;
  /** Type GTFS : 0 tram, 1 metro, 2 train, 3 bus, 4 ferry... */
  type: number;
}

/**
 * Une liaison directe : monter dans une course a un arret, en descendre a
 * un autre. Les heures viennent des horaires officiels du reseau, corriges
 * en temps reel quand le reseau publie un flux GTFS-RT. La duree du trajet
 * n'est donc jamais estimee : c'est celle de la course elle-meme.
 */
export interface Journey {
  tripId: string;
  /** Jour de service GTFS, "YYYYMMDD". */
  serviceDate: string;
  line: Line;
  /** "Bus", "Tram", "Métro", "Train"... */
  mode: string;
  headsign: string;
  fromStop: Stop;
  toStop: Stop;
  /** Marche jusqu'a l'arret de montee et depuis l'arret de descente. */
  walkTo: number;
  walkFrom: number;
  aimedDeparture: Date;
  departure: Date;
  aimedArrival: Date;
  arrival: Date;
  /** Retard au depart, en minutes (negatif = en avance). Null sans temps reel. */
  delayMinutes: number | null;
  cancelled: boolean;
  realtime: boolean;
}

export interface Disruption {
  id: string;
  summary: string;
  detail: string;
  /** Lignes concernees (noms courts). */
  lines: string[];
  from: Date | null;
  to: Date | null;
}
