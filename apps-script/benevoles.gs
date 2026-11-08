/**
 * Planning des matchs à domicile — Aunis Atlantique Basket
 *
 * À coller dans la feuille Google du planning (Extensions → Apps Script), démarche dans le README du site.
 * - Ajoute dans l'onglet « Planning Matchs » les matchs à domicile publiés par le site (données FFBB),
 *   et met à jour leur horaire ; toutes les heures, ou par le menu « Site AAB ».
 * - Sert la page /aider-aux-matchs du site : les postes pris (prénom et initiale du nom seulement) et les
 *   inscriptions, écrites directement dans les cases du planning.
 * Postes du match (responsable, arbitres, marqueur, chrono) : réservés aux licenciés de l'onglet
 * « Licenciés » ; buvette : ouverte à tous. Les données des licenciés ne sortent jamais de la feuille.
 * On garde la main dans la feuille : changer ou effacer un nom, ajouter un match, comme avant.
 */

const SITE_MATCHS = 'https://aunisatlantiquebasket.com/aider-aux-matchs/matchs.json';
// Essais avant la mise en ligne du site : liste des matchs écrite ici à la place de celle du site (null = site)
const MATCHS_TEST = null;
const ONGLET_PLANNING = 'Planning Matchs';
const ONGLET_LICENCIES = 'Licenciés';
const ONGLET_CLES = 'Inscriptions site';
// Retrait par le site impossible dans les dernières heures avant le match (le club organise) : on contacte le club
const DELAI_RETRAIT_HEURES = 72; // masqué : clés qui permettent à chacun de retirer sa propre inscription

// Colonnes du planning (titres de la ligne 1) ; celles qui manquent sont ajoutées à droite
const COL = {
  date: 'Date', heure: 'Heure', equipe: 'Equipe', adversaire: 'Adversaire',
  marqueur: 'Marqueur', chrono: 'Chrono', arbitre1: 'Arbitre 1', arbitre2: 'Arbitre 2', responsable: 'Responsable',
  buvette1: 'Buvette 1', buvette2: 'Buvette 2', officiels: 'Arbitres officiels', match: 'Match (site)',
};
// Postes de la page du site → colonnes du planning (identiques à src/config.ts, benevoles.roles)
const POSTES = {
  salle: { colonnes: ['responsable'], licence: true },
  arbitre: { colonnes: ['arbitre1', 'arbitre2'], licence: true },
  marqueur: { colonnes: ['marqueur'], licence: true },
  chrono: { colonnes: ['chrono'], licence: true },
  buvette: { colonnes: ['buvette1', 'buvette2'], licence: false },
};

// ---------- Outils ----------

const norm_ = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const json_ = (data) => ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);

