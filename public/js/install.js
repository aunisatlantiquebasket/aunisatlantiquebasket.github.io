// Application installable : enregistre le service worker et, sur mobile et tablette, propose
// d'ajouter le site à l'écran d'accueil (bandeau #install-banner du pied de page).
// - Android (Chrome, Edge, Samsung…) : bouton « Installer » qui ouvre la fenêtre du navigateur ;
// - iPhone / iPad : pas d'installation automatique possible, le bandeau explique la manipulation.
// Refusé (croix) : le bandeau ne revient pas avant 30 jours.
(() => {
  // Le service worker est toujours placé à côté du manifeste (racine du site, même depuis /apercu/)
  const manifest = document.querySelector('link[rel="manifest"]');
  if ("serviceWorker" in navigator && manifest) {
    navigator.serviceWorker.register(new URL("sw.js", manifest.href)).catch(() => {});
  }

  const banner = document.getElementById("install-banner");
  if (!banner) return;

  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const touchDevice = matchMedia("(hover: none) and (pointer: coarse)").matches;
  if (standalone || !touchDevice) return;

  const KEY = "aab-install-refus";
  const DELAY_DAYS = 30;
  const refusedRecently = () => {
    try {
      return Date.now() - Number(localStorage.getItem(KEY) || 0) < DELAY_DAYS * 86_400_000;
    } catch {
      return false;
    }
  };
  if (refusedRecently()) return;

  const hide = () => (banner.hidden = true);
  const show = () => setTimeout(() => (banner.hidden = false), 1500); // laisse la page s'afficher

  banner.querySelector("[data-install-dismiss]").addEventListener("click", () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    hide();
  });

  const accept = banner.querySelector("[data-install-accept]");
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) {
    banner.querySelector("[data-install-prompt]").hidden = true;
    banner.querySelector("[data-install-ios]").hidden = false;
    accept.hidden = true;
    show();
    return;
  }

  // Android : le navigateur signale que le site est installable
  let deferred;
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    show();
  });
  accept.addEventListener("click", async () => {
    if (!deferred) return;
    hide();
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = undefined;
  });
  addEventListener("appinstalled", hide);
})();
