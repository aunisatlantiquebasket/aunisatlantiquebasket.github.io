export interface Team {
  slug: string;
  name: string;
  category: string;
  coach?: string;
  championship: string;
  trainings: string[];
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
  role: string; // "Présidente", "Trésorier"… ou, pour un coach, "Coach"
  teams?: { name: string; slug: string }[]; // équipes entraînées
  photo?: string; // URL de la photo si un fichier existe dans public/img/trombi/
}

export interface Article {
  slug: string;
  title: string;
  date: string; // ISO 8601
  summary: string;
  content: string[];
}

