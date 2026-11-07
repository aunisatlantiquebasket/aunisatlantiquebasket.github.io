// Récapitulatifs automatiques des résultats du week-end, publiés comme actualités.
// Calculés à chaque génération du site à partir des matchs synchronisés avec la FFBB :
// un article par week-end terminé (le lundi) où au moins un score est connu.

import type { Article, Match, Team } from "./types.js";

const DAY = 86_400_000;
const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });
const weekdayDate = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const firstOf = (s: string) => s.replace(/^1 /, "1er ");

/** Samedi du week-end auquel appartient le match (semaine du lundi au dimanche), à minuit */
function saturdayOf(date: string): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (d.getDay() === 0 ? -1 : 6 - d.getDay()));
  return d;
}

/** "17 et 18 octobre", "31 octobre et 1er novembre" */
function weekendLabel(saturday: Date): string {
  const sunday = new Date(saturday.getTime() + DAY);
  const [satDay, satMonth] = firstOf(dayMonth.format(saturday)).split(" ");
  const sun = firstOf(dayMonth.format(sunday));
  return satMonth === sun.split(" ")[1] ? `${satDay} et ${sun}` : `${satDay} ${satMonth} et ${sun}`;
}

/** "de Surgères", "d'Angoulins" */
const deOf = (name: string) => (/^[aeiouyéèêàâîôû]/i.test(name) ? `d'${name}` : `de ${name}`);

function resultSentence(m: Match, team: string): string {
  const { us, them } = m.score!;
  const where = m.home ? `à domicile face à ${m.opponent}` : `sur le terrain ${deOf(m.opponent)}`;
  const cup = m.competition?.startsWith("Coupe") ? `, en ${m.competition}` : "";
  // 20-0 : score officiel d'un match perdu par forfait
  if (Math.min(us, them) === 0 && Math.max(us, them) === 20) {
    return `${us > them ? "Victoire" : "Défaite"} par forfait des ${team} ${m.home ? "face à" : "contre"} ${m.opponent}${cup}.`;
  }
  return `${us > them ? "Victoire" : us < them ? "Défaite" : "Match nul"} des ${team} ${where}${cup} : ${us} à ${them}.`;
}

function upcomingSentence(m: Match, team: string): string {
  const d = new Date(m.date);
  const when = `le ${firstOf(weekdayDate.format(d))} à ${time.format(d).replace(":", "h")}`;
  return m.home ? `les ${team} reçoivent ${m.opponent} ${when}` : `les ${team} se déplacent sur le terrain ${deOf(m.opponent)} ${when}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

export function weekendRecaps(matches: Match[], teams: Team[], now = new Date()): Article[] {
  const teamName = new Map(teams.map((t) => [t.slug, t.name]));
  const nameOf = (m: Match) => teamName.get(m.teamSlug) ?? m.teamSlug;
  // Derby entre deux équipes du club : le match apparaît pour chacune, on ne le raconte qu'une fois
  const seen = new Set<string>();
  const unique = matches.filter((m) => {
    const base = m.id.match(/^ffbb-\d+/)?.[0] ?? m.id;
    if (seen.has(base)) return false;
    seen.add(base);
    return true;
  });

  const weekends = new Map<number, Match[]>();
  for (const m of unique) {
    const key = saturdayOf(m.date).getTime();
    weekends.set(key, [...(weekends.get(key) ?? []), m]);
  }

  const articles: Article[] = [];
  for (const [key, all] of weekends) {
    const saturday = new Date(key);
    const monday = new Date(key + 2 * DAY);
    if (now < monday) continue; // week-end pas encore terminé
    const played = all.filter((m) => m.score).sort((a, b) => a.date.localeCompare(b.date));
    if (played.length === 0) continue;

    const wins = played.filter((m) => m.score!.us > m.score!.them).length;
    const losses = played.filter((m) => m.score!.us < m.score!.them).length;
    const label = weekendLabel(saturday);
    const content = played.map((m) => resultSentence(m, nameOf(m)));

    // Matchs du week-end suivant, tant qu'ils sont à venir
    const next = (weekends.get(key + 7 * DAY) ?? []).filter((m) => new Date(m.date) > now).sort((a, b) => a.date.localeCompare(b.date));
    if (next.length) {
      const list = next.map((m) => upcomingSentence(m, nameOf(m))).join(" ; ");
      content.push(`Le week-end prochain : ${list}. Venez nombreux les encourager !`);
    }

    articles.push({
      slug: `resultats-week-end-${isoDate(saturday)}`,
      title: `Résultats du week-end du ${label}`,
      date: isoDate(monday),
      summary: [wins && plural(wins, "victoire"), losses && plural(losses, "défaite")].filter(Boolean).join(" et ") + ` pour nos équipes ce week-end.`,
      content,
    });
  }
  return articles;
}
