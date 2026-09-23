import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Article, ClubEvent, Match, Person, Team } from "./types.js";

const dataDir = path.resolve("data");

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(dataDir, file), "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

/** Écrit via un fichier temporaire : une requête ne lit jamais un fichier à moitié écrit */
export async function writeJson(file: string, data: unknown): Promise<void> {
  const target = path.join(dataDir, file);
  await writeFile(`${target}.tmp`, JSON.stringify(data, null, 2) + "\n");
  await rename(`${target}.tmp`, target);
}

/** Équipes affichées sur le site (celles qui ne sont plus engagées à la FFBB sont masquées) */
export async function getTeams(): Promise<Team[]> {
  return (await readJson<Team[]>("teams.json", [])).filter((t) => t.active !== false);
}

export async function getTeam(slug: string): Promise<Team | undefined> {
  return (await getTeams()).find((t) => t.slug === slug);
}

// ---------- Trombinoscope ----------

const TROMBI_DIR = path.resolve("public", "img", "trombi");
const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Photo déposée dans public/img/trombi/ sous le nom de la personne ("anaelle-viaud.jpg").
 * Les coachs n'étant connus que par leur prénom ("Audrey"), on accepte aussi une photo
 * "audrey-….jpg", à condition qu'une seule photo commence par ce prénom (pas de confusion possible).
 */
function photoFor(name: string, files: string[]): string | undefined {
  const photos = files.filter((f) => PHOTO_EXTENSIONS.includes(path.extname(f).toLowerCase()));
  const base = (f: string) => f.slice(0, -path.extname(f).length).toLowerCase();

  const exact = photos.find((f) => base(f) === slugify(name));
  if (exact) return `/img/trombi/${exact}`;

  if (!name.includes(" ")) {
    const first = slugify(name);
    const matches = photos.filter((f) => base(f) === first || base(f).startsWith(`${first}-`));
    if (matches.length === 1) return `/img/trombi/${matches[0]}`;
  }
  return undefined;
}

export interface Trombinoscope {
  bureau: Person[];
  comite: Person[];
  benevoles: Person[];
  coaches: Person[];
}

/** Bureau, comité directeur et bénévoles (data/trombinoscope.json) ; coachs déduits des équipes */
export async function getTrombinoscope(): Promise<Trombinoscope> {
  const [data, teams, files] = await Promise.all([
    readJson<Partial<Record<"bureau" | "comite" | "benevoles", Person[]>>>("trombinoscope.json", {}),
    getTeams(),
    readdir(TROMBI_DIR).catch(() => [] as string[]),
  ]);

  // Un coach peut entraîner plusieurs équipes : on regroupe par nom
  const coaches = new Map<string, Person>();
  for (const team of teams) {
    for (const name of (team.coach ?? "").split(",").map((n) => n.trim()).filter(Boolean)) {
      const person = coaches.get(name) ?? { name, role: "Coach", teams: [] };
      person.teams!.push({ name: team.name, slug: team.slug });
      coaches.set(name, person);
    }
  }

  const withPhoto = (p: Person): Person => ({ ...p, photo: photoFor(p.name, files) });
  return {
    bureau: (data.bureau ?? []).map(withPhoto),
    comite: (data.comite ?? []).map(withPhoto),
    benevoles: (data.benevoles ?? []).map(withPhoto),
    coaches: [...coaches.values()].map(withPhoto),
  };
}

export async function getMatches(): Promise<Match[]> {
  const matches = await readJson<Match[]>("matches.json", []);
  return matches.sort((a, b) => a.date.localeCompare(b.date));
}

// Un match reste "à venir" jusqu'à 3 h après le coup d'envoi, ou jusqu'à la saisie du score
const MATCH_DURATION_MS = 3 * 60 * 60 * 1000;
const isPlayed = (m: Match) => m.score !== undefined || new Date(m.date).getTime() + MATCH_DURATION_MS < Date.now();

export async function getUpcomingMatches(limit?: number): Promise<Match[]> {
  const upcoming = (await getMatches()).filter((m) => !isPlayed(m));
  return limit ? upcoming.slice(0, limit) : upcoming;
}

export async function getPastMatches(limit?: number): Promise<Match[]> {
  const past = (await getMatches()).filter(isPlayed).reverse();
  return limit ? past.slice(0, limit) : past;
}

// ---------- Événements (data/evenements.json) ----------

/** Un événement reste « à venir » jusqu'à la fin de son dernier jour */
const isEventPast = (e: ClubEvent) => {
  const [y, m, d] = (e.endDate ?? e.date).split("-").map(Number);
  return new Date(y, m - 1, d + 1).getTime() <= Date.now();
};

export async function getEvents(): Promise<{ upcoming: ClubEvent[]; past: ClubEvent[] }> {
  const events = (await readJson<ClubEvent[]>("evenements.json", [])).sort((a, b) => a.date.localeCompare(b.date));
  return { upcoming: events.filter((e) => !isEventPast(e)), past: events.filter(isEventPast).reverse() };
}

export async function getEvent(slug: string): Promise<(ClubEvent & { past: boolean }) | undefined> {
  const event = (await readJson<ClubEvent[]>("evenements.json", [])).find((e) => e.slug === slug);
  return event && { ...event, past: isEventPast(event) };
}

export async function getArticles(): Promise<Article[]> {
  const articles = await readJson<Article[]>("articles.json", []);
  return articles.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getArticle(slug: string): Promise<Article | undefined> {
  return (await getArticles()).find((a) => a.slug === slug);
}

