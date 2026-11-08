// Inscriptions des bénévoles aux matchs à domicile (page /aider-aux-matchs).
// Les inscriptions sont lues et enregistrées par le script Apps Script du club (feuille Google),
// à l'adresse donnée dans data-api ; "demo" les simule dans le navigateur (aperçu local).
// Le navigateur garde la clé de ses propres inscriptions, pour pouvoir les retirer.
(() => {
  const root = document.querySelector("[data-vol]");
  if (!root) return;

  // « Comment ça marche ? » replié sur téléphone
  const how = root.querySelector("[data-how]");
  if (how && matchMedia("(max-width: 800px)").matches) how.open = false;

  // À venir / Passés
  root.querySelector(".vol-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-show]");
    if (!tab) return;
    root.querySelectorAll(".vol-tabs [data-show]").forEach((b) => b.classList.toggle("active", b === tab));
    root.querySelectorAll("[data-list]").forEach((l) => (l.hidden = l.dataset.list !== tab.dataset.show));
  });

  if (!root.dataset.api) return;
  const api = root.dataset.api;
  const roles = JSON.parse(root.dataset.roles);
  const dialog = root.querySelector("[data-dialog]");
  const form = root.querySelector("[data-form]");
  const status = root.querySelector("[data-status]");
  const errorBox = root.querySelector("[data-error]");
  const MINE = "aab-benevoles";
  const delay = Number(root.dataset.delay || 0) * 3600 * 1000;
  // Match trop proche pour se retirer soi-même (heure locale française ; sans horaire, dès minuit)
  const locked = (card) => new Date(JSON.parse(card.dataset.info).date).getTime() - Date.now() < delay;

  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)) ?? []; } catch { return []; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* navigation privée */ } },
  };
  let list = [];
  let officiels = new Set(); // matchs avec arbitres officiels désignés
  let current = null; // { match, role, info }

  // ----- Échanges avec le script (ou simulation) -----
  const shortName = (texte) => { const [p, n = ""] = texte.trim().split(/\s+/); return `${p} ${n.charAt(0).toUpperCase()}.`; };
  const DEMO_LICENCIES = [["Clara", "LAUDE", "U11"], ["Mathéo", "LAUDE", "U13"], ["Virgile", "LAUDE", "Seniors"], ["Alexandre", "MARTINEAU", "Seniors"], ["Léa", "DUPONT", "U13"]];
  async function call(body) {
    if (api === "demo") return demo(body);
    // text/plain : requête simple, sans vérification préalable du navigateur (CORS) côté Google
    const res = await fetch(api, { method: body ? "POST" : "GET", body: body && JSON.stringify(body), headers: body ? { "Content-Type": "text/plain;charset=utf-8" } : undefined });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  function demo(body) {
    const rows = store.get("aab-benevoles-demo");
    const norm = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (body?.action === "suggerer") {
      const mots = norm(body.texte).split(/\s+/).filter(Boolean);
      return { suggestions: DEMO_LICENCIES.filter(([p, n]) => mots.every((m) => norm(`${p} ${n}`).split(" ").some((w) => w.startsWith(m)))).map(([p, n, cat]) => ({ jeton: `${p} ${n}`, nom: shortName(`${p} ${n}`), cat })) };
    }
    if (body?.action === "inscrire") {
      if (body.poste !== "buvette" && !body.licencie) return { ok: false, erreur: "Ce poste est réservé aux licenciés : choisissez votre nom dans la liste qui s'affiche quand vous tapez." };
      const role = roles.find((r) => r.id === body.poste);
      if (rows.filter((r) => r.match === body.match && r.poste === body.poste).length >= role.places) return { ok: false, erreur: "Ce poste vient d'être pris." };
      const row = { id: String(Date.now()), cle: Math.random().toString(36).slice(2), match: body.match, poste: body.poste, nom: shortName(body.licencie || body.nom) };
      store.set("aab-benevoles-demo", [...rows, row]);
      return { ok: true, id: row.id, cle: row.cle };
    }
    if (body?.action === "annuler") {
      store.set("aab-benevoles-demo", rows.filter((r) => !(r.id === body.id && r.cle === body.cle)));
      return { ok: true };
    }
    return { inscriptions: rows.map(({ cle, ...r }) => r), officiels: ["ffbb-200000014939787"] };
  }

  // ----- Affichage -----
  function render() {
    const mine = new Map(store.get(MINE).map((m) => [m.id, m]));
    for (const i of list) if (i.pending) mine.set(i.id, i);
    for (const card of root.querySelectorAll("[data-match]")) {
      // Match passé : noms seulement, rien à cliquer
      if (card.hasAttribute("data-past")) {
        for (const li of card.querySelectorAll("[data-role]")) {
          const off = li.dataset.role === "arbitre" && officiels.has(card.dataset.match);
          if (li.dataset.role === "arbitre") {
            li.querySelector("[data-officiels]").hidden = !off;
            li.querySelector(".vol-slots").hidden = off;
          }
          const taken = list.filter((i) => i.match === card.dataset.match && i.poste === li.dataset.role);
          li.querySelectorAll("[data-slot]").forEach((btn, n) => {
            btn.textContent = taken[n]?.nom ?? "—";
            btn.classList.toggle("is-taken", !!taken[n]);
          });
        }
        continue;
      }
      const isLocked = locked(card);
      let missing = 0;
      let needed = 0;
      for (const li of card.querySelectorAll("[data-role]")) {
        const role = roles.find((r) => r.id === li.dataset.role);
        if (role.id === "arbitre") {
          const off = officiels.has(card.dataset.match);
          li.querySelector("[data-officiels]").hidden = !off;
          li.querySelector(".vol-slots").hidden = off;
          if (off) continue; // arbitres officiels : rien à fournir par le club
        }
        const taken = list.filter((i) => i.match === card.dataset.match && i.poste === role.id);
        needed += role.needed ?? role.places;
        missing += Math.max(0, (role.needed ?? role.places) - taken.length);
        li.querySelectorAll("[data-slot]").forEach((btn, n) => {
          const who = taken[n];
          btn.classList.remove("is-confirm");
          btn.classList.toggle("is-taken", !!who && !mine.has(who.id));
          btn.classList.toggle("is-mine", !!who && mine.has(who.id));
          btn.disabled = !!who && (!mine.has(who.id) || !!who.pending);
          btn.dataset.id = who?.id ?? "";
          btn.textContent = who ? (who.pending ? `${who.nom} …` : mine.has(who.id) ? `${who.nom} ${isLocked ? "🔒" : "✕"}` : who.nom) : "Je m'inscris";
          btn.title = who && mine.has(who.id) ? (isLocked ? "Match dans moins de " + root.dataset.delay + " h : contactez le club pour vous retirer" : "Me retirer de ce poste") : "";
        });
      }
      const progress = card.querySelector("[data-progress]");
      progress.hidden = false;
      progress.classList.toggle("is-full", !missing);
      card.querySelector("[data-bar]").style.width = `${((needed - missing) / needed) * 100}%`;
      card.querySelector("[data-progress-text]").textContent = missing ? `${needed - missing}/${needed} postes pourvus` : "Complet, merci !";
    }
  }
  function showStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  const removing = new Set(); // retraits envoyés, pas encore confirmés par la feuille
  async function refresh(message = "") {
    try {
      const data = await call();
      const fresh = data.inscriptions ?? [];
      officiels = new Set(data.officiels ?? []);
      list = [...fresh.filter((i) => !removing.has(i.id)), ...list.filter((i) => i.pending)];
      showStatus(message);
    } catch {
      showStatus("Impossible de charger les inscriptions pour le moment. Réessayez dans quelques minutes.");
    }
    render();
  }

  // ----- Inscription et retrait -----
  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-slot]");
    if (!btn || btn.disabled) return;
    const card = btn.closest("[data-match]");
    const role = roles.find((r) => r.id === btn.closest("[data-role]").dataset.role);
    if (btn.dataset.id) {
      const entry = store.get(MINE).find((m) => m.id === btn.dataset.id);
      if (!entry) return;
      if (locked(card)) {
        showStatus(`Le match a lieu dans moins de ${root.dataset.delay} h : vous ne pouvez plus vous retirer depuis le site. Prévenez le club à ${root.dataset.contact}.`);
        status.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      // Confirmation dans le bouton (les fenêtres confirm() sont bloquées par certains navigateurs) :
      // premier clic → « Retirer ? », second clic dans les 4 secondes → retrait
      if (!btn.classList.contains("is-confirm")) {
        const label = btn.textContent;
        btn.classList.add("is-confirm");
        btn.textContent = "Retirer ?";
        setTimeout(() => {
          if (btn.classList.contains("is-confirm")) { btn.classList.remove("is-confirm"); btn.textContent = label; }
        }, 4000);
        return;
      }
      // La case se libère tout de suite ; la feuille est mise à jour en arrière-plan
      const removed = list.find((i) => i.id === entry.id);
      list = list.filter((i) => i.id !== entry.id);
      removing.add(entry.id);
      render();
      showStatus(`Vous êtes retiré(e) du poste « ${role.one ?? role.label} ».`);
      call({ action: "annuler", id: entry.id, cle: entry.cle })
        .then((res) => {
          if (!res.ok) throw new Error(res.erreur);
          store.set(MINE, store.get(MINE).filter((m) => m.id !== entry.id));
        })
        .catch((err) => {
          if (removed) list.push(removed); // retrait refusé : le nom revient
          showStatus(`Le retrait n'a pas pu être enregistré. ${message(err, "Réessayez, ou écrivez-nous.")}`);
        })
        .finally(() => { removing.delete(entry.id); render(); });
      return;
    }
    current = { match: card.dataset.match, role, info: JSON.parse(card.dataset.info) };
    const when = new Date(current.info.date);
    root.querySelector("[data-role-label]").textContent = role.one ?? role.label;
    root.querySelector("[data-match-label]").textContent = `${current.info.equipe} contre ${current.info.adversaire}`;
    root.querySelector("[data-when-day]").textContent = when.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const hour = root.querySelector("[data-when-hour]");
    hour.hidden = !(when.getHours() || when.getMinutes()); // horaire pas encore fixé
    hour.lastElementChild.textContent = when.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
    root.querySelector("[data-hint]").textContent = role.licence
      ? "Réservé aux licenciés : tapez 3 lettres, puis choisissez votre nom dans la liste."
      : "Ouvert à tous : licenciés, parents, amis du club.";
    if (api !== "demo") call({ action: "suggerer", texte: "" }).catch(() => {}); // réveille le script Google pendant la saisie
    errorBox.hidden = true;
    form.reset();
    closeSuggest();
    dialog.showModal();
    form.elements.nom.focus();
  });

  // ----- Aide à la saisie : licenciés trouvés dans la feuille du club (prénom et initiale seulement) -----
  const input = form.elements.nom;
  const suggest = root.querySelector("[data-suggest]");
  let timer;
  let active = -1;
  function closeSuggest() {
    suggest.hidden = true;
    suggest.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    active = -1;
  }
  function choose(li) {
    input.value = li.dataset.nom;
    form.elements.licencie.value = li.dataset.jeton;
    closeSuggest();
  }
  function highlight(i) {
    const items = [...suggest.querySelectorAll("[data-jeton]")];
    active = (i + items.length) % items.length;
    items.forEach((li, n) => li.setAttribute("aria-selected", String(n === active)));
  }
  const found = new Map(); // recherches déjà faites : réponse immédiate
  input.addEventListener("input", () => {
    form.elements.licencie.value = ""; // texte modifié : le licencié choisi ne vaut plus
    clearTimeout(timer);
    const texte = input.value.trim();
    if (texte.replace(/\s/g, "").length < 3) return closeSuggest();
    if (!found.has(texte.toLowerCase())) {
      suggest.innerHTML = `<li class="vol-suggest-empty">Recherche…</li>`;
      suggest.hidden = false;
    }
    timer = setTimeout(async () => {
      try {
        const key = texte.toLowerCase();
        if (!found.has(key)) found.set(key, (await call({ action: "suggerer", texte })).suggestions ?? []);
        const suggestions = found.get(key);
        if (input.value.trim() !== texte) return; // la saisie a continué entre-temps
        suggest.innerHTML = "";
        for (const s of suggestions) {
          const li = document.createElement("li");
          li.setAttribute("role", "option");
          li.dataset.jeton = s.jeton;
          li.dataset.nom = s.nom;
          li.append(Object.assign(document.createElement("strong"), { textContent: s.nom }), Object.assign(document.createElement("span"), { textContent: s.cat }));
          suggest.append(li);
        }
        if (!suggestions.length) {
          suggest.innerHTML = current.role.licence ? `<li class="vol-suggest-empty">Aucun licencié trouvé : vérifiez l'orthographe.</li>` : "";
        }
        suggest.hidden = !suggest.children.length;
        input.setAttribute("aria-expanded", String(!suggest.hidden));
        active = -1;
      } catch {
        closeSuggest();
      }
    }, found.has(texte.toLowerCase()) ? 0 : 150);
  });
  input.addEventListener("keydown", (e) => {
    if (suggest.hidden || !suggest.querySelector("[data-jeton]")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      highlight(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(suggest.querySelectorAll("[data-jeton]")[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSuggest();
    }
  });
  suggest.addEventListener("mousedown", (e) => {
    const li = e.target.closest("[data-jeton]");
    if (li) { e.preventDefault(); choose(li); }
  });

  root.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // clic sur le fond
  const message = (err, fallback) => (err instanceof Error && err.message && !err.message.startsWith("HTTP") ? err.message : fallback);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const nom = form.elements.nom.value.trim();
    const licencie = form.elements.licencie.value;
    // Vérifié avant de fermer la fenêtre : ces refus ne doivent pas arriver après coup
    if (current.role.licence && !licencie) {
      errorBox.textContent = "Ce poste est réservé aux licenciés : tapez 3 lettres, puis choisissez votre nom dans la liste.";
      errorBox.hidden = false;
      return;
    }
    if (!licencie && nom.split(/\s+/).length < 2) {
      errorBox.textContent = "Indiquez votre prénom et votre nom.";
      errorBox.hidden = false;
      return;
    }
    // La fenêtre se ferme et le nom s'affiche tout de suite ; la feuille est mise à jour en arrière-plan
    const { match, role, info } = current;
    const entry = { id: `envoi-${Date.now()}`, match, poste: role.id, nom: licencie ? nom : shortName(nom), pending: true };
    list.push(entry);
    dialog.close();
    render();
    showStatus(`Merci ${nom.split(/\s+/)[0]} ! Vous êtes inscrit(e) : ${role.one ?? role.label}. Pour vous retirer, cliquez sur votre nom.`);
    call({
      action: "inscrire", match, poste: role.id, nom, licencie, site: form.elements.site.value,
      date: info.date, equipe: info.equipe, adversaire: info.adversaire,
    })
      .then((res) => {
        if (!res.ok) throw new Error(res.erreur || "Inscription refusée.");
        store.set(MINE, [...store.get(MINE), { id: res.id, cle: res.cle }]);
        Object.assign(entry, { id: res.id, pending: false });
      })
      .catch((err) => {
        list = list.filter((i) => i !== entry); // inscription refusée : la case se libère
        // Rechargé pour montrer qui a pris la place
        refresh(`Votre inscription (${role.one ?? role.label}) n'a pas pu être enregistrée. ${message(err, "Réessayez dans quelques minutes.")}`)
          .then(() => status.scrollIntoView({ behavior: "smooth", block: "center" }));
      })
      .finally(render);
  });

  refresh();
})();
