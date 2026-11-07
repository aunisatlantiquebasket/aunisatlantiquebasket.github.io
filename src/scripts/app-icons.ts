// Icônes saisonnières de l'application installable : npm run app-icons
// À partir des logos de assets/icones-app/{mois}.webp (octobre rose, novembre « Movember »…), crée
// public/img/app/{mois}/ ; le site généré pendant ce mois utilise ces icônes (build-static.ts).
// Extérieur du rond transparent pour les icônes « any » ; fond blanc pour l'icône Apple (iOS remplit
// la transparence en noir) et pour l'icône « maskable » (Android la découpe en forme libre).

import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { removeEdgeWhite } from "../ffbb/logos.js";

const SOURCE_DIR = path.resolve("assets", "icones-app");
const OUT_DIR = path.resolve("public", "img", "app");

/** Logo carré avec l'extérieur du rond rendu transparent */
async function transparentLogo(file: string): Promise<Buffer> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  removeEdgeWhite(data, info.width, info.height);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({ threshold: 0 }).png().toBuffer();
}

/** Logo de `size` px dont le rond occupe `ratio` de la largeur, sur fond transparent ou blanc */
async function icon(logo: Buffer, size: number, ratio: number, white: boolean): Promise<Buffer> {
  const inner = Math.round(size * ratio);
  const resized = await sharp(logo).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  const background = white ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 };
  return sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: resized, gravity: "center" }]).png().toBuffer();
}

for (const file of await readdir(SOURCE_DIR)) {
  const month = path.parse(file).name;
  const logo = await transparentLogo(path.join(SOURCE_DIR, file));
  const dir = path.join(OUT_DIR, month);
  await mkdir(dir, { recursive: true });
  await sharp(await icon(logo, 192, 1, false)).toFile(path.join(dir, "icon-192.png"));
  await sharp(await icon(logo, 512, 1, false)).toFile(path.join(dir, "icon-512.png"));
  await sharp(await icon(logo, 512, 0.8, true)).toFile(path.join(dir, "icon-maskable-512.png"));
  await sharp(await icon(logo, 180, 0.92, true)).toFile(path.join(dir, "apple-touch-icon.png"));
  console.log(`Icônes « ${month} » créées dans public/img/app/${month}/`);
}
