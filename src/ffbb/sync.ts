// Synchronisation des équipes, matchs, scores et classements depuis le site de la FFBB.
//
// Règles de fusion :
// - les matchs "source: ffbb" sont entièrement gérés ici (recréés à chaque synchro) ;
//   les autres matchs (amicaux, saisis à la main) ne sont jamais touchés ;
// - pour les équipes, seuls les champs FFBB sont mis à jour (championnat, lien, classement) ;
//   nom, coach, entraînements, effectif restent ceux saisis dans data/teams.json ;
// - une équipe nouvellement engagée à la FFBB est ajoutée automatiquement ;
// - en cas d'erreur, rien n'est écrit : le site garde les données précédentes.

import { open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { club } from "../config.js";
import { readJson, writeJson } from "../data/repository.js";
import type { Match, Team } from "../data/types.js";
import { localLogo } from "./logos.js";
import {
  ffbbUrl,
  getClubTeams,
  getMatchSalle,
  getStandings,
  getTeamPage,
  type FfbbClubTeam,
  type FfbbEngagementRef,
  type FfbbRencontre,
} from "./client.js";

export interface SyncStatus {
  lastAttempt: string;
  lastSuccess?: string;
  error?: string;
  teams?: number;
  matches?: number;
}

export const STATUS_FILE = "ffbb-sync.json";
const VENUE_REFRESH_DAYS = 14; // la salle des matchs proches est revérifiée (changement de dernière minute)

// ---------- Mise en forme des noms (la FFBB écrit tout en majuscules) ----------

// Mots laissés en minuscules hors début de nom ("Salle des sports", "Gymnase municipal")
const SMALL_WORDS = new Set([
  "de", "du", "des", "la", "le", "les", "et", "en", "sur", "aux", "au",
  "sports", "municipal", "municipale", "intercommunal", "intercommunale", "omnisports", "polyvalente", "polyvalent",
]);

function titleCaseWord(word: string, first: boolean): string {
  if (!/[A-Za-zÀ-ÿ]/.test(word)) return word; // "17", "-", "&"
  if (word === "ST") return "Saint";
  if (word === "STE") return "Sainte";
  if (word.includes("'")) {
    const [a, b] = word.split("'", 2);
    return `${a.toLowerCase()}'${titleCaseWord(b, true)}`;
  }
  const lower = word.toLowerCase();
  if (!first && SMALL_WORDS.has(lower)) return lower;
  if (!/[AEIOUYÀ-Ý]/i.test(word) && word.length <= 5) return word.toUpperCase(); // sigles : BBMB, CTC
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function prettify(raw: string, names: Record<string, string>): string {
  const clean = raw.trim().replace(/\s+/g, " ");
  if (names[clean]) return names[clean];
  return clean.split(" ").map((w, i) => titleCaseWord(w, i === 0)).join(" ");
}

function teamName(ref: FfbbEngagementRef, names: Record<string, string>): string {
  const n = prettify(ref.nom, names);
  return ref.numeroEquipe && ref.numeroEquipe !== "1" ? `${n} ${ref.numeroEquipe}` : n;
}

/** "CIRE SPORTS - 2" (libellé du classement) → "Ciré Sports 2" */
function labelName(label: string, names: Record<string, string>): string {
  const m = label.match(/^(.*) - (\d+)$/);
  return m ? `${prettify(m[1], names)} ${m[2]}` : prettify(label, names);
}

// ---------- Équipes du club ----------

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function defaultTeamName(t: FfbbClubTeam): string {
  const cat = t.categorie === "SE" ? "Seniors" : t.categorie;
  const gender = t.sexe === "M" ? "Masculins" : t.sexe === "F" ? "Féminines" : "Mixte";
  const num = t.numeroEquipe && t.numeroEquipe !== "1" ? ` ${t.numeroEquipe}` : "";
  return `${cat} ${gender}${num}`;
}

/** Identité stable d'une équipe d'une saison à l'autre : catégorie, sexe et numéro ("SE-M-1") */
const ffbbKey = (t: FfbbClubTeam) => `${t.categorie}-${t.sexe}-${t.numeroEquipe || "1"}`;

/** Évite deux équipes avec la même adresse de page */
function uniqueSlug(base: string, teams: Team[]): string {
  let slug = base;
  for (let i = 2; teams.some((t) => t.slug === slug); i++) slug = `${base}-${i}`;
  return slug;
}

function championship(t: FfbbClubTeam): string {
  return [`${t.label} (${t.competition})`, t.phase, t.poule?.replace(/^Poule/, "poule")].filter(Boolean).join(", ");
}

// ---------- Synchronisation ----------

// Verrou partagé entre processus (serveur + commande manuelle) : une seule synchro à la fois
const LOCK_FILE = path.resolve("data", ".ffbb-sync.lock");
const LOCK_STALE_MS = 10 * 60 * 1000;

async function acquireLock(): Promise<boolean> {
  try {
    await (await open(LOCK_FILE, "wx")).close();
    return true;
  } catch {
    const info = await stat(LOCK_FILE).catch(() => undefined);
    if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
      await rm(LOCK_FILE, { force: true }); // verrou abandonné (processus interrompu)
      return acquireLock();
    }
    return false;
  }
}

export async function syncFromFfbb(log: (msg: string) => void = console.log): Promise<SyncStatus> {
  if (!(await acquireLock())) {
    log("FFBB : une synchronisation est déjà en cours, abandon");
    return { lastAttempt: new Date().toISOString(), error: "synchronisation déjà en cours" };
  }
  try {
    return await runSync(log);
  } finally {
    await rm(LOCK_FILE, { force: true });
  }
}

async function runSync(log: (msg: string) => void): Promise<SyncStatus> {
  const status: SyncStatus = { ...(await readJson<SyncStatus | null>(STATUS_FILE, null)), lastAttempt: new Date().toISOString() };

  try {
    const [teams, matches, names] = await Promise.all([
      readJson<Team[]>("teams.json", []),
      readJson<Match[]>("matches.json", []),
      readJson<Record<string, string>>("ffbb-noms.json", {}),
    ]);
    const previous = new Map(matches.filter((m) => m.source === "ffbb").map((m) => [m.id, m]));

    const clubTeams = await getClubTeams(club.ffbbClubPath);
    if (clubTeams.length === 0) throw new Error("aucune équipe trouvée sur la page du club FFBB");
    log(`FFBB : ${clubTeams.length} équipe(s) engagée(s)`);

    const ffbbMatches: Match[] = [];
    const engaged = new Set<Team>(); // équipes trouvées à la FFBB lors de cette synchro
    const matchCount = new Map<string, number>();

    // Championnat d'abord : c'est lui qui donne l'identifiant, le lien et le classement de l'équipe.
    // Les autres engagements de la même équipe (coupe…) ne font qu'ajouter leurs matchs.
    const ordered = [...clubTeams].sort((a, b) => Number(b.type === "DIV") - Number(a.type === "DIV"));

    for (const ct of ordered) {
      const key = ffbbKey(ct);
      // L'identifiant FFBB change à chaque saison (et parfois à chaque phase) : on retrouve donc
      // l'équipe par sa clé catégorie-sexe-numéro, ce qui conserve nom, coach, horaires et effectif.
      let team =
        teams.find((t) => t.ffbbId === ct.id) ??
        teams.find((t) => t.ffbbKey === key) ??
        teams.find((t) => !t.ffbbKey && t.ffbbUrl === ffbbUrl(ct.url_competition));
      if (!team) {
        const name = defaultTeamName(ct);
        team = { slug: uniqueSlug(slugify(name), teams), name, category: ct.categorie === "SE" ? "Seniors" : "Jeunes", championship: "", trainings: [], players: [] };
        teams.push(team);
        log(`FFBB : nouvelle équipe ajoutée « ${name} »`);
      } else if (team.active === false) {
        log(`FFBB : « ${team.name} » est de nouveau engagée, réaffichée sur le site`);
      }
      const primary = !engaged.has(team);
      engaged.add(team);
      team.ffbbKey = key;
      team.active = true;

      const { rencontres, classement } = await getTeamPage(ct.url_competition);
      const own = rencontres.filter((r) => r.idEngagementEquipe1.id === ct.id || r.idEngagementEquipe2.id === ct.id);
      for (const r of own) ffbbMatches.push(await toMatch(r, ct.id, team.slug, previous, names));
      matchCount.set(team.slug, (matchCount.get(team.slug) ?? 0) + own.length);

      if (!primary) {
        log(`FFBB : ${team.name} → ${own.length} match(s) en « ${ct.label} »`);
        continue;
      }
      team.ffbbId = ct.id;
      team.ffbbUrl = ffbbUrl(ct.url_competition);
      team.championship = championship(ct);

      const row = classement.find((c) => c.idEngagement.id === ct.id);
      if (row) {
        team.ranking = {
          position: Number(row.position),
          points: Number(row.points),
          played: Number(row.matchJoues),
          wins: Number(row.gagnes),
          losses: Number(row.perdus),
        };
      }

      // Classement complet de la poule : facultatif, on garde l'ancien s'il n'est pas lisible
      try {
        const standings = await getStandings(ct.url_competition);
        if (standings.length >= 2 && standings.some((s) => s.engagementId === ct.id)) {
          team.standings = [];
          for (const s of standings) team.standings.push({
            position: s.position,
            name: s.engagementId === ct.id ? club.name : labelName(s.label, names),
            logo: s.logoId ? await localLogo(s.logoId) : undefined,
            points: s.points,
            played: s.played,
            wins: s.wins,
            losses: s.losses,
            scored: s.scored,
            conceded: s.conceded,
            diff: s.diff,
            isUs: s.engagementId === ct.id,
          });
        } else {
          log(`FFBB : classement complet illisible pour « ${team.name} », ancien classement conservé`);
        }
      } catch (err) {
        log(`FFBB : classement complet indisponible pour « ${team.name} » (${err instanceof Error ? err.message : err})`);
      }

      log(`FFBB : ${team.name} → ${own.length} match(s)${row ? `, ${row.position}e` : ""}${team.standings ? `, poule de ${team.standings.length}` : ""}`);
    }

    // Sécurité : une équipe qui avait des matchs et n'en a plus aucun signale une page FFBB mal lue
    for (const team of engaged) {
      const hadMatches = [...previous.values()].some((m) => m.teamSlug === team.slug);
      if (hadMatches && !matchCount.get(team.slug)) throw new Error(`aucun match lu pour « ${team.name} » alors qu'il y en avait (page FFBB modifiée ?)`);
    }

    // Équipes FFBB qui ne sont plus engagées : masquées du site (pas supprimées, elles reviennent si réengagées)
    for (const team of teams) {
      if (!team.ffbbId && !team.ffbbKey) continue; // équipes hors FFBB (loisirs…) : jamais touchées
      if (engaged.has(team)) continue;
      if (team.active !== false) log(`FFBB : « ${team.name} » n'est plus engagée, masquée du site`);
      team.active = false;
    }

    // Dédoublonnage (un même match peut apparaître deux fois si deux équipes du club s'affrontent)
    const unique = [...new Map(ffbbMatches.map((m) => [m.id, m])).values()];
    const manual = matches.filter((m) => m.source !== "ffbb");
    const merged = [...manual, ...unique].sort((a, b) => a.date.localeCompare(b.date));

    await writeJson("teams.json", teams);
    await writeJson("matches.json", merged);

    Object.assign(status, { lastSuccess: status.lastAttempt, error: undefined, teams: clubTeams.length, matches: unique.length });
    log(`FFBB : synchronisation terminée (${unique.length} matchs)`);
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err);
    log(`FFBB : échec de la synchronisation, données conservées. ${status.error}`);
  }

  await writeJson(STATUS_FILE, status);
  return status;
}

