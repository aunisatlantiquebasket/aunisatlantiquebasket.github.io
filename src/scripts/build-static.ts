// Génère le site statique dans site/ (npm run build:static), pour un hébergement gratuit (GitHub Pages…).
// On démarre l'application Express en mémoire, on visite chaque page et on enregistre le HTML obtenu.
// Les pages dépendent de la date (matchs à venir, week-end qui arrive) : le robot de publication
// régénère donc le site régulièrement (.github/workflows/publier.yml).
// Site « en construction » (enConstruction dans src/config.ts) : page d'attente à la racine,
// vrai site dans site/apercu/ (adresse /apercu/, exclue des moteurs de recherche).

process.env.TZ ??= "Europe/Paris";

import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";

const OUT = path.resolve("site");
const APERCU = "/apercu";

// Chemin de base du site en ligne : "/site" pour https://aunisatlantiquebasket.github.io/site/,
// "" une fois le nom de domaine branché. Fourni par le robot de publication (GitHub Pages).
const BASE = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");
/** Préfixe les liens internes (href="/…", src="/…") par le chemin de base */
const withBase = (html: string, base: string) => (base ? html.replace(/\b(href|src)="\/(?!\/)/g, `$1="${base}/`) : html);
/** Demande aux moteurs de recherche de ne pas référencer la page */
const noIndex = (html: string) => html.replace("<head>", '<head>\n  <meta name="robots" content="noindex, nofollow">');

const { app } = await import("../server.js");
const { club, enConstruction } = await import("../config.js");
const { getArticles, getEvents, getTeams } = await import("../data/repository.js");

const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

/** Copie les fichiers publics et enregistre chaque page du site dans `dir`, liens préfixés par `base` */
async function buildSite(dir: string, base: string, transform: (html: string) => string = (h) => h) {
  const [teams, articles, events] = await Promise.all([getTeams(), getArticles(), getEvents()]);
  const pages = [
    "/",
    "/equipes",
    ...teams.map((t) => `/equipes/${t.slug}`),
    "/calendrier",
    "/actualites",
    ...articles.map((a) => `/actualites/${a.slug}`),
    "/evenements",
    ...[...events.upcoming, ...events.past].map((e) => `/evenements/${e.slug}`),
    "/trombinoscope",
    "/contact",
  ];

  await cp(path.resolve("public"), dir, { recursive: true, filter: (src) => !src.endsWith(".gitkeep") });
  for (const page of pages) {
    const res = await fetch(origin + page);
    if (!res.ok) throw new Error(`${page} : HTTP ${res.status}`);
    // /equipes/u13-masculins → equipes/u13-masculins/index.html (adresse sans .html)
    const file = path.join(dir, page, "index.html");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, transform(withBase(await res.text(), base)));
  }
  return pages.length;
}

try {
  await rm(OUT, { recursive: true, force: true });

  if (enConstruction) {
    // L'application installable (manifeste, service worker, icônes, bandeau) reste à la racine du domaine :
    // installable aussi depuis la page d'attente, et jamais ouverte sur /apercu/
    const rootManifest = (html: string) =>
      html.replace(`href="${BASE}${APERCU}/manifest.webmanifest"`, `href="${BASE}/manifest.webmanifest"`);
    const count = await buildSite(path.join(OUT, APERCU), BASE + APERCU, (html) => rootManifest(noIndex(html)));
    await cp(path.resolve("public/img/logo-rond.svg"), path.join(OUT, "img/logo-rond.svg"));
    for (const file of ["manifest.webmanifest", "sw.js", "img/app", "js/install.js", "css/install.css", "img/sporteasy.png"]) {
      await cp(path.resolve("public", file), path.join(OUT, file), { recursive: true });
    }
    const page = await new Promise<string>((resolve, reject) =>
      app.render("pages/construction", { club }, (err, out) => (err ? reject(err) : resolve(out!))),
    );
    const html = withBase(page, BASE);
    // Toutes les adresses (accueil et pages inconnues) affichent la page d'attente
    await writeFile(path.join(OUT, "index.html"), html);
    await writeFile(path.join(OUT, "404.html"), html);
    await writeFile(path.join(OUT, "robots.txt"), `User-agent: *\nDisallow: ${BASE}${APERCU}/\n`);
    console.log(`Site en construction : page d'attente à la racine, site complet (${count} pages) dans site${APERCU}/`);
  } else {
    const count = await buildSite(OUT, BASE);
    // Page d'erreur servie par l'hébergeur pour les adresses inconnues
    const notFound = await fetch(`${origin}/__page-inexistante__`);
    await writeFile(path.join(OUT, "404.html"), withBase(await notFound.text(), BASE));
    console.log(`Site statique généré dans site/ : ${count} pages + 404.html${BASE ? ` (chemin de base ${BASE})` : ""}`);
  }
} finally {
  server.close();
}
