// Service worker de l'application installable (voir js/install.js).
// Réseau d'abord : les résultats et le calendrier changent souvent, on affiche toujours la version
// en ligne. Chaque page ou fichier consulté est gardé en cache pour rester lisible hors connexion.
const CACHE = "aab-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Page jamais consultée hors connexion : on affiche l'accueil s'il est en cache
        if (request.mode === "navigate") {
          const home = await caches.match(new URL("./", self.registration.scope).href);
          if (home) return home;
        }
        return Response.error();
      }),
  );
});
