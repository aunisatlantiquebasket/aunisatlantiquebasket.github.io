// Génère le site statique dans site/ (npm run build:static), pour un hébergement gratuit (GitHub Pages…).
// On démarre l'application Express en mémoire, on visite chaque page et on enregistre le HTML obtenu.
// Les pages dépendent de la date (matchs à venir, week-end qui arrive) : le robot de publication
// régénère donc le site régulièrement (.github/workflows/publier.yml).

process.env.TZ ??= "Europe/Paris";

import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";

const OUT = path.resolve("site");

// Chemin de base du site en ligne : "/site" pour https://aunisatlantiquebasket.github.io/site/,
// "" une fois le nom de domaine branché. Fourni par le robot de publication (GitHub Pages).
const BASE = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");
/** Préfixe les liens internes (href="/…", src="/…") par le chemin de base */
const withBase = (html: string) => (BASE ? html.replace(/\b(href|src)="\/(?!\/)/g, `$1="${BASE}/`) : html);

const { app } = await import("../server.js");
const { getArticles, getTeams } = await import("../data/repository.js");

const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

try {
  const [teams, articles] = await Promise.all([getTeams(), getArticles()]);
  const pages = [
    "/",
    "/equipes",
    ...teams.map((t) => `/equipes/${t.slug}`),
    "/calendrier",
    "/actualites",
    ...articles.map((a) => `/actualites/${a.slug}`),
    "/trombinoscope",
    "/contact",
  ];

  await rm(OUT, { recursive: true, force: true });
  await cp(path.resolve("public"), OUT, { recursive: true, filter: (src) => !src.endsWith(".gitkeep") });

  for (const page of pages) {
    const res = await fetch(base + page);
    if (!res.ok) throw new Error(`${page} : HTTP ${res.status}`);
    // /equipes/u13-masculins → site/equipes/u13-masculins/index.html (adresse sans .html)
    const file = path.join(OUT, page, "index.html");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, withBase(await res.text()));
  }

  // Page d'erreur servie par l'hébergeur pour les adresses inconnues
  const notFound = await fetch(`${base}/__page-inexistante__`);
  await writeFile(path.join(OUT, "404.html"), withBase(await notFound.text()));

  console.log(`Site statique généré dans site/ : ${pages.length} pages + 404.html${BASE ? ` (chemin de base ${BASE})` : ""}`);
} finally {
  server.close();
}
