// Copie locale des logos de clubs, avec fond rendu transparent.
// Beaucoup de logos FFBB ont un fond blanc opaque : on retire le blanc relié aux bords de l'image
// (remplissage depuis les bords), ce qui conserve le blanc à l'intérieur du logo (lettres, dessins).

import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ffbbLogoUrl } from "./client.js";

const LOGO_DIR = path.resolve("public", "img", "clubs");
const PUBLIC_PATH = "/img/clubs";
const SIZE = 128; // px, suffisant pour un affichage jusqu'à 64 px en haute densité
const WHITE_THRESHOLD = 235; // un pixel est "blanc" si R, G et B dépassent ce seuil

const exists = (p: string) => access(p).then(() => true, () => false);

/** Renvoie l'URL locale du logo (le crée au besoin), ou l'URL FFBB si le traitement échoue */
export async function localLogo(assetId: string): Promise<string> {
  const file = path.join(LOGO_DIR, `${assetId}.png`);
  const url = `${PUBLIC_PATH}/${assetId}.png`;
  if (await exists(file)) return url;

  try {
    const res = await fetch(`https://api.ffbb.com/assets/${assetId}?height=${SIZE}&fit=contain&format=png`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    removeEdgeWhite(data, info.width, info.height);

    await mkdir(LOGO_DIR, { recursive: true });
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .trim({ threshold: 0 }) // retire les marges devenues transparentes
      .png()
      .toFile(file);
    return url;
  } catch {
    return ffbbLogoUrl(assetId);
  }
}

/** Rend transparents les pixels blancs (ou déjà transparents) connectés aux bords de l'image */
function removeEdgeWhite(px: Buffer, width: number, height: number): void {
  const isBackground = (i: number) => {
    const o = i * 4;
    return px[o + 3] < 16 || (px[o] > WHITE_THRESHOLD && px[o + 1] > WHITE_THRESHOLD && px[o + 2] > WHITE_THRESHOLD);
  };
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);

  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !isBackground(i)) continue;
    seen[i] = 1;
    px[i * 4 + 3] = 0;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < width * (height - 1)) stack.push(i + width);
  }

  // Bord du logo : les pixels très clairs voisins du fond deviennent semi-transparents (pas de liseré blanc)
  for (let i = 0; i < width * height; i++) {
    if (seen[i]) continue;
    const x = i % width;
    const touchesBackground =
      (x > 0 && seen[i - 1]) || (x < width - 1 && seen[i + 1]) || (i >= width && seen[i - width]) || (i < width * (height - 1) && seen[i + width]);
    if (!touchesBackground) continue;
    const o = i * 4;
    const lightness = Math.min(px[o], px[o + 1], px[o + 2]);
    if (lightness > 180) px[o + 3] = Math.min(px[o + 3], Math.round((255 * (255 - lightness)) / 75));
  }
}
