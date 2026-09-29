// Lecture des données FFBB via l'API REST publique ffbb-api.desimone.fr.
// Depuis fin septembre 2026, competitions.ffbb.com bloque les robots (protection anti-robot) :
// ce service indépendant et non officiel (https://github.com/nickdesi/ffbb-data-client) relaie
// les flux de données de la FFBB. Les fonctions renvoient les mêmes structures que client.ts,
// si bien que la synchronisation (sync.ts) ne dépend pas de la source utilisée.

import type { FfbbClassement, FfbbClubTeam, FfbbEngagementRef, FfbbRencontre, FfbbSalle, FfbbStandingRow } from "./client.js";

const API_URL = "https://ffbb-api.desimone.fr/api/v1";
const USER_AGENT = "AAB-site-sync/1.0 (site du club Aunis Atlantique Basket)";

interface ApiTeam {
  engagement_id: string;
  team_number: string;
  competition: string; // "Départementale masculine U13"
  poule_id: string;
}
interface ApiMatch {
  ffbbMatchId: string;
  location: string; // "GYMNASE MUNICIPAL, Rue du Stade, 17700 SURGERES"
}
interface ApiCompetition {
  code: string; // "DMU13"
  sexe: string; // "Masculin", "Féminin"
  type_competition: string; // "Championnat", "Coupe"…
  poules?: { id: string; nom: string }[];
}
interface ApiEngagement {
  id: string;
  nom: string;
  numero_equipe: string; // "" pour l'équipe 1
}
interface ApiClassement {
  id_engagement: ApiEngagement;
  position: number;
  points: number;
  match_joues: number;
  gagnes: number;
  perdus: number;
  paniers_marques: number;
  paniers_encaisses: number;
  difference: number;
  organisme_logo_id: string | null;
}
interface ApiRencontre {
  id: string;
  numeroJournee: string;
  resultatEquipe1: string | null;
  resultatEquipe2: string | null;
  joue: number | boolean;
  nomEquipe1: string; // "SAUJON BASKET CLUB - 2"
  nomEquipe2: string;
  date_rencontre: string;
}
interface ApiPoule {
  rencontres: ApiRencontre[];
  classements: ApiClassement[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(API_URL + path, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`API FFBB : HTTP ${res.status} sur ${path}`);
  return (await res.json()) as T;
}

// Données de la synchronisation en cours, rechargées à chaque appel de getClubTeams
let comitePath = ""; // "/ligues/naq/comites/0017" (pour les liens vers competitions.ffbb.com)
let teamsByPath = new Map<string, { pouleId: string; code: string }>();
let venues = new Map<string, string>();
let poules = new Map<string, Promise<ApiPoule>>();

function loadPoule(id: string): Promise<ApiPoule> {
  let p = poules.get(id);
  if (!p) poules.set(id, (p = get<ApiPoule>(`/poule/${id}`)));
  return p;
}

/** Compétition (code, sexe, type) qui contient la poule, retrouvée par le moteur de recherche */
async function findCompetition(label: string, pouleId: string): Promise<ApiCompetition | undefined> {
  const results = await get<{ index_uid: string; hits?: ApiCompetition[] }[]>(`/search?query=${encodeURIComponent(label)}`);
  const hits = results.find((r) => r.index_uid === "ffbbserver_competitions")?.hits ?? [];
  return hits.find((c) => c.poules?.some((p) => p.id === pouleId));
}

/** Libellé d'une équipe tel qu'écrit dans les rencontres : "SAUJON BASKET CLUB - 2" */
const engagementLabel = (e: ApiEngagement) => (e.numero_equipe && e.numero_equipe !== "1" ? `${e.nom} - ${e.numero_equipe}` : e.nom);

export async function getClubTeams(clubPath: string, organismeId: string): Promise<FfbbClubTeam[]> {
  comitePath = clubPath.replace(/\/clubs\/.*$/, "");
  teamsByPath = new Map();
  poules = new Map();

  const [{ teams }, { matches }] = await Promise.all([
    get<{ teams: ApiTeam[] }>(`/club/${organismeId}/teams`),
    get<{ matches: ApiMatch[] }>(`/club/${organismeId}/matches`),
  ]);
  venues = new Map(matches.map((m) => [m.ffbbMatchId, m.location]));

  const result: FfbbClubTeam[] = [];
  for (const t of teams) {
    const comp = await findCompetition(t.competition, t.poule_id);
    if (!comp) throw new Error(`API FFBB : compétition introuvable pour « ${t.competition} »`);
    const url = `${clubPath}/equipes/${t.engagement_id}`;
    teamsByPath.set(url, { pouleId: t.poule_id, code: comp.code });
    result.push({
      id: t.engagement_id,
      numeroEquipe: t.team_number || "1",
      categorie: t.competition.match(/\bU\d+\b/)?.[0] ?? "SE",
      sexe: /^f/i.test(comp.sexe) ? "F" : /^m/i.test(comp.sexe) ? "M" : comp.sexe,
      label: t.competition,
      competition: comp.code,
      poule: comp.poules?.find((p) => p.id === t.poule_id)?.nom ?? "",
      phase: "",
      position: "",
      points: "",
      type: comp.type_competition === "Championnat" ? "DIV" : comp.type_competition,
      url_competition: url,
    });
  }
  return result;
}

function teamInfo(teamPath: string) {
  const info = teamsByPath.get(teamPath);
  if (!info) throw new Error(`API FFBB : équipe inconnue ${teamPath}`);
  return info;
}

export async function getTeamPage(teamPath: string): Promise<{ rencontres: FfbbRencontre[]; classement: FfbbClassement[] }> {
  const { pouleId, code } = teamInfo(teamPath);
  const poule = await loadPoule(pouleId);

  // Les rencontres ne donnent que le nom des équipes : on les relie aux engagements du classement
  const byLabel = new Map(poule.classements.map((c) => [engagementLabel(c.id_engagement), c]));
  const ref = (label: string): FfbbEngagementRef => {
    const c = byLabel.get(label);
    const m = label.match(/^(.*) - (\d+)$/);
    return {
      id: c?.id_engagement.id ?? label,
      nom: c?.id_engagement.nom ?? m?.[1] ?? label,
      numeroEquipe: c?.id_engagement.numero_equipe || m?.[2] || "1",
      idOrganisme: c?.organisme_logo_id ? { id: "", logo: { id: c.organisme_logo_id } } : undefined,
    };
  };

  const rencontres = poule.rencontres.map((r) => ({
    id: r.id,
    date_rencontre: r.date_rencontre,
    joue: Boolean(r.joue),
    numeroJournee: r.numeroJournee,
    resultatEquipe1: r.resultatEquipe1,
    resultatEquipe2: r.resultatEquipe2,
    url_competition: `${comitePath}/competitions/${code.toLowerCase()}/match/${r.id}`,
    idEngagementEquipe1: ref(r.nomEquipe1),
    idEngagementEquipe2: ref(r.nomEquipe2),
  }));
  const classement = poule.classements.map((c) => ({
    idEngagement: { id: c.id_engagement.id },
    position: String(c.position),
    points: String(c.points),
    matchJoues: String(c.match_joues),
    gagnes: String(c.gagnes),
    perdus: String(c.perdus),
  }));
  return { rencontres, classement };
}

export async function getStandings(teamPath: string): Promise<FfbbStandingRow[]> {
  const poule = await loadPoule(teamInfo(teamPath).pouleId);
  return poule.classements
    .map((c) => ({
      engagementId: c.id_engagement.id,
      position: c.position,
      label: engagementLabel(c.id_engagement),
      logoId: c.organisme_logo_id ?? undefined,
      points: c.points,
      played: c.match_joues,
      wins: c.gagnes,
      losses: c.perdus,
      scored: c.paniers_marques,
      conceded: c.paniers_encaisses,
      diff: c.difference,
    }))
    .sort((a, b) => a.position - b.position);
}

/** Salle d'un match du club : "GYMNASE MUNICIPAL, Rue du Stade, 17700 SURGERES" */
export async function getMatchSalle(matchPath: string): Promise<FfbbSalle | undefined> {
  const location = venues.get(matchPath.split("/").pop() ?? "");
  if (!location) return undefined;
  const i = location.indexOf(",");
  return i < 0 ? { nom: location, adresse: "" } : { nom: location.slice(0, i).trim(), adresse: location.slice(i + 1).trim() };
}
