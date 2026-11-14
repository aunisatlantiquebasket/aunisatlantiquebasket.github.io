import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { benevoles, club, port } from "./config.js";
import {
  getArticle,
  getArticles,
  getEvent,
  getEvents,
  getPastMatches,
  getTeam,
  getTeams,
  getTrombinoscope,
  getUpcomingMatches,
  readJson,
} from "./data/repository.js";
import type { ClubEvent, Match, Shop, Team } from "./data/types.js";
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

/** Matchs du dernier week-end joué (ordre chronologique), avec un titre ("Résultats du week-end dernier"…) */
function lastWeekend(results: Match[]): { title: string; matches: Match[] } {
  if (results.length === 0) return { title: "Derniers résultats", matches: [] };
  const last = matchWindow(results[0].date); // results : du plus récent au plus ancien
  const matches = results.filter((m) => matchWindow(m.date).key === last.key).reverse();
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const daysAgo = Math.round((today.getTime() - (last.saturday ?? last.day).getTime()) / 86_400_000);

  let title: string;
  if (!last.saturday) title = `Résultats du ${dayFormat.format(last.day)}`;
  else if (daysAgo <= 1) title = "Résultats de ce week-end";
  else if (daysAgo <= 8) title = "Résultats du week-end dernier";
  else title = `Résultats du week-end du ${weekendFormat.format(last.saturday)}`;
  return { title, matches };
}

const nextSlotFormat = fmt({ weekday: "long", day: "numeric", month: "short" });
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

interface TrainingView {
  time: string;
  place?: string;
  note?: string;
  alternate?: { places: string[]; next: { label: string; place: string } };
}

/**
 * Prépare les créneaux d'entraînement pour l'affichage. Pour un lieu en alternance,
 * calcule le lieu du prochain créneau (le site est régénéré régulièrement, l'info reste à jour).
 */
function describeTrainings(trainings: Team["trainings"]): TrainingView[] {
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

  return trainings.map((t) => {
    if (typeof t === "string") return { time: t };
    const view: TrainingView = { time: t.time, place: t.place, note: t.note };
    const weekday = WEEKDAYS.indexOf(t.time.split(" ")[0].toLowerCase());
    if (t.alternate && t.alternate.places.length > 0 && weekday >= 0) {
      const next = new Date(today);
      next.setDate(today.getDate() + ((weekday - today.getDay() + 7) % 7));
      const [y, m, d] = t.alternate.from.split("-").map(Number);
      const weeks = Math.round((mondayOf(next).getTime() - mondayOf(new Date(y, m - 1, d)).getTime()) / (7 * 86_400_000));
      const n = t.alternate.places.length;
      view.alternate = {
        places: t.alternate.places,
        next: { label: nextSlotFormat.format(next), place: t.alternate.places[((weeks % n) + n) % n] },
      };
    }
    return view;
  });
}

const eventDayFormat = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const eventMonthFormat = fmt({ month: "short" });
const localDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };

/** « samedi 17 octobre 2026 » ou « du 24 au 26 octobre 2026 » */
function formatEventDate(e: ClubEvent): string {
  if (!e.endDate || e.endDate === e.date) return eventDayFormat.format(localDate(e.date));
  const [start, end] = [localDate(e.date), localDate(e.endDate)];
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  return sameMonth
    ? `du ${start.getDate()} au ${fmt({ day: "numeric", month: "long", year: "numeric" }).format(end)}`
    : `du ${fmt({ day: "numeric", month: "long" }).format(start)} au ${fmt({ day: "numeric", month: "long", year: "numeric" }).format(end)}`;
}

