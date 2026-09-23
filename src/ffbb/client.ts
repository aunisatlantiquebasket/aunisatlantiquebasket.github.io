// Lecture des pages publiques de competitions.ffbb.com.
// Le site FFBB (Next.js) embarque ses données dans la page sous forme de flux "RSC" :
// on reconstitue ce flux puis on en extrait les objets JSON qui nous intéressent.

const BASE_URL = "https://competitions.ffbb.com";
const USER_AGENT = "AAB-site-sync/1.0 (site du club Aunis Atlantique Basket)";
const DELAY_BETWEEN_REQUESTS_MS = 500; // pour ne pas surcharger le site de la FFBB

export interface FfbbEngagementRef {
  id: string;
  numeroEquipe: string;
  nom: string;
  idOrganisme?: { id: string; logo?: { id: string } | null };
}

/** Équipe engagée, telle que listée sur la page du club */
export interface FfbbClubTeam {
  id: string;
  numeroEquipe: string;
  categorie: string; // "SE", "U15", "U13"…
  sexe: "M" | "F" | string;
  label: string; // "Départementale masculine seniors - Division 2"
  competition: string; // "DM2"
  poule: string; // "Poule A"
  phase: string;
  position: string;
  points: string;
  type?: string; // "DIV" = championnat, sinon coupe, plateau…
  url_competition: string;
}

export interface FfbbRencontre {
  id: string;
  date_rencontre: string; // "2026-09-20T13:00:00", heure locale
  joue: boolean;
  numeroJournee: string;
  resultatEquipe1: string | null;
  resultatEquipe2: string | null;
  url_competition: string;
  idEngagementEquipe1: FfbbEngagementRef;
  idEngagementEquipe2: FfbbEngagementRef;
}

export interface FfbbClassement {
  matchJoues: string;
  gagnes: string;
  perdus: string;
  points: string;
  position: string;
  idEngagement: { id: string };
}

export interface FfbbSalle {
  nom: string;
  adresse: string;
}

let lastRequest = 0;

async function fetchPage(path: string): Promise<string> {
  const wait = lastRequest + DELAY_BETWEEN_REQUESTS_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();

  const res = await fetch(BASE_URL + path, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`FFBB : HTTP ${res.status} sur ${path}`);
  return res.text();
}

/** Reconstitue le flux RSC à partir des appels self.__next_f.push([1,"…"]) de la page */
function extractRsc(html: string): string {
  let rsc = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    rsc += JSON.parse(m[1]) as string;
  }
  if (!rsc) throw new Error("FFBB : données introuvables dans la page (le site a peut-être changé)");
  return rsc;
}

/** Renvoie chaque objet JSON du flux qui contient directement la clé donnée */
function objectsWithKey<T>(text: string, key: string): T[] {
  const results: T[] = [];
  const seen = new Set<number>();
  let from = 0;
  for (;;) {
    const k = text.indexOf(`"${key}":`, from);
    if (k < 0) break;
    from = k + 1;

    // Remonte jusqu'à l'accolade ouvrante de l'objet englobant
    let depth = 0;
    let start = -1;
    for (let i = k; i >= 0; i--) {
      const c = text[i];
      if (c === "}") depth++;
      else if (c === "{") {
        if (depth === 0) { start = i; break; }
        depth--;
      }
    }
    if (start < 0 || seen.has(start)) continue;

    // Avance jusqu'à l'accolade fermante correspondante (en ignorant les chaînes)
    let d = 0;
    let end = -1;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{") d++;
      else if (c === "}" && --d === 0) { end = i; break; }
    }
    if (end < 0) continue;

    try {
      results.push(JSON.parse(text.slice(start, end + 1)) as T);
      seen.add(start);
    } catch {
      // objet partiel ou contenant des références RSC ("$L…") : ignoré
    }
  }
  return results;
}

export async function getClubTeams(clubPath: string): Promise<FfbbClubTeam[]> {
  const rsc = extractRsc(await fetchPage(clubPath));
  return objectsWithKey<FfbbClubTeam>(rsc, "numeroEquipe").filter((o) => o.categorie && o.competition && o.url_competition);
}

export async function getTeamPage(teamPath: string): Promise<{ rencontres: FfbbRencontre[]; classement: FfbbClassement[] }> {
  const rsc = extractRsc(await fetchPage(teamPath));
  const rencontres = objectsWithKey<FfbbRencontre>(rsc, "date_rencontre").filter(
    (r) => r.id && r.idEngagementEquipe1?.id && r.idEngagementEquipe2?.id,
  );
  const classement = objectsWithKey<FfbbClassement>(rsc, "matchJoues").filter((c) => c.idEngagement?.id);
  return { rencontres, classement };
}

export async function getMatchSalle(matchPath: string): Promise<FfbbSalle | undefined> {
  const rsc = extractRsc(await fetchPage(matchPath));
  type Bloc = { type: string; informations: { type: string; value: string }[] };
  const bloc = objectsWithKey<Bloc>(rsc, "informations").find((b) => b.type === "salle" && Array.isArray(b.informations));
  if (!bloc) return undefined;
  return {
    nom: bloc.informations.find((i) => i.type === "text")?.value ?? "",
    adresse: bloc.informations.find((i) => i.type === "address")?.value ?? "",
  };
}

/** Ligne du classement complet d'une poule */
export interface FfbbStandingRow {
  engagementId: string;
  position: number;
  label: string; // "CIRE SPORTS - 2"
  logoId?: string;
  points: number;
  played: number;
  wins: number;
  losses: number;
  scored: number;
  conceded: number;
  diff: number;
}

const htmlText = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/**
 * Classement complet de la poule (page ".../equipes/{id}/classement").
 * Ici les données ne sont pas en JSON mais dans un tableau HTML :
 * position | équipe | pts | J G P N | … | paniers M E D
 */
export async function getStandings(teamPath: string): Promise<FfbbStandingRow[]> {
  const html = await fetchPage(`${teamPath}/classement`);
  const rows: FfbbStandingRow[] = [];
  for (const [tr] of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 11) continue;
    const [played, wins, losses] = htmlText(cells[3]).split(" ").map(Number);
    const [scored, conceded, diff] = htmlText(cells[cells.length - 1]).split(" ").map(Number);
    const row: FfbbStandingRow = {
      engagementId: tr.match(/\/equipes\/(\d+)/)?.[1] ?? "",
      position: Number(htmlText(cells[0])),
      label: htmlText(cells[1]),
      logoId: cells[0].match(/\/assets\/([0-9a-f-]{36})/)?.[1],
      points: Number(htmlText(cells[2])),
      played, wins, losses, scored, conceded, diff,
    };
    if (row.engagementId && row.label && Number.isFinite(row.position) && Number.isFinite(row.points)) rows.push(row);
  }
  return rows;
}

export const ffbbUrl = (path: string) => BASE_URL + path;

/** Logo d'un club hébergé par la FFBB, redimensionné */
export const ffbbLogoUrl = (assetId: string) => `https://api.ffbb.com/assets/${assetId}?height=96&fit=contain&format=webp`;
