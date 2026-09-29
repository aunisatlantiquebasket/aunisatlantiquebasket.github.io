export interface Team {
  slug: string;
  name: string;
  category: string;
  coach?: string;
  championship: string;
  trainings: (string | Training)[]; // "Mardi 17h00 – 18h30", ou un créneau avec son propre lieu
  trainingVenue?: string; // lieu des entraînements, si différent de la salle du club (config.gym)
  players: Player[];
  // Champs mis à jour automatiquement par la synchronisation FFBB (npm run sync-ffbb)
  ffbbId?: string; // identifiant de l'engagement de l'équipe à la FFBB (change à chaque saison)
  ffbbKey?: string; // identité stable : catégorie-sexe-numéro, ex. "SE-M-1"
  active?: boolean; // false : plus engagée à la FFBB, masquée du site
  ffbbUrl?: string; // fiche de l'équipe sur competitions.ffbb.com
  ranking?: { position: number; points: number; played: number; wins: number; losses: number };
  standings?: StandingRow[]; // classement complet de la poule
}

export interface StandingRow {
  position: number;
  name: string;
  logo?: string;
  points: number;
  played: number;
  wins: number;
  losses: number;
  scored: number;
  conceded: number;
  diff: number;
  isUs: boolean;
}

/** Créneau d'entraînement avec un lieu propre (lien d'itinéraire) et/ou une précision */
export interface Training {
  time: string; // "Lundi 18h00 – 19h30"
  place?: string; // "Gymnase intercommunal Bel Air, rue de Bel-Air, 17230 Marans" (nom affiché, adresse pour l'itinéraire)
  note?: string; // précision libre
  /**
   * Lieu en alternance d'une semaine sur l'autre : la semaine de `from` a lieu à places[0],
   * la suivante à places[1], etc. Le site affiche le lieu du prochain créneau.
   */
  alternate?: { from: string; places: string[] };
}

export interface Player {
  number: number;
  firstName: string;
  lastName: string;
  position: "Meneur" | "Arrière" | "Ailier" | "Ailier fort" | "Pivot";
}

export interface Match {
  id: string;
  teamSlug: string;
  date: string; // ISO 8601, heure locale (Europe/Paris)
  opponent: string;
  home: boolean;
  venue: string;
  score?: { us: number; them: number };
  source?: "ffbb" | "manual"; // "ffbb" : géré par la synchronisation, ne pas modifier à la main
  round?: number; // numéro de journée
  opponentLogo?: string;
  ffbbUrl?: string;
}

/** Personne du trombinoscope (membre du bureau ou coach) */
export interface Person {
  name: string;
  role?: string; // "Présidente", "Trésorier"… ou, pour un coach, "Coach" ; absent : rien sous le nom
  teams?: { name: string; slug: string }[]; // équipes entraînées
  photo?: string; // URL de la photo si un fichier existe dans public/img/trombi/
  commissions?: string[]; // rôles dans les commissions du club ("Médiation", "La sportive"), calculés
}

/** Commission du club (data/trombinoscope.json) : postes et responsables, membres, missions */
export interface Commission {
  name: string; // "Vie associative"
  roles?: { label: string; people: string[] }[]; // "Communication" → ["Alexandre Martineau", …] ; vide : pas encore défini, non affiché
  members?: string[]; // membres de la commission
  missions?: string[]; // ce dont la commission s'occupe
}

/** Événement de la vie du club, hors matchs (loto, assemblée générale, stage, fête du club…) */
export interface ClubEvent {
  slug: string; // sert d'adresse : /evenements/loto-2026
  title: string;
  kind?: string; // type affiché en étiquette : "Vie du club", "Assemblée générale", "Stage"…
  date: string; // jour de début, "2026-10-17"
  endDate?: string; // dernier jour, pour un événement sur plusieurs jours
  time?: string; // "19h00", "14h00 – 18h00"
  place?: string; // "Salle des fêtes, Saint-Jean-de-Liversay" (lien d'itinéraire)
  summary: string; // phrase courte pour la liste
  description?: string[]; // paragraphes de la page de l'événement
}

export interface Article {
  slug: string;
  title: string;
  date: string; // ISO 8601
  summary: string;
  content: string[];
}

