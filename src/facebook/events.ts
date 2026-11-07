// Import des événements de la page Facebook du club (data/facebook-evenements.json), avec le même
// jeton que les publications. Les photos de couverture sont copiées dans public/img/evenements/.
// Les événements saisis à la main restent dans data/evenements.json.

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "../data/repository.js";
import type { ClubEvent } from "../data/types.js";
import { GRAPH_URL, saveImage, shorten } from "./sync.js";

const DATA_FILE = "facebook-evenements.json";
const IMAGE_FOLDER = "evenements";

export interface FbEvent {
  id: string;
  name: string;
  description?: string;
  start_time: string; // "2026-09-18T18:00:00+0200" (heure locale de l'événement)
  end_time?: string;
  place?: { name?: string; location?: { city?: string } };
  cover?: { source?: string; offset_y?: number };
}

const slugify = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Émojis et symboles en début et fin de titre retirés : "🎉 Soirée Guinguette 🎉" → "Soirée Guinguette" */
const cleanTitle = (name: string) => name.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}).!?]+$/gu, "").replace(/\s+/g, " ");

// Aucun numéro de téléphone sur le site : la ligne qui en contient un est retirée
const PHONE = /(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/;

/** Lignes du texte de l'événement : sans caractères illisibles, sans hashtags seuls, sans téléphone */
function linesOf(description = ""): string[] {
  return description
    .replace(/\uFFFD/g, "")
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => /[\p{L}\p{N}]/u.test(l) && !/^(#\S+\s*)+$/.test(l) && !PHONE.test(l));
}

/** "2026-09-18T18:00:00+0200" → jour "2026-09-18" et heure "18h00" (heure locale indiquée par Facebook) */
const dayOf = (t: string) => t.slice(0, 10);
const hourOf = (t: string) => `${Number(t.slice(11, 13))}h${t.slice(14, 16)}`;

function placeOf(e: FbEvent): string | undefined {
  const name = e.place?.name?.replace(/,\s*France$/, "").trim();
  const city = e.place?.location?.city;
  if (!name) return city;
  return city && !name.includes(city) ? `${name}, ${city}` : name;
}

export async function toEvent(e: FbEvent): Promise<ClubEvent> {
  const title = cleanTitle(e.name);
  const date = dayOf(e.start_time);
  const end = e.end_time && dayOf(e.end_time);
  const lines = linesOf(e.description);
  // Phrase d'accroche : la première vraie phrase (pas un intitulé comme « Au programme : »), sans émoji devant ;
  // les autres lignes font les paragraphes de la page de l'événement
  const lead = lines.find((l) => l.length >= 30 && !l.endsWith(":")) ?? lines[0] ?? "";
  const summary = shorten(lead.replace(/^[^\p{L}\p{N}]+/u, ""), 170);
  const description = lines.filter((l) => l !== lead || summary.endsWith("…"));
  const image = e.cover?.source ? await saveImage(e.cover.source, IMAGE_FOLDER, `${e.id}.jpg`) : undefined;
  return {
    slug: `${slugify(title)}-${date.slice(0, 4)}`,
    title,
    kind: /assembl[ée]e g[ée]n[ée]rale/i.test(title) ? "Assemblée générale" : "Vie du club",
    date,
    endDate: end && end !== date ? end : undefined,
    time: e.end_time && end === date ? `${hourOf(e.start_time)} – ${hourOf(e.end_time)}` : hourOf(e.start_time),
    place: placeOf(e),
    summary,
    description,
    image,
    imageFocus: image && e.cover?.offset_y !== undefined && e.cover.offset_y !== 50 ? e.cover.offset_y : undefined,
    sourceUrl: `https://www.facebook.com/events/${e.id}/`,
  };
}

/** Enregistre les événements donnés (réponse de l'API) et supprime les couvertures qui ne servent plus */
export async function saveEvents(fbEvents: FbEvent[]): Promise<number> {
  const events: ClubEvent[] = [];
  for (const fb of fbEvents) {
    const event = await toEvent(fb);
    // Deux événements de même titre la même année : l'identifiant Facebook les distingue
    if (events.some((e) => e.slug === event.slug)) event.slug += `-${fb.id}`;
    events.push(event);
  }
  await writeJson(DATA_FILE, events.sort((a, b) => a.date.localeCompare(b.date)));
  const used = new Set(events.map((e) => e.image?.split("/").pop()));
  const dir = path.resolve("public", "img", IMAGE_FOLDER);
  for (const file of await readdir(dir).catch(() => [])) if (!used.has(file)) await rm(path.join(dir, file));
  return events.length;
}

/** Récupère tous les événements de la page (à venir et passés) ; renvoie leur nombre, ou une erreur */
export async function syncEventsFromFacebook(token = process.env.FB_PAGE_TOKEN): Promise<number> {
  if (!token) throw new Error("jeton FB_PAGE_TOKEN absent (voir le README)");
  const fields = "id,name,description,start_time,end_time,place,cover";
  const res = await fetch(`${GRAPH_URL}/me/events?fields=${fields}&limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { data?: FbEvent[]; error?: { message: string } };
  if (!res.ok || !body.data) throw new Error(`API Facebook : ${body.error?.message ?? `HTTP ${res.status}`}`);
  return saveEvents(body.data);
}