async function toMatch(
  r: FfbbRencontre,
  teamId: string,
  teamSlug: string,
  previous: Map<string, Match>,
  names: Record<string, string>,
): Promise<Match> {
  const id = `ffbb-${r.id}`;
  const home = r.idEngagementEquipe1.id === teamId;
  const opponent = home ? r.idEngagementEquipe2 : r.idEngagementEquipe1;

  const s1 = Number(r.resultatEquipe1);
  const s2 = Number(r.resultatEquipe2);
  const played = r.joue && r.resultatEquipe1 !== null && r.resultatEquipe2 !== null && !Number.isNaN(s1) && !Number.isNaN(s2);

  return {
    id,
    teamSlug,
    date: r.date_rencontre.slice(0, 19),
    opponent: teamName(opponent, names),
    home,
    venue: await venueFor(r, previous.get(id), names),
    ...(played ? { score: home ? { us: s1, them: s2 } : { us: s2, them: s1 } } : {}),
    source: "ffbb",
    round: Number(r.numeroJournee) || undefined,
    opponentLogo: opponent.idOrganisme?.logo?.id ? await localLogo(opponent.idOrganisme.logo.id) : undefined,
    ffbbUrl: ffbbUrl(r.url_competition),
  };
}

async function venueFor(r: FfbbRencontre, prev: Match | undefined, names: Record<string, string>): Promise<string> {
  const daysAway = (new Date(r.date_rencontre).getTime() - Date.now()) / 86_400_000;
  const needsRefresh = !r.joue && daysAway >= 0 && daysAway <= VENUE_REFRESH_DAYS;
  if (prev?.venue && prev.date === r.date_rencontre.slice(0, 19) && !needsRefresh) return prev.venue;

  const salle = await getMatchSalle(r.url_competition);
  if (!salle?.nom) return prev?.venue ?? "Salle à confirmer";
  const city = salle.adresse.match(/\d{5}\s+(.+)$/)?.[1] ?? salle.adresse;
  return city ? `${prettify(salle.nom, names)}, ${city}` : prettify(salle.nom, names);
}
