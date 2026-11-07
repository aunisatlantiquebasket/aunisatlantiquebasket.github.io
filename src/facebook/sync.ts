// Import des publications de la page Facebook du club comme actualités du site (data/facebook.json).
// Lecture par l'API Graph de Meta avec un jeton d'accès de la page (secret GitHub FB_PAGE_TOKEN,
// démarche dans le README). Les photos sont copiées dans public/img/facebook/ : le site n'appelle
// jamais Facebook, aucun traceur n'est chargé chez les visiteurs.

import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readJson, writeJson } from "../data/repository.js";
import type { Article } from "../data/types.js";

const GRAPH_URL = "https://graph.facebook.com/v23.0";
const DATA_FILE = "facebook.json";
const IMAGE_DIR = path.resolve("public", "img", "facebook");
const POSTS_PER_SYNC = 30;

interface FbPost {
  id: string; // "{id de la page}_{id du post}"
  message?: string;
  created_time: string; // "2026-11-05T18:30:00+0000"
  full_picture?: string;
  permalink_url?: string;
}

const exists = (p: string) => access(p).then(() => true, () => false);

/** Coupe un texte au dernier mot entier avant `max` caractères */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).replace(/[\s,;:.!?-]+$/, "")}…`;
}

/** Date et heure locales (Europe/Paris) : "2026-11-05T19:30:00" */
function localIso(utc: string): string {
  const d = new Date(utc.replace(/\+0000$/, "Z"));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

/** Copie locale de la photo du post (1200 px de large au plus) */
async function localImage(postId: string, url: string): Promise<string | undefined> {
  const file = path.join(IMAGE_DIR, `${postId}.jpg`);
  const publicUrl = `/img/facebook/${postId}.jpg`;
  if (await exists(file)) return publicUrl;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await mkdir(IMAGE_DIR, { recursive: true });
    await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(file);
    return publicUrl;
  } catch (err) {
    console.warn(`Facebook : photo du post ${postId} non récupérée (${err instanceof Error ? err.message : err})`);
    return undefined;
  }
}

async function toArticle(post: FbPost): Promise<Article | undefined> {
  const text = (post.message ?? "").trim();
  if (!text) return undefined; // photo seule ou partage sans texte : pas d'actualité
  const postId = post.id.split("_").pop()!;
  const date = localIso(post.created_time);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const title = shorten(lines[0], 90);
  // Première ligne reprise entière en titre : elle n'est pas répétée dans le résumé ni le texte
  const body = title === lines[0] && lines.length > 1 ? lines.slice(1) : lines;
  return {
    slug: `facebook-${postId}`,
    title,
    date,
    summary: shorten(body.join(" "), 170),
    content: body,
    image: post.full_picture ? await localImage(postId, post.full_picture) : undefined,
    sourceUrl: post.permalink_url,
  };
}

/** Publications à ne pas reprendre sur le site, par identifiant de post (data/facebook-exclus.json) */
const EXCLUDE_FILE = "facebook-exclus.json";

/** Post qui présente le calendrier d'une équipe (au moins deux matchs listés) : déjà sur le site, à jour */
const isCalendar = (a: Article) => {
  const text = [a.title, ...a.content].join("\n");
  return (text.match(/🆚/gu) ?? []).length >= 2 || (text.match(/📅/gu) ?? []).length >= 2;
};
const normalizeTitle = (t: string) => t.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();

/** Retire posts sans texte, calendriers, publications exclues et doublons (même titre : on garde la plus récente) */
export function filterPosts(articles: Article[], excluded: string[]): Article[] {
  const seen = new Set<string>();
  return [...articles]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((a) => {
      if (a.content.length === 0 || isCalendar(a) || excluded.includes(a.slug.replace(/^facebook-/, ""))) return false;
      const key = normalizeTitle(a.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Récupère les dernières publications de la page ; renvoie le nombre d'articles, ou une erreur */
export async function syncFromFacebook(token = process.env.FB_PAGE_TOKEN): Promise<number> {
  if (!token) throw new Error("jeton FB_PAGE_TOKEN absent (voir le README)");

  const fields = "id,message,created_time,full_picture,permalink_url";
  // Jeton dans l'en-tête plutôt que dans l'adresse, pour qu'il n'apparaisse dans aucun journal
  const res = await fetch(`${GRAPH_URL}/me/posts?fields=${fields}&limit=${POSTS_PER_SYNC}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { data?: FbPost[]; error?: { message: string } };
  if (!res.ok || !body.data) throw new Error(`API Facebook : ${body.error?.message ?? `HTTP ${res.status}`}`);

  const fetched = (await Promise.all(body.data.map(toArticle))).filter((a): a is Article => !!a);
  // Les publications plus anciennes que la fenêtre récupérée sont conservées
  const previous = await readJson<Article[]>(DATA_FILE, []);
  const slugs = new Set(fetched.map((a) => a.slug));
  const excluded = await readJson<string[]>(EXCLUDE_FILE, []);
  const merged = filterPosts([...fetched, ...previous.filter((a) => !slugs.has(a.slug))], excluded);
  await writeJson(DATA_FILE, merged);
  return fetched.length;
}