/** Lien « Ajouter à mon agenda » (Google Agenda, journée entière) */
function calendarUrl(e: ClubEvent): string {
  const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const end = localDate(e.endDate ?? e.date);
  end.setDate(end.getDate() + 1); // date de fin exclue
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${e.title} - ${club.name}`,
    dates: `${ymd(localDate(e.date))}/${ymd(end)}`,
    details: [e.time, e.summary].filter(Boolean).join(" · "),
    location: e.place ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
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
app.use(async (req, res, next) => {
  // Boutique dans le menu, sauf si elle est accessible seulement par son lien
  const shop = await readJson<Shop | null>("boutique.json", null);
  res.locals.shopListed = !!shop && !shop.unlisted;
  res.locals.club = club;
  res.locals.benevoles = benevoles;
  res.locals.currentPath = req.path;
  res.locals.formatDate = (iso: string) => dateFormat.format(new Date(iso));
  res.locals.formatShortDate = (iso: string) => shortDateFormat.format(new Date(iso));
  res.locals.formatWeekday = (iso: string) => weekdayFormat.format(new Date(iso)).replace(".", "");
  res.locals.formatDay = (iso: string) => new Date(iso).getDate();
  res.locals.formatMonth = (iso: string) => monthFormat.format(new Date(iso)).replace(".", "");
  res.locals.formatTime = (iso: string) => timeFormat.format(new Date(iso)).replace(":", "h");
  res.locals.formatDayMonth = (iso: string) => dayMonthFormat.format(new Date(iso));
  res.locals.formatEventDate = formatEventDate;
  res.locals.eventDay = (e: ClubEvent) => localDate(e.date).getDate();
  res.locals.eventMonth = (e: ClubEvent) => eventMonthFormat.format(localDate(e.date)).replace(".", "");
  res.locals.calendarUrl = calendarUrl;
  // Inscription encore possible : jusqu'à la fin du jour limite (ou du jour de l'événement)
  res.locals.registrationOpen = (e: ClubEvent) => {
    const last = localDate(e.registrationDeadline ?? e.date);
    last.setDate(last.getDate() + 1);
    return Date.now() < last.getTime();
  };
  res.locals.formatDeadline = (e: ClubEvent) => (e.registrationDeadline ? fmt({ weekday: "long", day: "numeric", month: "long" }).format(localDate(e.registrationDeadline)) : "");
  res.locals.mapsUrl = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  next();
});

/** Date limite de commande pour Noël, format court : « 27 nov. » (vide s'il n'y en a pas) */
const shopDeadlineShort = (shop: Shop) => (shop.christmasDeadline ? fmt({ day: "numeric", month: "short" }).format(new Date(shop.christmasDeadline)) : "");

app.get("/", async (_req, res) => {
  const [teams, upcoming, results, articles, events] = await Promise.all([
    getTeams(),
    getUpcomingMatches(),
    getPastMatches(),
    getArticles(),
    getEvents(),
  ]);
  // Carte « Boutique » dans la bannière de l'accueil, tant que la vente est ouverte
  const shopData = await readJson<Shop | null>("boutique.json", null);
  const shop = shopData && !shopData.unlisted && !shopData.closed
    ? { deadline: shopData.christmasDeadline && Date.now() < new Date(shopData.christmasDeadline).getTime() ? shopData.christmasDeadline : null, deadlineShort: shopDeadlineShort(shopData) }
    : null;
  const hero = nextWeekend(upcoming); // carrousel de la bannière : matchs du week-end qui arrive
  res.render("pages/index", {
    title: "Accueil",
    teams,
    nextMatch: upcoming[0],
    hero,
    // Liste « Matchs et résultats » : dernier week-end joué, puis prochain week-end (ordre chronologique)
    lastResults: lastWeekend(results),
    nextMatches: { title: hero.title, matches: [...hero.matches].sort((a, b) => a.date.localeCompare(b.date)) },
    articles: articles.slice(0, 3),
    events: events.upcoming.filter((e) => !e.hideOnHome).slice(0, 3),
    featured: events.upcoming.find((e) => e.featured), // mis en avant en haut de l'accueil jusqu'à l'événement
    shop,
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
    trainings: describeTrainings(team.trainings),
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

// Inscriptions des bénévoles : matchs à domicile à venir et passés, regroupés par jour (public/js/benevoles.js)
app.get("/aider-aux-matchs", async (_req, res) => {
  const [teams, upcoming, past] = await Promise.all([getTeams(), getUpcomingMatches(), getPastMatches()]);
  const names = Object.fromEntries(teams.map((t) => [t.slug, t.name]));
  const byDay = (matches: Match[]) => {
    const days: { label: string; matches: (Match & { teamName: string })[] }[] = [];
    for (const m of matches.filter((m) => m.home)) {
      const label = dayFormat.format(new Date(m.date));
      let day = days.find((d) => d.label === label);
      if (!day) days.push((day = { label, matches: [] }));
      day.matches.push({ ...m, teamName: names[m.teamSlug] ?? m.teamSlug });
    }
    for (const d of days) d.matches.sort((a, b) => a.date.localeCompare(b.date)); // dans la journée : par heure
    return days;
  };
  // Passés : du plus récent au plus ancien
  res.render("pages/benevoles", { title: "Aider aux matchs à domicile", days: byDay(upcoming), pastDays: byDay(past), benevoles });
});

/** Équipe telle qu'écrite dans le planning du club : « U13 Masculins » → U13M, « U11-2 », « Séniors » */
const planningTeam = (t: Team) => {
  const cat = t.name.match(/^(U\d+(?:-\d)?)(?:\s+([MF]))?/);
  return cat ? cat[1] + (cat[2] ?? "") : t.category === "Seniors" ? "Séniors" : t.category;
};

// Matchs à domicile de la saison, lus par le script de la feuille Google du club pour tenir son planning à jour.
// Les matchs passés (passe: true) servent seulement à relier les lignes déjà saisies (historique des postes).
app.get("/aider-aux-matchs/matchs.json", async (_req, res) => {
  const [teams, upcoming, past] = await Promise.all([getTeams(), getUpcomingMatches(), getPastMatches()]);
  const pastIds = new Set(past.map((m) => m.id));
  res.json(
    [...[...past].reverse(), ...upcoming]
      .filter((m) => m.home)
      .map((m) => {
        const team = teams.find((t) => t.slug === m.teamSlug);
        const [date, time] = m.date.split("T");
        return {
          id: m.id,
          date, // "2026-11-14"
          heure: time.startsWith("00:00") ? "" : time.slice(0, 5), // vide : horaire pas encore fixé
          equipe: team ? planningTeam(team) : m.teamSlug,
          adversaire: m.opponent,
          ...(pastIds.has(m.id) ? { passe: true } : {}),
        };
      }),
  );
});

app.get("/evenements", async (_req, res) => {
  res.render("pages/evenements", { title: "Événements", ...(await getEvents()) });
});

app.get("/evenements/:slug", async (req, res, next) => {
  const event = await getEvent(req.params.slug);
  if (!event) return next();
  res.render("pages/evenement", { title: event.title, event, noindex: !!event.unlisted });
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

app.get("/boutique", async (_req, res, next) => {
  const shop = await readJson<Shop | null>("boutique.json", null);
  if (!shop) return next();
  const deadline = shop.christmasDeadline ? new Date(shop.christmasDeadline) : null;
  res.render("pages/boutique", {
    title: "Boutique",
    shop,
    noindex: !!shop.unlisted,
    open: !shop.closed,
    // Bandeau « Livraison avant Noël » jusqu'à la date limite de commande
    beforeChristmas: !!deadline && Date.now() < deadline.getTime(),
    deadlineShort: shopDeadlineShort(shop),
    deadlineLabel: deadline ? fmt({ weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(deadline).replace(":", " h ").replace(" h 00", " h") : "",
  });
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
