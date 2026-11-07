// Album photo d'un article : carrousel (défilement natif au doigt, flèches, compteur) et photo
// agrandie au clic (flèches, clavier, balayage).
(() => {
  const album = document.querySelector("[data-album]");
  const box = document.querySelector("[data-lightbox]");
  if (!album || !box) return;
  const track = album.querySelector("[data-track]");
  const photos = [...track.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  const current = album.querySelector("[data-current]");

  // Carrousel
  let slide = 0;
  const goTo = (i) => {
    slide = (i + photos.length) % photos.length;
    track.scrollTo({ left: slide * track.clientWidth, behavior: "smooth" });
  };
  let scrollEnd;
  track.addEventListener("scroll", () => {
    clearTimeout(scrollEnd);
    scrollEnd = setTimeout(() => {
      slide = Math.round(track.scrollLeft / track.clientWidth);
      current.textContent = String(slide + 1);
    }, 60);
  }, { passive: true });
  album.addEventListener("click", (e) => {
    const move = e.target.closest("[data-move]");
    if (move) return goTo(slide + Number(move.dataset.move));
    const link = e.target.closest("a[data-index]");
    if (!link) return;
    e.preventDefault();
    show(Number(link.dataset.index));
    box.showModal();
  });
  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") goTo(slide + 1);
    if (e.key === "ArrowLeft") goTo(slide - 1);
  });

  // Photo agrandie
  const img = box.querySelector("img");
  const count = box.querySelector("[data-count]");
  let shown = 0;
  const show = (i) => {
    shown = (i + photos.length) % photos.length;
    img.src = photos[shown];
    img.alt = `Photo ${shown + 1} sur ${photos.length}`;
    count.textContent = `${shown + 1} / ${photos.length}`;
  };
  box.addEventListener("click", (e) => {
    const step = e.target.closest("[data-step]");
    if (step) show(shown + Number(step.dataset.step));
    else if (e.target.closest("[data-close]") || e.target === box) box.close();
  });
  box.addEventListener("close", () => goTo(shown)); // le carrousel reprend sur la dernière photo vue
  document.addEventListener("keydown", (e) => {
    if (!box.open) return;
    if (e.key === "ArrowRight") show(shown + 1);
    if (e.key === "ArrowLeft") show(shown - 1);
  });
  let startX = null;
  box.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; }, { passive: true });
  box.addEventListener("touchend", (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) show(shown + (dx < 0 ? 1 : -1));
    startX = null;
  });
})();
