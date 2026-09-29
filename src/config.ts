export const club = {
  name: "Aunis Atlantique Basket",
  shortName: "AAB",
  slogan: "Plus qu'un club, une famille",
  foundedYear: 2023,
  address: "16 rue du Docteur Quoy, 17170 Saint-Jean-de-Liversay",
  email: "contact@aunisatlantiquebasket.com", // présidence, secrétariat, inscriptions
  emailSportive: "sportive@aunisatlantiquebasket.com", // organisation des compétitions, commission sportive
  emailCommunication: "communication@aunisatlantiquebasket.com", // vie associative : événements, sponsors, bénévolat
  gym: "Gymnase intercommunal Bel Air, rue de Bel-Air, 17230 Marans", // salle principale (matchs à domicile)
  // Toutes les salles du club (page Contact) : adresse complète quand on la connaît, sinon la commune ;
  // use : à quoi sert la salle (facultatif)
  gyms: [
    { name: "Gymnase intercommunal Bel Air", address: "rue de Bel-Air, 17230 Marans", use: "Matchs à domicile, entraînements" },
    { name: "Gymnase De Gaulle", address: "Avenue du Général de Gaulle, 17230 Marans", use: "Entraînements" },
    { name: "Complexe sportif intercommunal de Courçon", address: "Rue du Collège, 17170 Courçon", use: "Entraînements" },
    { name: "Complexe socio-éducatif de Saint-Jean-de-Liversay", address: "Rue du 19 mars, 17170 Saint-Jean-de-Liversay", use: "Entraînements" },
  ] as { name: string; address: string; use?: string }[],
  social: {
    facebook: "https://www.facebook.com/aunisatlantiquebasket/",
    instagram: "https://www.instagram.com/aunis_atlantique_basket/",
  },
  // Espace membres du club sur SportEasy (convocations, disponibilités…). Vide : lien masqué.
  sportEasyUrl: "https://aunis-atlantique-basket.sporteasy.net/",
  // Page du club sur competitions.ffbb.com (source des équipes, matchs et résultats)
  ffbbClubPath: "/ligues/naq/comites/0017/clubs/naq0017020",
  // Identifiant du club (organisme) dans les données FFBB, utilisé par l'API de synchronisation
  ffbbOrganismeId: "200000002678561",
};

// Site publié « en construction » : l'accueil en ligne affiche une page d'attente, et le vrai site
// reste consultable (non référencé) à l'adresse /apercu/ pour le faire valider.
// Passer à false pour ouvrir le site (ou EN_CONSTRUCTION=0 pour une génération locale).
export const enConstruction = process.env.EN_CONSTRUCTION ? process.env.EN_CONSTRUCTION !== "0" : true;

export const port =Number(process.env.PORT ?? 3000);

// Synchronisation automatique avec la FFBB (désactivable avec FFBB_SYNC=off)
export const ffbbSync = {
  enabled: process.env.FFBB_SYNC !== "off",
  intervalHours: Number(process.env.FFBB_SYNC_HOURS ?? 3),
};
