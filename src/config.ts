export const club = {
  name: "Aunis Atlantique Basket",
  shortName: "AAB",
  slogan: "Plus qu'un club, une famille",
  foundedYear: 2023,
  address: "16 rue du Docteur Quoy, 17170 Saint-Jean-de-Liversay",
  email: "contact@aunisatlantiquebasket.com",
  gym: "Gymnase intercommunal Bel Air, rue de Bel-Air, 17230 Marans",
  social: {
    facebook: "https://www.facebook.com/aunisatlantiquebasket/",
    instagram: "https://www.instagram.com/aunis_atlantique_basket/",
  },
  // Espace membres du club sur SportEasy (convocations, disponibilités…). Vide : lien masqué.
  sportEasyUrl: "https://aunis-atlantique-basket.sporteasy.net/",
  // Page du club sur competitions.ffbb.com (source des équipes, matchs et résultats)
  ffbbClubPath: "/ligues/naq/comites/0017/clubs/naq0017020",
};

export const port = Number(process.env.PORT ?? 3000);

// Synchronisation automatique avec la FFBB (désactivable avec FFBB_SYNC=off)
export const ffbbSync = {
  enabled: process.env.FFBB_SYNC !== "off",
  intervalHours: Number(process.env.FFBB_SYNC_HOURS ?? 3),
};
