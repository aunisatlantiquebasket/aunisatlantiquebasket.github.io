// Carrousel des prochains matchs (bannière de l'accueil).
// Le défilement repose sur le scroll natif (scroll-snap) : glisser au doigt fonctionne
// même sans ce script. Le script ajoute flèches, points et défilement automatique.
(() => {
  const AUTOPLAY_MS = 6000;

  for (const root of document.querySelectorAll("[data-carousel]")) {
    const track = root.querySelector("[data-track]");
    if (!track) continue;
    const slides = [...track.children];
    const dots = [...root.querySelectorAll("[data-dot]")];
    const counter = root.querySelector("[data-current]");
    if (slides.length < 2) continue;

    let index = 0;
    let timer = null;
    let stopped = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const goTo = (i, smooth = true) => {
      index = (i + slides.length) % slides.length;
      track.scrollTo({ left: index * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
      update();
    };

    const update = () => {
      dots.forEach((d, i) => d.setAttribute("aria-selected", String(i === index)));
      if (counter) counter.textContent = String(index + 1);
      slides.forEach((s, i) => (s.inert = i !== index)); // liens des diapositives cachées hors tabulation
    };

    // Suit la diapositive visible quand l'utilisateur fait glisser
    let scrollEnd;
    track.addEventListener("scroll", () => {
      clearTimeout(scrollEnd);
      scrollEnd = setTimeout(() => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        if (i !== index) { index = i; update(); }
      }, 80);
    }, { passive: true });

    // Toute action de l'utilisateur arrête le défilement automatique
    const userAction = (fn) => () => { stop(); fn(); };
    root.querySelector("[data-prev]")?.addEventListener("click", userAction(() => goTo(index - 1)));
    root.querySelector("[data-next]")?.addEventListener("click", userAction(() => goTo(index + 1)));
    dots.forEach((d, i) => d.addEventListener("click", userAction(() => goTo(i))));
    track.addEventListener("pointerdown", stop, { passive: true });
    track.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); userAction(() => goTo(index + 1))(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); userAction(() => goTo(index - 1))(); }
    });

    // Pause au survol ou quand le carrousel a le focus
    root.addEventListener("mouseenter", pause);
    root.addEventListener("mouseleave", play);
    root.addEventListener("focusin", pause);
    root.addEventListener("focusout", play);
    document.addEventListener("visibilitychange", () => (document.hidden ? pause() : play()));

    function play() {
      if (stopped || timer) return;
      timer = setInterval(() => goTo(index + 1), AUTOPLAY_MS);
    }
    function pause() {
      clearInterval(timer);
      timer = null;
    }
    function stop() {
      stopped = true;
      pause();
    }

    update();
    play();
  }
})();
