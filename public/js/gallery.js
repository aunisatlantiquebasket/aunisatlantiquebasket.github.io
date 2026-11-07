// Galerie de photos d'un article : clic sur une vignette = photo agrandie, flèches et balayage pour naviguer.
(() => {
  const gallery = document.querySelector("[data-gallery]");
  const box = document.querySelector("[data-lightbox]");
  if (!gallery || !box) return;
  const photos = [...gallery.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  const img = box.querySelector("img");
  const count = box.querySelector("[data-count]");
  let current = 0;

  const show = (i) => {
    current = (i + photos.length) % photos.length;
    img.src = photos[current];
    img.alt = `Photo ${current + 1} sur ${photos.length}`;
    count.textContent = `${current + 1} / ${photos.length}`;
  };

  gallery.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-index]");
    if (!link) return;
    e.preventDefault();
    show(Number(link.dataset.index));
    box.showModal();
  });
  box.addEventListener("click", (e) => {
    const step = e.target.closest("[data-step]");
    if (step) show(current + Number(step.dataset.step));
    else if (e.target.closest("[data-close]") || e.target === box) box.close();
  });
  document.addEventListener("keydown", (e) => {
    if (!box.open) return;
    if (e.key === "ArrowRight") show(current + 1);
    if (e.key === "ArrowLeft") show(current - 1);
  });
  let startX = null;
  box.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; }, { passive: true });
  box.addEventListener("touchend", (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) show(current + (dx < 0 ? 1 : -1));
    startX = null;
  });
})();