/** Texte saisi sur le site : nettoyé, et jamais pris pour une formule */
function texte_(valeur) {
  const t = String(valeur || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return t.replace(/^[=+\-@]+/, '');
}

/** « 7/11/2026 » ou « 2026-11-07 » → « 2026-11-07 » */
function jour_(affiche) {
  let m = String(affiche).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = String(affiche).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

/** Arbitres officiels désignés : case cochée, ou texte saisi à la main (« Oui », noms des arbitres…) */
const officiels_ = (valeur) => !!valeur && !['false', 'faux', 'non', '0'].includes(norm_(valeur));

/** « Clara LAUDE (U11) » → « Clara L. » : seul ce format court est envoyé au site */
function court_(valeur) {
  const mots = String(valeur).replace(/\(.*?\)/g, '').trim().split(/\s+/);
  return mots.length > 1 ? mots[0] + ' ' + mots[1].charAt(0).toUpperCase() + '.' : mots[0];
}

/** Onglet du planning, avec ses colonnes (index à partir de 1) ; ajoute les colonnes manquantes */
function planning_() {
  const feuille = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONGLET_PLANNING);
  if (!feuille) throw new Error('Onglet « ' + ONGLET_PLANNING + ' » introuvable');
  const titres = feuille.getRange(1, 1, 1, feuille.getLastColumn()).getDisplayValues()[0].map(norm_);
  const cols = {};
  for (const cle of Object.keys(COL)) {
    let i = titres.indexOf(norm_(COL[cle])) + 1;
    if (!i) {
      i = feuille.getLastColumn() + 1;
      feuille.getRange(1, i).setValue(COL[cle]).setFontWeight('bold');
      titres.push(norm_(COL[cle]));
      if (cle === 'match') feuille.hideColumns(i); // identifiant du match sur le site : utile au script seulement
      // Case à cocher quand des arbitres officiels sont désignés : le club n'a pas à en fournir
      if (cle === 'officiels' && feuille.getLastRow() > 1) feuille.getRange(2, i, feuille.getLastRow() - 1).insertCheckboxes();
    }
    cols[cle] = i;
  }
  return { feuille, cols };
}

/** Lignes du planning : { ligne, jour, heure, equipe, match, valeurs } ; la date fusionnée est reprise sur chaque ligne */
function lignes_(p) {
  const n = p.feuille.getLastRow() - 1;
  if (n < 1) return [];
  const valeurs = p.feuille.getRange(2, 1, n, p.feuille.getLastColumn()).getDisplayValues();
  let jour = '';
  return valeurs.map((v, i) => {
    if (v[p.cols.date - 1]) jour = jour_(v[p.cols.date - 1]);
    const remplie = v[p.cols.heure - 1] || v[p.cols.equipe - 1] || v[p.cols.adversaire - 1];
    return { ligne: i + 2, jour: remplie ? jour : '', heure: v[p.cols.heure - 1], equipe: v[p.cols.equipe - 1], match: v[p.cols.match - 1], valeurs: v };
  });
}

// ---------- Matchs du site → planning ----------

/** Ajoute les matchs à domicile du site absents du planning et met à jour les horaires ; renvoie le nombre ajouté */
function synchroniserMatchs() {
  const matchs = MATCHS_TEST || JSON.parse(UrlFetchApp.fetch(SITE_MATCHS).getContentText());
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const p = planning_();
    const lignes = lignes_(p);
    let ajoutes = 0;
    for (const m of matchs) {
      let l = lignes.find((x) => x.match === m.id);
      // Match déjà saisi à la main : même jour, même équipe (« U11 » reconnaît « U11-1 ») ; s'il y a plusieurs
      // lignes possibles, celle du même adversaire, puis celle de la même heure (l'heure saisie peut différer de la FFBB)
      if (!l) {
        const mots = (s) => norm_(s).split(' ').filter((w) => w.length >= 3);
        const adversaire = (x) => mots(x.valeurs[p.cols.adversaire - 1]).filter((w) => mots(m.adversaire).includes(w)).length;
        const heure = (x) => (x.heure && m.heure && x.heure.slice(0, 5) === m.heure ? 1 : 0);
        const score = (x) => adversaire(x) * 2 + heure(x);
        const possibles = lignes
          .filter((x) => !x.match && x.jour === m.date && x.equipe &&
            (norm_(m.equipe).startsWith(norm_(x.equipe)) || norm_(x.equipe).startsWith(norm_(m.equipe))))
          .sort((x, y) => score(y) - score(x));
        l = possibles.length === 1 || (possibles[0] && score(possibles[0]) > 0) ? possibles[0] : undefined;
        if (l) {
          p.feuille.getRange(l.ligne, p.cols.match).setValue(m.id);
          l.match = m.id;
        }
      }
      if (!l && m.passe) continue; // match déjà joué absent du planning : on ne l'ajoute pas
      if (l) {
        // Horaire FFBB repris pour les matchs à venir ; celui d'un match passé n'est plus touché
        if (!m.passe && m.heure && l.heure.slice(0, 5) !== m.heure) p.feuille.getRange(l.ligne, p.cols.heure).setNumberFormat('@').setValue(m.heure);
        continue;
      }
      // Nouveau match : sur la première ligne libre après le dernier match du planning
      const derniere = lignes.reduce((max, x) => (x.jour ? Math.max(max, x.ligne) : max), 1);
      const ligne = derniere + 1;
      const caseDate = p.feuille.getRange(ligne, p.cols.date);
      caseDate.getMergedRanges().forEach((r) => r.breakApart());
      // Date construite dans le fuseau horaire de la feuille (sinon elle peut s'afficher la veille)
      const fuseau = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
      caseDate.setValue(Utilities.parseDate(m.date + ' 12:00', fuseau, 'yyyy-MM-dd HH:mm')).setNumberFormat('d/m/yyyy');
      p.feuille.getRange(ligne, p.cols.heure).setNumberFormat('@').setValue(m.heure);
      p.feuille.getRange(ligne, p.cols.equipe).setValue(m.equipe);
      p.feuille.getRange(ligne, p.cols.adversaire).setValue(m.adversaire);
      p.feuille.getRange(ligne, p.cols.match).setValue(m.id);
      p.feuille.getRange(ligne, p.cols.officiels).insertCheckboxes();
      const valeurs = [];
      valeurs[p.cols.match - 1] = m.id;
      lignes.push({ ligne, jour: m.date, heure: m.heure, equipe: m.equipe, match: m.id, valeurs });
      ajoutes++;
    }
    return ajoutes;
  } finally {
    verrou.releaseLock();
  }
}

