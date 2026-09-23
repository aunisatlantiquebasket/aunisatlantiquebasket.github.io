// Filtres des listes de matchs (calendrier et pages d'équipe), appliqués dans la page.
// Chaque ligne .fx porte data-view ("a-venir" / "resultats"), data-team et data-place.
// Les filtres sont repris dans l'adresse (?vue=…&equipe=…&lieu=…) pour pouvoir partager un lien.
(() => {
  for (const root of document.querySelectorAll("[data-filter-scope]")) {
    const defaultView = root.dataset.defaultView || "tous";
    const params = new URLSearchParams(location.search);
    const state = {
      view: ["tous", "a-venir", "resultats"].includes(params.get("vue")) ? params.get("vue") : defaultView,
      team: params.get("equipe") || "",
      place: ["domicile", "exterieur"].includes(params.get("lieu")) ? params.get("lieu") : "",
    };

    const rows = [...root.querySelectorAll(".fx[data-view]")];
    // Une équipe inconnue dans l'adresse est ignorée
    if (state.team && !rows.some((r) => r.dataset.team === state.team)) state.team = "";

    const matchesTeamAndPlace = (r) =>
      (!state.team || r.dataset.team === state.team) && (!state.place || r.dataset.place === state.place);

    function apply() {
      for (const r of rows) r.hidden = !(matchesTeamAndPlace(r) && (state.view === "tous" || r.dataset.view === state.view));

      for (const list of root.querySelectorAll("[data-list-view]")) {
        list.hidden = state.view !== "tous" && list.dataset.listView !== state.view;
      }
      for (const group of root.querySelectorAll("[data-month-group]")) {
        group.hidden = ![...group.querySelectorAll(".fx")].some((r) => !r.hidden);
      }
      for (const c of root.querySelectorAll("[data-count]")) {
        c.textContent = rows.filter((r) => matchesTeamAndPlace(r) && r.dataset.view === c.dataset.count).length;
      }
      for (const b of root.querySelectorAll("[data-set]")) {
        const on = state[b.dataset.set] === b.dataset.value;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      }
      const empty = root.querySelector("[data-empty]");
      if (empty) empty.hidden = rows.some((r) => !r.hidden);

      const p = new URLSearchParams();
      if (state.view !== defaultView) p.set("vue", state.view);
      if (state.team) p.set("equipe", state.team);
      if (state.place) p.set("lieu", state.place);
      history.replaceState(null, "", location.pathname + (p.toString() ? `?${p}` : ""));
    }

    root.addEventListener("click", (e) => {
      const button = e.target.closest("[data-set]");
      if (button) {
        state[button.dataset.set] = button.dataset.value;
        apply();
      }
      if (e.target.closest("[data-reset]")) {
        state.team = "";
        state.place = "";
        apply();
      }
    });

    apply();
  }
})();
