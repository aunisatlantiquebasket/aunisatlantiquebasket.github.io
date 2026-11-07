// Import des publications de la page Facebook du club comme actualités du site (data/facebook.json).
// Lecture par l'API Graph de Meta avec un jeton d'accès de la page (secret GitHub FB_PAGE_TOKEN,
// démarche dans le README). Les photos sont copiées dans public/img/facebook/ : le site n'appelle
// jamais Facebook, aucun traceur n'est chargé chez les visiteurs.

import { access, mkdir, readdir, rm } from "node:fs/promises";
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

/** Empreinte visuelle (dHash 64 bits) : deux versions réencodées d'une même image restent très proches */
async function imageHash(publicUrl: string): Promise<string | undefined> {
  try {
    const file = path.resolve("public", publicUrl.replace(/^\//, ""));
    const px = await sharp(file).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
    return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
  } catch {
    return undefined;
  }
}

/** Nombre de bits différents entre deux empreintes */
function distance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  for (; x; x >>= 1n) n += Number(x & 1n);
  return n;
}
const SAME_IMAGE_MAX_DISTANCE = 6;

/** Calcule l'empreinte des photos qui n'en ont pas encore */
export async function addImageHashes(articles: Article[]): Promise<void> {
  for (const a of articles) if (a.image && !a.imageHash) a.imageHash = await imageHash(a.image);
}

/** Publications à ne pas reprendre sur le site, par identifiant de post (data/facebook-exclus.json) */
const EXCLUDE_FILE = "facebook-exclus.json";

/** Post qui présente le calendrier d'une équipe (au moins deux matchs listés) : déjà sur le site, à jour */
const isCalendar = (a: Article) => {
  const text = [a.title, ...a.content].join("\n");
  return (text.match(/🆚/gu) ?? []).length >= 2 || (text.match(/📅/gu) ?? []).length >= 2;
};
/** Résultat brut : texte très court qui donne un score (« Victoire 66-20 💪 » sur un visuel de score) */
const isRawResult = (a: Article) => {
  const text = [a.title, ...a.content].join(" ");
  return text.length < 200 && /\b\d{1,3}\s*[-–:à]\s*\d{1,3}\b/.test(text);
};
const normalizeTitle = (t: string) => t.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();

/** Retire posts sans texte, résultats bruts, calendriers, publications exclues et doublons
 *  (même titre ou même photo : on garde la plus récente) */
export function filterPosts(articles: Article[], excluded: string[]): Article[] {
  const seen = new Set<string>();
  const hashes: string[] = [];
  return [...articles]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((a) => {
      if (a.content.length === 0 || isCalendar(a) || isRawResult(a) || excluded.includes(a.slug.replace(/^facebook-/, ""))) return false;
      const key = normalizeTitle(a.title);
      if (seen.has(key)) return false;
      if (a.imageHash && hashes.some((h) => distance(h, a.imageHash!) <= SAME_IMAGE_MAX_DISTANCE)) return false;
      seen.add(key);
      if (a.imageHash) hashes.push(a.imageHash);
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
  const all = [...fetched, ...previous.filter((a) => !slugs.has(a.slug))];
  await addImageHashes(all);
  const merged = filterPosts(all, excluded);
  await writeJson(DATA_FILE, merged);
  // Photos des publications écartées : supprimées
  const used = new Set(merged.map((a) => a.image?.split("/").pop()));
  for (const file of await readdir(IMAGE_DIR).catch(() => [])) if (!used.has(file)) await rm(path.join(IMAGE_DIR, file));
  return fetched.length;
}