/** Menu dans la feuille */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Site AAB').addItem('Mettre à jour les matchs maintenant', 'menuSynchroniser_').addToUi();
}
function menuSynchroniser_() {
  const n = synchroniserMatchs();
  SpreadsheetApp.getUi().alert(n ? n + ' match(s) ajouté(s) au planning.' : 'Le planning est à jour.');
}

/** À lancer une fois : mise à jour automatique des matchs toutes les heures */
function installer() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'synchroniserMatchs').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('synchroniserMatchs').timeBased().everyHours(1).create();
  synchroniserMatchs();
}

// ---------- Page /aider-aux-matchs du site ----------

/**
 * Postes pris de chaque match du site : { inscriptions: [{ id, match, poste, nom: "Clara L." }], officiels: [matchs] }
 * (officiels : matchs avec arbitres officiels désignés, sans arbitre à fournir par le club)
 */
function doGet(e) {
  const p = planning_();
  const inscriptions = [];
  const officiels = [];
  for (const l of lignes_(p)) {
    if (!l.match) continue;
    if (officiels_(l.valeurs[p.cols.officiels - 1])) officiels.push(l.match);
    for (const poste of Object.keys(POSTES)) {
      for (const c of POSTES[poste].colonnes) {
        const valeur = l.valeurs[p.cols[c] - 1];
        if (valeur) inscriptions.push({ id: l.match + '|' + c + '|' + norm_(valeur), match: l.match, poste, nom: court_(valeur) });
      }
    }
  }
  return json_({ inscriptions, officiels });
}

/**
 * { action: "suggerer", texte } : aide à la saisie, { suggestions: [{ jeton, nom: "Clara L.", cat: "U11" }] }
 * { action: "inscrire", match, poste, nom, licencie (jeton d'une suggestion) } ou { action: "annuler", id, cle }
 */
function doPost(e) {
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, erreur: 'Demande illisible.' });
  }
  if (d.action === 'suggerer') return json_({ suggestions: suggestions_(d.texte) });
  if (d.action === 'inscrire' && !trouverLigne_(d.match)) synchroniserMatchs(); // match tout juste publié
  const verrou = LockService.getScriptLock();
  verrou.waitLock(10000); // deux inscriptions au même moment ne prennent pas la même case
  try {
    if (d.action === 'inscrire') return json_(inscrire_(d));
    if (d.action === 'annuler') return json_(annuler_(d));
    return json_({ ok: false, erreur: 'Action inconnue.' });
  } finally {
    verrou.releaseLock();
  }
}

function trouverLigne_(match) {
  const p = planning_();
  return lignes_(p).find((l) => l.match && l.match === String(match || ''));
}

/** Licenciés de l'onglet Licenciés : { valeur (comme dans la liste déroulante), prenom, nom, cat, jeton } */
function licencies_() {
  // Gardée 10 minutes en mémoire : l'aide à la saisie répond plus vite (relue après une modification de l'onglet)
  const cache = CacheService.getScriptCache();
  const enCache = cache.get('licencies');
  if (enCache) return JSON.parse(enCache);
  const liste = lireLicencies_();
  try { cache.put('licencies', JSON.stringify(liste), 600); } catch (err) { /* liste trop grande pour le cache */ }
  return liste;
}

function lireLicencies_() {
  const feuille = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONGLET_LICENCIES);
  if (!feuille) return [];
  const v = feuille.getDataRange().getDisplayValues();
  const t = v[0].map(norm_);
  const [iNom, iPrenom, iCat, iFusion] = ['nom', 'prenom', 'categorie', 'fusion'].map((x) => t.indexOf(x));
  return v.slice(1).filter((r) => r[iNom] && r[iPrenom]).map((r) => {
    const valeur = (iFusion >= 0 && r[iFusion]) || r[iPrenom] + ' ' + String(r[iNom]).toUpperCase() + (iCat >= 0 && r[iCat] ? ' (' + r[iCat] + ')' : '');
    return { valeur, prenom: r[iPrenom], nom: r[iNom], cat: iCat >= 0 ? r[iCat] : '', jeton: jeton_(valeur) };
  });
}

