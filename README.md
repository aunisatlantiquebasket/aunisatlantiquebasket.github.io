# Aunis Atlantique Basket — site web du club

Site Node.js + TypeScript (Express 5, templates EJS, données en fichiers JSON),
**publié gratuitement en site statique sur GitHub Pages**, mis à jour automatiquement toutes les 3 h.

## Travailler sur le site (sur votre ordinateur)

```bash
npm install
npm run dev              # aperçu avec rechargement auto → http://localhost:3000
npm run build:static     # génère le site statique dans site/
npm run preview:static   # prévisualise site/ comme en ligne → http://localhost:4000
```

## Mise en ligne (automatique)

Le robot `.github/workflows/publier.yml` (GitHub Actions, gratuit) tourne **toutes les 3 heures** et
**à chaque modification envoyée sur GitHub** : synchronisation FFBB → enregistrement des données →
génération du site statique → publication sur GitHub Pages.

- Pour modifier le site : changer les fichiers (`data/`, `src/config.ts`, photos…), puis les envoyer sur GitHub
  (`git add`, `git commit`, `git push`) : le site en ligne est à jour quelques minutes après.
- Pour forcer une mise à jour : onglet **Actions** du dépôt → « Publier le site » → **Run workflow**.
- En cas d'échec de la FFBB, le site est publié quand même avec les données précédentes (avertissement dans Actions).

Le site étant statique, les filtres du calendrier et des équipes s'appliquent dans la page (`public/js/filters.js`)
et la page Contact propose un e-mail prérempli (pas de formulaire, pas de téléphone).

## Synchronisation avec la FFBB

Les équipes engagées, le calendrier, les scores et les classements sont récupérés
automatiquement sur [competitions.ffbb.com](https://competitions.ffbb.com/ligues/naq/comites/0017/clubs/naq0017020)
(la FFBB ne propose pas d'API publique : on lit ses pages publiques).

- **En ligne** : par le robot de publication, toutes les 3 h.
- **Sur votre ordinateur** : `npm run sync-ffbb`, ou automatiquement pendant `npm run dev`
  (`FFBB_SYNC=off` la désactive, `FFBB_SYNC_HOURS=6` change la fréquence).
- État de la dernière synchro (date, erreur éventuelle) : `data/ffbb-sync.json`.

Ce que la synchro modifie, et ce qu'elle ne touche jamais :

| Fichier | Géré par la synchro | Jamais modifié |
|---|---|---|
| `data/matches.json` | les matchs `"source": "ffbb"` (recréés à chaque synchro) | les autres matchs (amicaux, tournois…) |
| `data/teams.json` | `championship`, `ffbbId`, `ffbbKey`, `ffbbUrl`, `ranking`, `standings`, `active` ; ajout des nouvelles équipes engagées | `name`, `slug`, `coach`, `trainings`, `players`, équipes hors FFBB (loisirs) |

En cas d'erreur (FFBB indisponible, pages modifiées), **rien n'est écrit** : le site garde les données précédentes.

**Vie des équipes d'une saison à l'autre :**
- **Nouvelle équipe engagée** : créée automatiquement (nom déduit de la catégorie, ex. « U17 Masculins »), avec sa page. Il reste à compléter coach, horaires et effectif.
- **Nouvelle saison / nouvelle phase** : la FFBB change l'identifiant des équipes. La synchro retrouve chaque équipe par sa clé
  `ffbbKey` (catégorie-sexe-numéro, ex. `SE-M-1`) : nom, coach, horaires et effectif sont conservés.
- **Équipe engagée en championnat et en coupe** : une seule équipe sur le site, avec tous ses matchs.
- **Équipe plus engagée** : marquée `"active": false` et masquée du site (pas supprimée) ; elle réapparaît si elle est réengagée.
  Pour la supprimer définitivement, retirer son entrée de `data/teams.json`.

**Noms en majuscules** : la FFBB écrit les noms de clubs et de salles en majuscules sans accents.
Ils sont mis en forme automatiquement ; pour corriger un nom, ajoutez-le dans `data/ffbb-noms.json`
(`"NOM FFBB": "Nom affiché"`). La correction s'applique à la synchro suivante.

## Structure

```
src/
  server.ts            routes Express
  config.ts            infos du club, page FFBB du club, réglages de synchro
  data/types.ts        types Team, Match, Article…
  data/repository.ts   lecture/écriture des fichiers JSON
  ffbb/client.ts       lecture des pages FFBB
  ffbb/sync.ts         fusion des données FFBB dans data/
  ffbb/scheduler.ts    synchro automatique
  ffbb/logos.ts        copie locale des logos de clubs, fond blanc rendu transparent
  scripts/sync-ffbb.ts commande npm run sync-ffbb
  scripts/build-static.ts   génération du site statique (site/)
  scripts/preview-static.ts prévisualisation du site statique
.github/workflows/publier.yml  robot de publication (GitHub Actions)
data/
  teams.json           équipes, entraînements, effectifs
  matches.json         calendrier et résultats
  articles.json        actualités
  ffbb-noms.json       corrections des noms FFBB
  ffbb-sync.json       état de la dernière synchro (créé automatiquement)
views/                 pages et partials EJS
public/                CSS, scripts, logos (img/clubs : adversaires, générés par la synchro ; img/trombi : photos)
```

## Mettre à jour le contenu

- **Infos du club** : `src/config.ts` (dont `sportEasyUrl`, le lien « Espace membres » de l'en-tête et du pied de page ; vide = lien masqué)
- **Coach, entraînements, effectif** : `data/teams.json`
- **Match amical / hors championnat** : ajouter une entrée dans `data/matches.json` avec `"source": "manual"` ;
  après le match, ajouter `"score": { "us": 80, "them": 72 }`
- **Nouvelle actualité** : ajouter une entrée dans `data/articles.json` (le `slug` sert d'URL)
- **Trombinoscope** (`/trombinoscope`) :
  - les **coachs** sont repris automatiquement du champ `coach` de chaque équipe (`data/teams.json`, plusieurs noms séparés par des virgules) ;
  - le **bureau**, le **comité directeur** et les **bénévoles** se complètent dans `data/trombinoscope.json`
    (listes `bureau`, `comite`, `benevoles`, entrées `{ "name": "…", "role": "Trésorière" }`) ;
  - les **photos** se déposent dans `public/img/trombi/`, nommées d'après la personne en minuscules sans accents
    (`audrey.jpg`, `anaelle-viaud.jpg`…, formats jpg, png ou webp). Sans photo, un avatar aux initiales s'affiche.
    Ne publier une photo qu'avec l'accord de la personne.

En aperçu local (`npm run dev`), les fichiers JSON sont relus à chaque requête : pas besoin de redémarrer.
