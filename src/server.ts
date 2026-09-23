import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { club, port } from "./config.js";
import {
  getArticle,
  getArticles,
  getPastMatches,
  getTeam,
  getTeams,
  getTrombinoscope,
  getUpcomingMatches,
  readJson,
} from "./data/repository.js";
import type { Match } from "./data/types.js";
import { startFfbbAutoSync } from "./ffbb/scheduler.js";
import { STATUS_FILE, type SyncStatus } from "./ffbb/sync.js";

// Les horaires des matchs sont en heure locale française, quel que soit le fuseau du serveur
process.env.TZ ??= "Europe/Paris";

export const app = express();

app.set("view engine", "ejs");
app.set("views", path.resolve("views"));
app.use(express.static(path.resolve("public")));

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", options);
const dateFormat = fmt({ weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const shortDateFormat = fmt({ day: "numeric", month: "long", year: "numeric" });
const weekdayFormat = fmt({ weekday: "short" });
const monthFormat = fmt({ month: "short" });
const monthYearFormat = fmt({ month: "long", year: "numeric" });
const timeFormat = fmt({ hour: "2-digit", minute: "2-digit" });
const dayMonthFormat = fmt({ day: "numeric", month: "short" });

const dayFormat = fmt({ weekday: "long", day: "numeric", month: "long" });
const weekendFormat = fmt({ day: "numeric", month: "long" });

/**
 * Week-end auquel appartient un match (du vendredi 18 h au dimanche soir).
 * Un match en semaine forme son propre groupe (sa journée).
 */
function matchWindow(iso: string): { key: string; saturday?: Date; day: Date } {
  const d = new Date(iso);
  const dow = d.getDay(); // 0 = dimanche … 6 = samedi
  const isWeekend = dow === 6 || dow === 0 || (dow === 5 && d.getHours() >= 18);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (!isWeekend) return { key: `jour-${day.toDateString()}`, day };
  const saturday = new Date(day);
  saturday.setDate(day.getDate() + (dow === 6 ? 0 : dow === 0 ? -1 : 1));
  return { key: `we-${saturday.toDateString()}`, saturday, day };
}

/** Matchs du prochain week-end où le club joue, avec un titre ("Ce week-end", "Week-end du 7 novembre") */
function nextWeekend(upcoming: Match[]): { title: string; matches: Match[] } {
  if (upcoming.length === 0) return { title: "Prochains matchs", matches: [] };
  const first = matchWindow(upcoming[0].date);
  const matches = upcoming
    .filter((m) => matchWindow(m.date).key === first.key)
    // Matchs à domicile d'abord (ceux où l'on peut venir encourager), puis par heure
    .sort((a, b) => Number(b.home) - Number(a.home) || a.date.localeCompare(b.date));
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const daysAway = Math.round(((first.saturday ?? first.day).getTime() - today.getTime()) / 86_400_000);

  let title: string;
  if (first.saturday) title = daysAway <= 6 ? "Ce week-end" : `Week-end du ${weekendFormat.format(first.saturday)}`;
  else title = dayFormat.format(first.day);
  return { title, matches };
}

/** Regroupe des matchs par mois ("octobre 2026" → [...]) en gardant l'ordre */
function groupByMonth(matches: Match[]): { month: string; matches: Match[] }[] {
  const groups = new Map<string, Match[]>();
  for (const m of matches) {
    const key = monthYearFormat.format(new Date(m.date));
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups].map(([month, matches]) => ({ month, matches }));
}

// Variables et helpers disponibles dans toutes les vues
app.use((req, res, next) => {
  res.locals.club = club;
  res.locals.currentPath = req.path;
  res.locals.formatDate = (iso: string) => dateFormat.format(new Date(iso));
  res.locals.formatShortDate = (iso: string) => shortDateFormat.format(new Date(iso));
  res.locals.formatWeekday = (iso: string) => weekdayFormat.format(new Date(iso)).replace(".", "");
  res.locals.formatDay = (iso: string) => new Date(iso).getDate();
  res.locals.formatMonth = (iso: string) => monthFormat.format(new Date(iso)).replace(".", "");
  res.locals.formatTime = (iso: string) => timeFormat.format(new Date(iso)).replace(":", "h");
  res.locals.formatDayMonth = (iso: string) => dayMonthFormat.format(new Date(iso));
  res.locals.mapsUrl = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  next();
});

app.get("/", async (_req, res) => {
  const [teams, upcoming, results, articles] = await Promise.all([
    getTeams(),
    getUpcomingMatches(),
    getPastMatches(3),
    getArticles(),
  ]);
  res.render("pages/index", {
    title: "Accueil",
    teams,
    nextMatch: upcoming[0],
    hero: nextWeekend(upcoming), // carrousel de la bannière : matchs du week-end qui arrive
    upcoming: upcoming.slice(1, 4),
    results,
    articles: articles.slice(0, 3),
  });
});

app.get("/equipes", async (_req, res) => {
  res.render("pages/equipes", { title: "Nos équipes", teams: await getTeams() });
});

app.get("/equipes/:slug", async (req, res, next) => {
  const team = await getTeam(req.params.slug);
  if (!team) return next();
  const [upcomingAll, resultsAll] = await Promise.all([getUpcomingMatches(), getPastMatches()]);
  const upcoming = upcomingAll.filter((m) => m.teamSlug === team.slug);
  const results = resultsAll.filter((m) => m.teamSlug === team.slug);
  const scored = results.filter((m) => m.score);
  const wins = scored.filter((m) => m.score!.us > m.score!.them).length;
  // Le filtre « Tous / À venir / Résultats » s applique dans la page (public/js/filters.js)
  res.render("pages/equipe", {
    title: team.name,
    team,
    upcoming,
    results,
    nextId: upcoming[0]?.id,
    competition: team.championship.match(/\(([A-Z0-9]+)\)/)?.[1],
    poule: team.championship.match(/poule \w+/i)?.[0],
    stats: {
      wins,
      losses: scored.length - wins,
      winPct: scored.length ? Math.round((wins / scored.length) * 100) : 0,
      scored: scored.reduce((sum, m) => sum + m.score!.us, 0),
      conceded: scored.reduce((sum, m) => sum + m.score!.them, 0),
    },
  });
});

app.get("/calendrier", async (_req, res) => {
  const [teams, upcoming, results, syncStatus] = await Promise.all([
    getTeams(),
    getUpcomingMatches(),
    getPastMatches(),
    readJson<SyncStatus | null>(STATUS_FILE, null),
  ]);
  // Filtres (équipe, domicile/extérieur, à venir/résultats) appliqués dans la page : public/js/filters.js
  res.render("pages/calendrier", {
    title: "Calendrier & résultats",
    teams: teams.filter((t) => upcoming.some((m) => m.teamSlug === t.slug) || results.some((m) => m.teamSlug === t.slug)),
    teamNames: Object.fromEntries(teams.map((t) => [t.slug, t.name])),
    upcomingGroups: groupByMonth(upcoming),
    resultGroups: groupByMonth(results),
    counts: { upcoming: upcoming.length, results: results.length },
    nextId: upcoming[0]?.id,
    lastSync: syncStatus?.lastSuccess,
  });
});

app.get("/trombinoscope", async (_req, res) => {
  res.render("pages/trombinoscope", { title: "Trombinoscope", ...(await getTrombinoscope()) });
});

app.get("/actualites", async (_req, res) => {
  res.render("pages/actualites", { title: "Actualités", articles: await getArticles() });
});

app.get("/actualites/:slug", async (req, res, next) => {
  const article = await getArticle(req.params.slug);
  if (!article) return next();
  res.render("pages/article", { title: article.title, article });
});

app.get("/contact", (_req, res) => {
  res.render("pages/contact", { title: "Contact" });
});

app.use((_req, res) => {
  res.status(404).render("pages/404", { title: "Page introuvable" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).send("Une erreur est survenue.");
});

// Serveur local (npm run dev / npm start). Le générateur statique importe `app` sans le démarrer.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  app.listen(port, () => {
    console.log(`${club.name} en ligne sur http://localhost:${port}`);
    startFfbbAutoSync();
  });
}