/** Identifiant opaque d'un licencié : la page ne reçoit jamais son nom complet */
function jeton_(valeur) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, norm_(valeur)).map((o) => ((o + 256) % 256).toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Modification dans la feuille : la liste des licenciés est relue à la prochaine recherche */
function onEdit(e) {
  if (e && e.range && e.range.getSheet().getName() === ONGLET_LICENCIES) CacheService.getScriptCache().remove('licencies');
}

/** Aide à la saisie : licenciés dont un mot du prénom ou du nom commence par chaque mot tapé (3 lettres au moins, 6 au plus) */
function suggestions_(q) {
  const mots = norm_(q).split(' ').filter(Boolean);
  if (mots.join('').length < 3) {
    if (!mots.length) licencies_(); // appel de réveil à l'ouverture de la fenêtre : prépare la liste en mémoire
    return [];
  }
  return licencies_()
    .filter((l) => {
      const siens = norm_(l.prenom + ' ' + l.nom).split(' ');
      return mots.every((m) => siens.some((w) => w.startsWith(m)));
    })
    .slice(0, 6)
    .map((l) => ({ jeton: l.jeton, nom: court_(l.prenom + ' ' + l.nom), cat: l.cat }));
}

/** Licencié choisi dans les suggestions (jeton), ou dont le prénom et le nom sont tapés en entier */
function licencie_(jeton, texte) {
  const tous = licencies_();
  if (jeton) return tous.find((l) => l.jeton === jeton);
  const t = norm_(texte);
  return tous.find((l) => t === norm_(l.prenom + ' ' + l.nom) || t === norm_(l.nom + ' ' + l.prenom));
}

function inscrire_(d) {
  if (d.site) return { ok: false, erreur: 'Inscription refusée.' }; // champ piège rempli : robot
  const poste = POSTES[d.poste];
  const nom = texte_(d.nom);
  if (!poste) return { ok: false, erreur: 'Poste inconnu.' };
  if (nom.split(' ').length < 2 && !d.licencie) return { ok: false, erreur: 'Indiquez votre prénom et votre nom.' };
  const p = planning_();
  const l = lignes_(p).find((x) => x.match && x.match === String(d.match || ''));
  if (!l) return { ok: false, erreur: 'Ce match n’est pas encore dans le planning du club. Réessayez dans une heure.' };
  if (d.poste === 'arbitre' && officiels_(l.valeurs[p.cols.officiels - 1])) {
    return { ok: false, erreur: 'Des arbitres officiels sont désignés pour ce match : pas besoin d’arbitre du club.' };
  }
  const libre = poste.colonnes.find((c) => !l.valeurs[p.cols[c] - 1]);
  if (!libre) return { ok: false, erreur: 'Ce poste vient d’être pris. Choisissez-en un autre.' };
  const licencie = licencie_(String(d.licencie || ''), nom);
  if (!licencie && poste.licence) {
    return { ok: false, erreur: 'Ce poste est réservé aux licenciés : choisissez votre nom dans la liste qui s’affiche quand vous tapez.' };
  }
  // Non licencié (buvette) : « Paul Martin » → « Paul MARTIN », comme les noms de la liste déroulante
  const valeur = licencie ? licencie.valeur : nom.replace(/^(\S+)\s+(.+)$/, (_, p1, p2) => p1.charAt(0).toUpperCase() + p1.slice(1) + ' ' + p2.toUpperCase());
  p.feuille.getRange(l.ligne, p.cols[libre]).setValue(valeur);
  const cle = Utilities.getUuid();
  cles_().appendRow([new Date(), l.match, libre, valeur, cle]);
  return { ok: true, id: l.match + '|' + libre + '|' + norm_(valeur), cle };
}

function annuler_(d) {
  const [match, colonne] = String(d.id || '').split('|');
  const feuille = cles_();
  const v = feuille.getDataRange().getValues();
  const i = v.findIndex((r) => r[1] === match && r[2] === colonne && r[4] === d.cle);
  if (i < 1) return { ok: false, erreur: 'Inscription introuvable.' };
  const p = planning_();
  const l = lignes_(p).find((x) => x.match === match);
  if (l && l.jour) {
    // Heure du match en heure française (sans horaire : dès minuit le jour du match)
    const debut = Utilities.parseDate(l.jour + ' ' + (l.heure ? l.heure.slice(0, 5) : '00:00'), 'Europe/Paris', 'yyyy-MM-dd HH:mm');
    if (debut.getTime() - Date.now() < DELAI_RETRAIT_HEURES * 3600 * 1000) {
      return { ok: false, erreur: 'Le match a lieu dans moins de ' + DELAI_RETRAIT_HEURES + ' h : pour vous retirer, contactez le club.' };
    }
  }
  // On n'efface la case que si elle contient toujours ce nom (le club a pu la changer entre-temps)
  if (l && l.valeurs[p.cols[colonne] - 1] === v[i][3]) p.feuille.getRange(l.ligne, p.cols[colonne]).clearContent();
  feuille.deleteRow(i + 1);
  return { ok: true };
}

function cles_() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  let feuille = classeur.getSheetByName(ONGLET_CLES);
  if (!feuille) {
    feuille = classeur.insertSheet(ONGLET_CLES);
    feuille.appendRow(['Inscrit le', 'Match', 'Colonne', 'Nom', 'Clé']);
    feuille.hideSheet();
  }
  return feuille;
}
