/* Mnémosyne · panneau de configuration.
   Vanilla JS, aucune étape de build : chaque section se redessine à partir
   de l'état renvoyé par /api/state. */
(() => {
  "use strict";

  // ───────────────────────────────────────────────────────── utilitaires
  const $ = (sel, root = document) => root.querySelector(sel);

  /** Petit constructeur de DOM : h("div", { class: "x", onclick }, enfants…) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k in el && typeof v !== "string") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ICONS = {
    home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
    discord: "M8 12h.01M16 12h.01M7.5 7.5C9 7 10.5 6.8 12 6.8s3 .2 4.5.7M7.5 16.5c1.5.5 3 .7 4.5.7s3-.2 4.5-.7M5 17c-1.5-3-1.8-6.5-.5-10l3-1 .8 1.5M19 17c1.5-3 1.8-6.5.5-10l-3-1-.8 1.5M5 17l2.5 2 1-1.5M19 17l-2.5 2-1-1.5",
    key: "M15 7a4 4 0 1 1-3.9 4.9L3 20v-3h2v-2h2v-2l2.1-2.1A4 4 0 0 1 15 7Zm1.5 1.5h.01",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
    bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9m4.3 13a2 2 0 0 0 3.4 0",
    bus: "M6 17h12M6 17v2m12-2v2M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5zM5 11h14M8 14h.01M16 14h.01",
    bag: "M6 8h12l-1 13H7zM9 8V6a3 3 0 0 1 6 0v2",
    palette: "M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.7 1.5-1.5 0-.6-.3-1-.3-1.6 0-.8.6-1.4 1.4-1.4H17a4 4 0 0 0 4-4c0-5-4-9.5-9-9.5ZM7.5 11.5h.01M10.5 7.5h.01M15.5 8.5h.01",
    gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
    check: "M5 12l5 5L20 7",
    alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
    info: "M12 16v-4m0-4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
    pin: "M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2m2 0h2v2M18 18v2",
    upload: "M12 16V4m0 0-4 4m4-4 4 4M4 20h16",
    camera: "M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm9 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    refresh: "M20 11a8 8 0 0 0-14.9-3M4 4v4h4m-4 5a8 8 0 0 0 14.9 3M20 20v-4h-4",
    send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
    plus: "M12 5v14M5 12h14",
    sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  };
  const icon = (name, size = 18) =>
    h("span", { html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`, style: { display: "inline-flex" } });

  const dotTitle = (tag, text) => h(tag, {}, text, h("span", { class: "dot" }, "."));
  const kicker = (text, cls = "") => h("span", { class: `kicker ${cls}` }, h("i"), text);
  const notice = (kind, ...body) => h("div", { class: `notice ${kind}` }, icon(kind === "ok" ? "check" : kind === "info" ? "info" : "alert"), h("div", {}, ...body));

  function toast(message, ok = true) {
    const el = h("div", { class: `toast ${ok ? "" : "err"}` }, h("i"), h("span", {}, message));
    $("#toasts").append(el);
    setTimeout(() => el.remove(), ok ? 3800 : 7000);
  }

  async function api(path, body, method) {
    const res = await fetch(`/api${path}`, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    if (res.status === 401) {
      location.reload();
      throw new Error("Session expirée.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Erreur ${res.status}`);
      Object.assign(err, data, { status: res.status });
      throw err;
    }
    return data;
  }

  /** Bouton qui affiche un indicateur pendant une action asynchrone. */
  function actionButton(label, run, cls = "primary", iconName) {
    const btn = h("button", { class: `btn ${cls}`, type: "button" }, iconName ? icon(iconName, 16) : null, label);
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const original = [...btn.childNodes];
      btn.disabled = true;
      btn.replaceChildren(h("span", { class: "spin" }), label);
      try {
        await run(btn);
      } catch (err) {
        toast(err.message, false);
      } finally {
        btn.disabled = false;
        btn.replaceChildren(...original);
      }
    });
    return btn;
  }

  function field(label, input, help) {
    return h("label", { class: "field" }, h("span", {}, label), input, help ? h("small", {}, help) : null);
  }

  function toggle(checked, onchange, label, help) {
    const input = h("input", { type: "checkbox", checked, onchange: (e) => onchange(e.target.checked) });
    return h("label", { class: "toggle-line" }, h("span", {}, h("b", {}, label), help ? h("small", {}, help) : null), h("span", { class: "switch" }, input, h("span", { class: "track" })));
  }

  function segmented(options, value, onchange) {
    const box = h("div", { class: "segmented", role: "radiogroup" });
    for (const [val, label] of options) {
      box.append(
        h("button", {
          type: "button",
          class: val === value ? "on" : "",
          role: "radio",
          "aria-checked": String(val === value),
          onclick: () => {
            for (const b of box.children) b.classList.remove("on");
            box.querySelector(`[data-v="${val}"]`).classList.add("on");
            onchange(val);
          },
          "data-v": val,
        }, label),
      );
    }
    return box;
  }

  function logoTile(logo, name, big = false) {
    if (logo) return h("span", { class: `logo-tile ${big ? "big" : ""}` }, h("img", { src: logo, alt: "", loading: "lazy", onerror: (e) => e.target.replaceWith(document.createTextNode(initials(name))) }));
    return h("span", { class: `logo-tile mono ${big ? "big" : ""}` }, initials(name));
  }
  const initials = (name) => (name || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

  function lineBadge(l) {
    const bg = l.color || "var(--hue)";
    const fg = l.textColor || (l.color ? contrast(l.color) : "var(--on-hue)");
    return h("span", { class: `line-badge ${l.type === 3 || l.mode === "Bus" ? "bus" : ""}`, style: { background: bg, color: fg }, title: l.long || l.short || l.line }, l.short || l.line);
  }
  function contrast(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.6 ? "#101216" : "#ffffff";
  }

  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "jamais");
  const debounce = (fn, ms = 250) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  // ────────────────────────────────────────────────────────────── état
  let S = null;
  const ui = { pronoteTab: "identifiants", pronoteInstance: null, transportTab: "reseau", imageKind: "edt", imageTheme: null, security: null, stopTarget: "home", qr: null };

  async function refresh() {
    S = await api("/state");
    renderChrome();
    return S;
  }

  async function saveConfig(patch, message = "Enregistré.") {
    await api("/config", patch);
    await refresh();
    if (message) toast(message);
  }

  async function saveTransport(patch, message = "Trajets enregistrés.") {
    await api("/transport/config", patch);
    await refresh();
    if (message) toast(message);
  }

  // ─────────────────────────────────────────────────────── navigation
  const SECTIONS = [
    ["accueil", "Accueil", "home", null],
    ["discord", "Discord", "discord", () => S.steps.discord],
    ["pronote", "PRONOTE", "key", () => S.steps.pronote],
    ["profil", "Profil & briefs", "user", () => S.steps.profile],
    ["alertes", "Alertes", "bell", null],
    ["trajets", "Trajets", "bus", () => S.steps.transport],
    ["sac", "Sac", "bag", null],
    ["apparence", "Apparence", "palette", null],
    ["avance", "Avancé", "gear", null],
  ];
  const current = () => {
    const id = location.hash.replace("#", "") || "accueil";
    return SECTIONS.some(([s]) => s === id) ? id : "accueil";
  };

  function renderChrome() {
    const nav = $("#nav");
    nav.replaceChildren(
      h("small", {}, "Configuration"),
      ...SECTIONS.map(([id, label, ic, done]) =>
        h("a", { href: `#${id}`, class: current() === id ? "active" : "", onclick: () => nav.classList.remove("open") }, icon(ic, 17), label, done ? h("span", { class: `badge ${done() ? "ok" : ""}`, title: done() ? "Configuré" : "À faire" }) : null),
      ),
      h("div", { class: "side-foot" }, `v${S.version}`, S.preview ? " · APERÇU" : ""),
    );

    const pill = $("#pill");
    const ok = S.discord.ready && S.pronote.linked;
    const err = S.pronote.lastError || S.discord.error;
    pill.className = `status-pill ${err ? "err" : ok ? "ok" : ""}`;
    pill.querySelector("span").textContent = err ? "Attention requise" : ok ? "Mnémosyne veille" : "Configuration en cours";
  }

  async function route() {
    const main = $("#main");
    const id = current();
    if (!S) await refresh();
    renderChrome();
    const view = VIEWS[id];
    main.replaceChildren(...[view()].flat());
    window.scrollTo({ top: 0 });
  }

  const rerender = () => route();

  function hero(k, title, lead, actions = []) {
    const el = h("section", { class: "hero" }, h("div", { class: "hero-inner" }, kicker(k), dotTitle("h1", title), lead ? h("p", { class: "lead" }, lead) : null, actions.length ? h("div", { class: "actions" }, actions) : null));
    Pantheon.layer(el, { seed: title.length + 3 });
    return el;
  }

  function card(k, title, desc, ...body) {
    return h("section", { class: "card" }, h("header", {}, h("div", {}, k ? kicker(k) : null, dotTitle("h2", title), desc ? h("p", {}, desc) : null)), ...body);
  }

  // ─────────────────────────────────────────────────────────── vues
  const VIEWS = {};

  // ─── Accueil
  VIEWS.accueil = () => {
    const name = S.config.displayName || (S.pronote.studentName || "").split(" ").pop();
    const steps = [
      ["discord", "Ton bot Discord", "Token, puis installation sur ton compte.", S.steps.discord],
      ["pronote", "Connecter PRONOTE", "Identifiants, QR code ou ENT.", S.steps.pronote],
      ["profil", "Prénom & horaires", "Briefs du matin et du soir.", S.steps.profile],
      ["alertes", "Tes alertes", "Ce qui te prévient, et quand.", S.config.notifications && S.steps.pronote],
      ["trajets", "Tes trajets", "Bus, tram, car : l'heure de départ.", S.steps.transport, true],
    ];
    const done = steps.filter((s) => s[3]).length;
    const nextStep = steps.find((s) => !s[3] && !s[4]);
    const ready = S.steps.discord && S.steps.pronote;

    const blocks = [
      hero(
        ready ? "Mnémosyne veille" : "Mise en route",
        ready ? `Bonjour ${name || ""}`.trim() : "Bienvenue dans ton panneau",
        ready
          ? "Tout est en place. Chaque réglage reste modifiable ici, et /settings sur Discord te ramène sur ce panneau."
          : "Quelques étapes et Mnémosyne surveille PRONOTE pour toi : brief du matin, alertes en temps réel, sac et trajets.",
        ready
          ? [
              actionButton("Synchroniser", async () => {
                const r = await api("/sync", {});
                await refresh();
                r.ok ? toast("PRONOTE synchronisé.") : toast(r.error, false);
              }, "primary", "refresh"),
              actionButton("M'envoyer le brief", async () => {
                await api("/test/brief", {});
                toast("Brief envoyé en message privé.");
              }, "secondary", "send"),
            ]
          : nextStep
            ? [h("a", { class: "btn primary", href: `#${nextStep[0]}` }, `Continuer : ${nextStep[1]}`, " →")]
            : [],
      ),
    ];

    blocks.push(
      h("section", { class: "card" },
        h("header", {}, h("div", {}, kicker(`${done}/${steps.length} étapes`), dotTitle("h2", "Mise en route")), h("div", { style: { minWidth: "200px", flex: "1", maxWidth: "320px", alignSelf: "center" } }, h("div", { class: "progress" }, h("i", { style: { width: `${(done / steps.length) * 100}%` } })))),
        h("div", { class: "steps" },
          steps.map(([id, title, desc, ok, optional]) =>
            h("article", { class: `step ${ok ? "done" : ""} ${nextStep && nextStep[0] === id ? "current" : ""} ${optional ? "optional" : ""}`, onclick: () => (location.hash = id), tabindex: "0", onkeydown: (e) => e.key === "Enter" && (location.hash = id) },
              h("span", { class: "state" }, "✓"), h("h3", {}, title, h("span", { class: "dot" }, ".")), h("p", {}, desc)),
          ),
        ),
      ),
    );

    if (S.pronote.lastError) blocks.push(notice("err", h("b", {}, "La dernière synchronisation a échoué. "), S.pronote.lastError));
    if (S.pronote.security) blocks.push(notice("warn", h("b", {}, "PRONOTE demande une vérification. "), "Termine-la dans la section ", h("a", { href: "#pronote", class: "dot" }, "PRONOTE"), "."));
    if (S.discord.error) blocks.push(notice("err", h("b", {}, "Discord : "), S.discord.error));

    blocks.push(
      h("div", { class: "grid3" },
        statusCard("PRONOTE", S.pronote.linked ? S.pronote.studentName || "Compte relié" : "Non relié", S.pronote.linked ? `Dernière synchro : ${fmtDate(S.pronote.lastSync)}` : "Relie ton compte pour commencer.", S.pronote.linked ? "ok" : "warn", "#pronote"),
        statusCard("Discord", S.discord.ready ? S.discord.botTag : S.discord.configured ? "Connexion…" : "Pas de token", S.discord.ownerTag ? `Alertes envoyées à ${S.discord.ownerTag}` : "Lance /setup en MP avec ton bot.", S.discord.ready ? "ok" : "warn", "#discord"),
        statusCard("Trajets", S.transport.network ? S.transport.network.name : "Non configurés", S.steps.transport ? `${S.transport.homeStop?.name ?? "?"} → ${S.transport.schoolStop?.name ?? "?"}` : "Optionnel : heure de départ et alertes de bus.", S.steps.transport ? "ok" : "", "#trajets"),
      ),
    );

    blocks.push(imagesCard());
    return blocks;
  };

  function statusCard(k, title, text, state, href) {
    return h("a", { class: "card", href, style: { display: "grid", gap: "6px" } }, kicker(k, state), h("h3", {}, title), h("p", { class: "faint" }, text));
  }

  function imagesCard() {
    const kinds = [["edt", "Emploi du temps"], ["alertes", "Alertes"], ["notes", "Notes"], ["sac", "Sac"], ["trajet", "Trajet"]];
    const box = h("div", { class: "preview-img" }, h("p", { class: "faint" }, "Chargement de l'aperçu…"));
    const load = () => {
      const img = h("img", { alt: `Aperçu : ${ui.imageKind}`, src: `/api/images/${ui.imageKind}?t=${Date.now()}${ui.imageTheme ? `&theme=${ui.imageTheme}` : ""}` });
      img.onerror = () => box.replaceChildren(h("p", { class: "faint" }, ui.imageKind === "trajet" ? "Configure tes trajets pour voir cette image." : "Aperçu indisponible."));
      img.onload = () => box.replaceChildren(img);
    };
    const tabs = h("div", { class: "tabs" }, kinds.map(([k, l]) => h("button", { type: "button", class: ui.imageKind === k ? "on" : "", onclick: (e) => { ui.imageKind = k; for (const b of tabs.children) b.classList.remove("on"); e.currentTarget.classList.add("on"); load(); } }, l)));
    load();
    return card("Images", "Ce que tu reçois", S.pronote.linked ? "Générées à partir de tes vraies données, exactement comme le bot les envoie." : "Exemple avec des données fictives, en attendant ta connexion à PRONOTE.", tabs, box);
  }

  // ─── Discord
  VIEWS.discord = () => {
    const d = S.discord;
    const blocks = [hero("Étape 01", "Ton bot Discord", "Mnémosyne vit dans tes messages privés : tu crées ton propre bot (gratuit), puis tu l'installes sur ton compte.")];

    if (d.ready) {
      blocks.push(
        card("Connecté", d.botTag, null,
          h("div", { class: "identity" }, h("span", { class: "avatar" }, d.botAvatar ? h("img", { src: d.botAvatar, alt: "" }) : "M"), h("div", {}, h("b", {}, d.botTag), h("span", { class: "faint" }, d.ownerTag ? `Les alertes partent en MP à ${d.ownerTag}.` : "Lance /setup en MP avec le bot pour recevoir les alertes."))),
          h("hr", { class: "sep" }),
          h("div", { class: "row" },
            d.installUrl ? h("a", { class: "btn primary", href: d.installUrl, target: "_blank", rel: "noreferrer" }, icon("plus", 16), "Ajouter à mon compte Discord") : null,
            S.steps.pronote ? actionButton("Tester une alerte", async () => { await api("/test/alerte", {}); toast("Alerte de test envoyée."); }, "secondary", "send") : null,
          ),
          h("p", { class: "faint", style: { marginTop: "12px" } }, "Après l'installation, ouvre une conversation privée avec le bot et tape /setup : c'est toi qui recevras les notifications."),
        ),
      );
    }

    if (d.fromEnv) {
      blocks.push(notice("info", "Le token est défini dans le fichier ", h("code", {}, ".env"), ". Modifie-le là-bas puis redémarre le bot."));
    } else {
      const input = h("input", { type: "password", placeholder: "MTI3…  (Bot → Reset Token)", autocomplete: "off", spellcheck: false });
      blocks.push(
        card(d.configured ? "Changer de bot" : "Connexion", d.configured ? "Remplacer le token" : "Colle le token de ton bot", "Le token reste sur ton installation (dossier data/, accès restreint). Les commandes sont publiées automatiquement.",
          h("div", { class: "stack" },
            field("Token du bot", h("div", { class: "input-row" }, input, actionButton("Connecter", async () => {
              const r = await api("/discord", { token: input.value.trim() });
              input.value = "";
              await refresh();
              toast(`Connecté en tant que ${r.tag}.`);
              rerender();
            }))),
            d.error ? notice("err", d.error) : null,
          ),
        ),
      );
    }

    blocks.push(
      card("Guide", "Créer ton bot en 3 minutes", null,
        h("div", { class: "steps" },
          guideStep("Nouvelle application", ["Va sur ", h("a", { href: "https://discord.com/developers/applications", target: "_blank", rel: "noreferrer", class: "dot" }, "discord.com/developers"), ", « New Application », nomme-la Mnémosyne."]),
          guideStep("Installation", ["Onglet ", h("b", {}, "Installation"), " : coche ", h("b", {}, "User Install"), " et décoche Guild Install."]),
          guideStep("Token", ["Onglet ", h("b", {}, "Bot"), " : « Reset Token », copie-le et colle-le ci-dessus."]),
          guideStep("Installe-le", ["Clique « Ajouter à mon compte », puis /setup en MP avec le bot."]),
        ),
      ),
    );
    return blocks;
  };
  const guideStep = (title, body) => h("article", { class: "step", style: { cursor: "default" } }, h("h3", {}, title, h("span", { class: "dot" }, ".")), h("p", {}, ...body));

  // ─── PRONOTE
  VIEWS.pronote = () => {
    const p = S.pronote;
    const blocks = [hero("Étape 02", "Connecter PRONOTE", "Mnémosyne utilise la même connexion que l'application mobile officielle. Ton mot de passe n'est jamais enregistré : seul un jeton de reconnexion reste sur ton installation.")];

    if (p.security || ui.security) blocks.push(securityCard(p.security || ui.security));

    if (p.linked) {
      blocks.push(
        card("Relié", p.studentName || "Compte PRONOTE", null,
          h("dl", { class: "kv" },
            h("dt", {}, "Élève"), h("dd", {}, `${p.studentName ?? "—"}${p.className ? ` · ${p.className}` : ""}`),
            h("dt", {}, "Espace"), h("dd", {}, p.url ?? "—"),
            h("dt", {}, "Identifiant"), h("dd", {}, p.username ?? "—"),
            h("dt", {}, "Dernière synchro"), h("dd", {}, fmtDate(p.lastSync)),
            p.counts ? [h("dt", {}, "Données"), h("dd", {}, `${p.counts.lessons} cours · ${p.counts.assignments} devoirs · ${p.counts.grades} notes · ${p.counts.discussions} discussions`)] : null,
          ),
          p.lastError ? h("div", { style: { marginTop: "14px" } }, notice("err", h("b", {}, "Dernière erreur : "), p.lastError)) : null,
          p.pausedFor ? h("div", { style: { marginTop: "14px" } }, notice("warn", `PRONOTE a mis l'adresse IP en pause. Reprise dans ${Math.ceil(p.pausedFor / 60000)} min.`)) : null,
          h("hr", { class: "sep" }),
          h("div", { class: "row" },
            actionButton("Synchroniser maintenant", async () => {
              const r = await api("/sync", {});
              await refresh();
              r.ok ? toast("Synchronisé.") : toast(r.error, false);
              rerender();
            }, "primary", "refresh"),
            actionButton("Délier ce compte", async () => {
              if (!confirm("Délier le compte PRONOTE ? Les notifications s'arrêteront.")) return;
              await api("/pronote/unlink", {});
              await refresh();
              rerender();
            }, "danger"),
          ),
        ),
      );
      blocks.push(h("p", { class: "faint" }, "Pour changer de compte, délie celui-ci : le formulaire de connexion réapparaîtra."));
      return blocks;
    }

    blocks.push(schoolCard());
    if (ui.pronoteInstance) blocks.push(loginCard());
    return blocks;
  };

  function schoolCard() {
    const inst = ui.pronoteInstance;
    const urlInput = h("input", { type: "url", placeholder: "https://0000000a.index-education.net/pronote/", value: inst?.url ?? "" });
    const results = h("div", { class: "choice-list" });

    const check = async (url) => {
      const info = await api("/pronote/instance", { url });
      ui.pronoteInstance = info;
      ui.pronoteTab = info.ent ? "qr" : "identifiants";
      rerender();
    };

    return card("1 · Établissement", inst ? inst.name : "Trouve ton espace PRONOTE", inst ? `PRONOTE ${inst.version}${inst.ent ? " · connexion via ENT" : ""}` : "Colle l'adresse de ton espace, ou cherche les établissements autour de toi.",
      h("div", { class: "stack" },
        field("Adresse de l'espace PRONOTE", h("div", { class: "input-row" }, urlInput, actionButton("Vérifier", () => check(urlInput.value))), "C'est l'adresse que tu vois dans le navigateur quand tu es sur PRONOTE."),
        h("div", { class: "row" },
          actionButton("Établissements près de moi", async () => {
            const pos = await new Promise((ok, ko) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(ok, () => ko(new Error("Position refusée par le navigateur.")), { timeout: 10000 }) : ko(new Error("Géolocalisation indisponible.")));
            const r = await api("/pronote/geo", { latitude: pos.coords.latitude, longitude: pos.coords.longitude });
            results.replaceChildren(...(r.results.length ? r.results.map((s) => h("button", { class: "choice", type: "button", onclick: () => check(s.url) }, logoTile(null, s.name), h("span", {}, h("b", {}, s.name), h("small", {}, `${s.postalCode} · ${s.url}`)), h("em", { class: "meta" }, `${s.distance.toFixed(1)} km`))) : [h("p", { class: "faint" }, "Aucun établissement trouvé à proximité.")]));
          }, "secondary", "pin"),
          inst ? h("button", { class: "btn ghost", type: "button", onclick: () => { ui.pronoteInstance = null; rerender(); } }, "Changer d'établissement") : null,
        ),
        results,
      ),
    );
  }

  function loginCard() {
    const inst = ui.pronoteInstance;
    const tabs = [["identifiants", "Identifiant et mot de passe"], ["qr", "QR code"]];
    const body = h("div", { class: "stack" });
    const tabBar = h("div", { class: "tabs" }, tabs.map(([id, label]) => h("button", { type: "button", class: ui.pronoteTab === id ? "on" : "", onclick: () => { ui.pronoteTab = id; rerender(); } }, label, id === "qr" && inst.ent ? h("small", {}, "RECOMMANDÉ") : null)));

    if (ui.pronoteTab === "identifiants") {
      const kind = h("select", {}, h("option", { value: "6" }, "Élève"), h("option", { value: "7" }, "Parent"), h("option", { value: "8" }, "Professeur"));
      const user = h("input", { type: "text", autocomplete: "username", spellcheck: false });
      const pass = h("input", { type: "password", autocomplete: "current-password" });
      if (inst.ent) body.append(notice("warn", h("b", {}, "Ton établissement passe par un ENT. "), "Les identifiants ENT ne fonctionnent pas ici : utilise le QR code, ou des identifiants PRONOTE dédiés fournis par l'établissement."));
      body.append(
        h("div", { class: "grid2" }, field("Type de compte", kind), field("Identifiant PRONOTE", user)),
        field("Mot de passe", pass, "Utilisé une seule fois pour obtenir le jeton de connexion, puis oublié."),
        h("div", { class: "row end" }, actionButton("Se connecter", async () => {
          try {
            const r = await api("/pronote/login", { url: inst.url, kind: Number(kind.value), username: user.value, password: pass.value });
            linkedOk(r);
          } catch (err) {
            if (err.status === 409 && err.security) return askSecurity(err.security);
            throw err;
          }
        }, "primary", "key")),
      );
    } else {
      body.append(qrForm(inst));
    }

    return card("2 · Connexion", "Connecte-toi", null, tabBar, body);
  }

  function qrForm(inst) {
    ui.qr = null;
    const status = h("p", { class: "faint" });
    const fileInput = h("input", { type: "file", accept: "image/*", hidden: true, onchange: (e) => e.target.files[0] && readImage(e.target.files[0]) });
    const drop = h("div", { class: "qr-drop", tabindex: "0", onclick: () => fileInput.click(), onkeydown: (e) => e.key === "Enter" && fileInput.click() }, icon("upload", 34), h("b", {}, "Dépose une capture du QR code"), h("span", { class: "faint" }, "ou clique pour choisir l'image · collage (Ctrl+V) accepté"));
    const video = h("video", { class: "cam", playsinline: true, muted: true, hidden: true });
    const raw = h("textarea", { placeholder: '{"jeton":"…","login":"…","url":"…"}', spellcheck: false, oninput: () => setQr(raw.value.trim() ? raw.value.trim() : null, "texte") });
    const pins = [0, 1, 2, 3].map((i) => h("input", { type: "text", inputmode: "numeric", maxlength: "1", "aria-label": `Chiffre ${i + 1}`, oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, ""); if (e.target.value && pins[i + 1]) pins[i + 1].focus(); }, onkeydown: (e) => { if (e.key === "Backspace" && !e.target.value && pins[i - 1]) pins[i - 1].focus(); } }));
    let stream = null;

    function setQr(text, source) {
      ui.qr = text;
      drop.classList.toggle("ok", !!text && source !== "texte");
      status.textContent = text ? `QR code lu (${source}). Saisis maintenant ton code à 4 chiffres.` : "";
      if (text && source !== "texte") pins[0].focus();
    }

    function decode(imageData) {
      const code = window.jsQR && window.jsQR(imageData.data, imageData.width, imageData.height);
      return code ? code.data : null;
    }

    async function readImage(file) {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      const text = decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
      text ? setQr(text, "image") : toast("Aucun QR code reconnu dans cette image. Recadre-la sur le QR.", false);
    }

    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); const f = e.dataTransfer.files[0]; if (f) readImage(f); });
    const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f) readImage(f); };
    document.addEventListener("paste", onPaste);
    window.addEventListener("hashchange", () => { document.removeEventListener("paste", onPaste); stream?.getTracks().forEach((t) => t.stop()); }, { once: true });

    const camButton = actionButton("Scanner avec la caméra", async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const scan = () => {
        if (!stream) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if (canvas.width) {
          ctx.drawImage(video, 0, 0);
          const text = decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (text) {
            stream.getTracks().forEach((t) => t.stop());
            stream = null;
            video.hidden = true;
            return setQr(text, "caméra");
          }
        }
        requestAnimationFrame(scan);
      };
      scan();
    }, "secondary", "camera");

    return h("div", { class: "stack" },
      h("div", { class: "steps" },
        guideStep("Ouvre PRONOTE", ["Connecte-toi comme d'habitude", inst.ent ? " via ton ENT" : "", " : ", h("a", { href: inst.webLogin, target: "_blank", rel: "noreferrer", class: "dot" }, "ouvrir la page"), "."]),
        guideStep("Génère le QR code", ["Clique sur l'icône de ", h("b", {}, "QR code"), " en haut de PRONOTE (« Pour se connecter à l'application mobile »)."]),
        guideStep("Choisis un code", ["PRONOTE te demande un ", h("b", {}, "code à 4 chiffres"), " : retiens-le."]),
        guideStep("Envoie-le ici", ["Capture d'écran du QR, caméra, ou contenu collé. Vite : il expire en quelques minutes."]),
      ),
      drop, fileInput,
      h("div", { class: "row" }, camButton),
      video,
      h("details", {}, h("summary", { class: "faint", style: { cursor: "pointer" } }, "Coller le contenu du QR code à la place"), h("div", { style: { marginTop: "8px" } }, raw)),
      status,
      field("Code à 4 chiffres choisi dans PRONOTE", h("div", { class: "pin" }, pins)),
      h("div", { class: "row end" }, actionButton("Connecter avec le QR code", async () => {
        const pin = pins.map((p) => p.value).join("");
        if (!ui.qr) throw new Error("Ajoute d'abord le QR code.");
        if (!/^\d{4}$/.test(pin)) throw new Error("Le code doit contenir 4 chiffres.");
        try {
          linkedOk(await api("/pronote/qr", { qr: ui.qr, pin }));
        } catch (err) {
          if (err.status === 409 && err.security) return askSecurity(err.security);
          throw err;
        }
      }, "primary", "qr")),
    );
  }

  function askSecurity(request) {
    ui.security = request;
    toast("PRONOTE demande une vérification supplémentaire.", false);
    rerender();
  }

  function securityCard(req) {
    const pin = h("input", { type: "password", inputmode: "numeric", maxlength: "4", placeholder: "••••", style: { maxWidth: "140px" } });
    const pass = h("input", { type: "password", autocomplete: "new-password" });
    const lines = [];
    if (req.pin) lines.push(field("Code PIN de double authentification", pin, "Le code à 4 chiffres que tu utilises déjà sur PRONOTE."));
    if (req.setupDoubleAuth && !req.pin) lines.push(field("Choisis un code PIN", pin, "PRONOTE impose la double authentification : choisis un code à 4 chiffres et retiens-le."));
    if (req.password) lines.push(field("Nouveau mot de passe", pass, req.passwordRules ? `Entre ${req.passwordRules.min} et ${req.passwordRules.max} caractères, selon les règles de l'établissement.` : "PRONOTE exige de changer le mot de passe provisoire."));
    return card("Vérification", "PRONOTE demande une confirmation", "Cet appareil est nouveau pour PRONOTE. Mnémosyne s'enregistre sous le nom « Mnemosyne » dans tes appareils connectés.",
      h("div", { class: "stack" }, lines,
        h("div", { class: "row end" }, actionButton("Valider", async () => {
          linkedOk(await api("/pronote/security", { pin: pin.value || undefined, newPassword: pass.value || undefined }));
        }, "primary", "check")),
      ),
    );
  }

  async function linkedOk(r) {
    ui.security = null;
    ui.pronoteInstance = null;
    await refresh();
    toast(`Connecté${r.studentName ? ` : ${r.studentName}` : ""}. Première synchronisation en cours…`);
    location.hash = "profil";
    setTimeout(async () => { await refresh(); if (current() === "accueil" || current() === "profil") rerender(); }, 6000);
  }

  // ─── Profil & briefs
  VIEWS.profil = () => {
    const c = S.config;
    const name = h("input", { type: "text", value: c.displayName, maxlength: "40", placeholder: (S.pronote.studentName || "Léa").split(" ").pop() });
    const tz = h("select", {}, ["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/Luxembourg", "America/Montreal", "Indian/Reunion", "America/Guadeloupe", "America/Martinique", "America/Cayenne", "Indian/Mayotte", "Pacific/Noumea", "Pacific/Tahiti", "Africa/Casablanca", "Africa/Dakar", "Africa/Abidjan"].map((z) => h("option", { value: z, selected: z === c.timezone }, z.replace("_", " "))));
    if (![...tz.options].some((o) => o.selected)) tz.prepend(h("option", { value: c.timezone, selected: true }, c.timezone));
    const morning = h("input", { type: "time", value: c.morningBriefTime });
    const evening = h("input", { type: "time", value: c.eveningBriefTime });
    const poll = h("input", { type: "number", min: "2", max: "120", value: c.pollIntervalMinutes });

    return [
      hero("Étape 03", "Profil & briefs", "Comment Mnémosyne t'appelle, et quand elle t'envoie ta journée."),
      card("Profil", "Toi", null,
        h("div", { class: "grid2" },
          field("Prénom utilisé par le bot", name, "Il apparaît dans les messages et sur les images."),
          field("Fuseau horaire", tz, "Toutes les heures (cours, briefs, bus) sont calculées dans ce fuseau."),
        ),
        h("div", { class: "row end", style: { marginTop: "14px" } }, actionButton("Enregistrer", () => saveConfig({ displayName: name.value, timezone: tz.value }))),
      ),
      card("Briefs", "Ta journée en une image", "Le matin pour la journée, le soir pour le lendemain, avec les devoirs et le bouton du sac.",
        h("div", { class: "toggles" },
          toggle(c.morningBriefEnabled, (v) => saveConfig({ morningBriefEnabled: v }), "Brief du matin", "Emploi du temps du jour, salles, annulations, devoirs à rendre."),
          toggle(c.eveningBriefEnabled, (v) => saveConfig({ eveningBriefEnabled: v }), "Brief du soir", "La journée du lendemain, pour préparer ton sac."),
        ),
        h("div", { class: "grid2", style: { marginTop: "14px" } }, field("Heure du brief du matin", morning), field("Heure du brief du soir", evening)),
        h("div", { class: "row end", style: { marginTop: "14px" } },
          S.steps.pronote && S.discord.ready ? actionButton("M'envoyer un brief maintenant", async () => { await api("/test/brief", {}); toast("Brief envoyé en MP."); }, "secondary", "send") : null,
          actionButton("Enregistrer les horaires", () => saveConfig({ morningBriefTime: morning.value, eveningBriefTime: evening.value })),
        ),
      ),
      card("Surveillance", "Fréquence de vérification", "Mnémosyne interroge PRONOTE à intervalle régulier et ne te prévient que si quelque chose change.",
        h("div", { class: "row" }, field("Toutes les … minutes", poll, `${(60 / Math.max(2, Number(c.pollIntervalMinutes))).toFixed(1)} appels par heure. En dessous de 5 min, PRONOTE peut bloquer temporairement l'adresse.`)),
        h("div", { class: "row end" }, actionButton("Enregistrer", () => saveConfig({ pollIntervalMinutes: Number(poll.value) }))),
      ),
    ];
  };

  // ─── Alertes
  VIEWS.alertes = () => {
    const n = S.config.notifications;
    const q = S.config.quietHours;
    const set = (key) => (v) => saveConfig({ notifications: { [key]: v } });
    const start = h("input", { type: "time", value: q.start });
    const end = h("input", { type: "time", value: q.end });
    const imminent = h("input", { type: "color", value: S.config.colorImminent });
    const future = h("input", { type: "color", value: S.config.colorFuture });

    return [
      hero("Étape 04", "Tes alertes", "Choisis ce qui te prévient. Un cours annulé, c'est un seul message, et jamais deux fois la même alerte."),
      card("Notifications", "Ce qui te prévient", null,
        h("div", { class: "toggles" },
          toggle(n.timetable, set("timetable"), "Emploi du temps", "Cours annulé, déplacé, ajouté, changement de salle ou de professeur."),
          toggle(n.evaluations, set("evaluations"), "Évaluations", "Une évaluation apparaît dans l'emploi du temps."),
          toggle(n.homework, set("homework"), "Devoirs", "Nouveau devoir donné."),
          toggle(n.grades, set("grades"), "Notes et moyennes", "Nouvelle note, moyenne qui bouge."),
          toggle(n.discussions, set("discussions"), "Messagerie", "Nouveau message non lu."),
          toggle(n.news, set("news"), "Informations", "Actualités publiées par l'établissement."),
          toggle(n.attendance, set("attendance"), "Vie scolaire", "Absence enregistrée ou justifiée."),
          toggle(n.transport, set("transport"), "Trajets", "Heure de départ, bus supprimé ou en retard, info trafic."),
          toggle(n.sessionExpiry, set("sessionExpiry"), "Connexion PRONOTE perdue", "Si le jeton n'est plus accepté et qu'il faut se reconnecter."),
        ),
      ),
      card("La nuit", "Heures calmes", "Pendant cette plage, les alertes sont mises de côté et arrivent d'un bloc au réveil.",
        toggle(q.enabled, (v) => saveConfig({ quietHours: { enabled: v } }), "Activer les heures calmes"),
        h("div", { class: "row", style: { marginTop: "12px" } }, field("De", start), field("À", end)),
        h("div", { class: "row end" }, actionButton("Enregistrer", () => saveConfig({ quietHours: { start: start.value, end: end.value } }))),
      ),
      card("Code couleur", "Rouge pour demain, ambre pour plus tard", "Couleur de la bande des alertes selon l'échéance. Le rouge reste réservé à l'urgent.",
        h("div", { class: "row" }, field("Aujourd'hui / demain", imminent), field("Plus tard", future)),
        h("div", { class: "row end" },
          S.steps.pronote && S.discord.ready ? actionButton("Envoyer une alerte de test", async () => { await api("/test/alerte", {}); toast("Alerte de test envoyée."); }, "secondary", "send") : null,
          actionButton("Enregistrer", () => saveConfig({ colorImminent: imminent.value, colorFuture: future.value })),
        ),
      ),
    ];
  };

  // ─── Trajets
  VIEWS.trajets = () => {
    const t = S.transport;
    const tabs = [
      ["reseau", "1 · Réseau", !!t.network],
      ["arrets", "2 · Arrêts", !!(t.homeStop && t.schoolStop)],
      ["reglages", "3 · Marges & alertes", t.enabled],
      ["apercu", "4 · Aperçu", false],
    ];
    if (!t.network && ui.transportTab !== "reseau") ui.transportTab = "reseau";
    const bar = h("div", { class: "tabs" }, tabs.map(([id, label, ok]) => h("button", { type: "button", class: ui.transportTab === id ? "on" : "", onclick: () => { ui.transportTab = id; rerender(); }, disabled: id !== "reseau" && !t.network }, label, ok ? h("small", {}, "✓") : null)));

    const blocks = [
      hero("Étape 05 · optionnel", "Tes trajets", "Bus, tram, métro, car ou train : Mnémosyne calcule l'heure à laquelle quitter la maison selon ton premier cours, et te prévient si ton bus est supprimé ou en retard."),
    ];

    if (t.network) {
      blocks.push(
        h("section", { class: "card raised" },
          h("div", { class: "row" },
            logoTile(t.network.logo, t.network.name, true),
            h("div", { style: { flex: "1", minWidth: "200px" } }, kicker(t.enabled ? "Actif" : "Inactif", t.enabled ? "ok" : "warn"), h("h2", {}, t.network.name, h("span", { class: "dot" }, ".")), h("p", { class: "faint" }, [t.network.area, t.indexed ? `${t.indexed.stops} arrêts · ${t.indexed.lines} lignes` : null, t.network.realtime ? "temps réel" : "horaires théoriques"].filter(Boolean).join(" · "))),
            t.homeStop && t.schoolStop ? toggle(t.enabled, (v) => saveTransport({ enabled: v }, v ? "Trajets activés." : "Trajets désactivés.").then(rerender), "Alertes de trajet") : null,
          ),
          t.progress ? h("div", { style: { marginTop: "14px" } }, h("p", { class: "faint" }, `${t.progress.step}… ${Math.round(t.progress.ratio * 100)} %`), h("div", { class: "progress" }, h("i", { style: { width: `${Math.round(t.progress.ratio * 100)}%` } }))) : null,
        ),
      );
      if (t.progress) setTimeout(async () => { if (current() === "trajets") { await refresh(); rerender(); } }, 1500);
    }

    blocks.push(bar);
    blocks.push(...[{ reseau: networkTab, arrets: stopsTab, reglages: settingsTab, apercu: previewTab }[ui.transportTab]()].flat());
    return blocks;
  };

  function networkTab() {
    const t = S.transport;
    const search = h("input", { type: "search", placeholder: "Ville, réseau ou collectivité : Lyon, TCL, Ilévia, Gironde…" });
    const grid = h("div", { class: "network-grid" }, h("p", { class: "faint" }, "Chargement du catalogue national…"));
    const load = debounce(async () => {
      try {
        const r = await api(`/transport/networks?q=${encodeURIComponent(search.value)}`);
        grid.replaceChildren(...(r.results.length ? r.results.map(networkTile) : [h("p", { class: "faint" }, "Aucun réseau ne correspond.")]));
      } catch (err) {
        grid.replaceChildren(notice("err", err.message));
      }
    });
    search.addEventListener("input", load);
    load();

    function networkTile(n) {
      return h("button", { type: "button", class: `network ${t.networkId === n.id ? "on" : ""}`, onclick: async () => {
        await api("/transport/network", { id: n.id });
        await refresh();
        ui.transportTab = "arrets";
        toast(`${n.name} sélectionné. Chargement des horaires…`);
        rerender();
      } },
        logoTile(n.logo, n.name), h("b", {}, n.name), h("small", {}, n.area || n.authority || "—"),
        h("div", { class: "tags" }, n.kinds.slice(0, 3).map((k) => h("span", {}, k)), n.realtime ? h("span", { class: "rt" }, "temps réel") : null),
      );
    }

    const name = h("input", { type: "text", placeholder: "Nom du réseau" });
    const gtfs = h("input", { type: "url", placeholder: "https://…/gtfs.zip" });
    const tu = h("input", { type: "url", placeholder: "https://…/trip-updates (optionnel)" });
    const al = h("input", { type: "url", placeholder: "https://…/alerts (optionnel)" });

    return [
      card("Catalogue", "Choisis ton réseau", "Tous les réseaux publiés sur le Point d'Accès National (transport.data.gouv.fr) : urbains, interurbains, scolaires, régionaux. Les logos viennent des éditeurs.",
        h("div", { class: "stack" }, search, grid)),
      card("Ailleurs", "Réseau hors catalogue", "Hors de France ou flux privé : n'importe quel GTFS fonctionne, avec un flux GTFS-RT en option pour le temps réel.",
        h("div", { class: "grid2" }, field("Nom", name), field("GTFS (zip)", gtfs), field("GTFS-RT · Trip updates", tu), field("GTFS-RT · Alertes", al)),
        h("div", { class: "row end", style: { marginTop: "12px" } }, actionButton("Utiliser ce flux", async () => {
          await api("/transport/network", { custom: { name: name.value, gtfsUrl: gtfs.value, tripUpdatesUrl: tu.value, alertsUrl: al.value } });
          await refresh();
          ui.transportTab = "arrets";
          rerender();
        }, "secondary", "link")),
      ),
    ];
  }

  function stopsTab() {
    const t = S.transport;
    if (!t.indexed) return [notice("info", "Les horaires du réseau sont en cours de chargement. Cette page se mettra à jour toute seule.")];
    const target = ui.stopTarget;
    const search = h("input", { type: "search", placeholder: "Nom de l'arrêt…" });
    const list = h("div", { class: "choice-list" });

    const show = (stops) => list.replaceChildren(...(stops.length ? stops.map((s) => h("button", { type: "button", class: "choice", onclick: async () => {
      await saveTransport({ [target === "home" ? "homeStopId" : "schoolStopId"]: s.id }, `Arrêt ${target === "home" ? "maison" : "établissement"} : ${s.name}`);
      ui.stopTarget = target === "home" && !S.transport.schoolStop ? "school" : target;
      rerender();
    } }, icon("pin"), h("span", {}, h("b", {}, s.name), h("small", {}, s.meters !== undefined ? `à ${s.meters} m` : `${s.lines.length} ligne${s.lines.length > 1 ? "s" : ""}`)), h("span", { class: "lines" }, s.lines.slice(0, 6).map(lineBadge)))) : [h("p", { class: "faint" }, "Aucun arrêt trouvé.")]));

    search.addEventListener("input", debounce(async () => {
      if (search.value.trim().length < 2) return list.replaceChildren();
      show((await api(`/transport/stops?q=${encodeURIComponent(search.value)}`)).results);
    }));

    const stopBox = (key, label, stop) =>
      h("button", { type: "button", class: `choice ${target === key ? "on" : ""}`, onclick: () => { ui.stopTarget = key; rerender(); } },
        logoTile(null, key === "home" ? "⌂" : "É"), h("span", {}, h("small", {}, label), h("b", {}, stop ? stop.name : "À choisir")), stop ? h("span", { class: "lines" }, stop.lines.slice(0, 5).map(lineBadge)) : null);

    const lineSet = new Set(t.lines);
    return [
      card("Arrêts", "D'où tu pars, où tu vas", "Choisis l'arrêt près de chez toi et celui près de ton établissement. Les quais d'un même arrêt sont regroupés.",
        h("div", { class: "grid2" }, stopBox("home", "Arrêt près de la maison", t.homeStop), stopBox("school", "Arrêt près de l'établissement", t.schoolStop)),
        h("hr", { class: "sep" }),
        h("div", { class: "stack" },
          kicker(target === "home" ? "Choisir l'arrêt maison" : "Choisir l'arrêt établissement"),
          h("div", { class: "input-row" }, search, actionButton("Près de moi", async () => {
            const pos = await new Promise((ok, ko) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(ok, () => ko(new Error("Position refusée."))) : ko(new Error("Géolocalisation indisponible.")));
            show((await api(`/transport/stops?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`)).results);
          }, "secondary", "pin")),
          list,
        ),
      ),
      t.homeStop && t.schoolStop
        ? card("Lignes", "Lignes autorisées", t.directLines.length ? "Lignes qui relient directement tes deux arrêts. Désélectionne celles que tu ne prends jamais ; aucune sélection = toutes." : "Aucune ligne ne relie directement ces deux arrêts. Choisis des arrêts sur une même ligne.",
            h("div", { class: "lines pick" }, t.directLines.map((l) => {
              const b = lineBadge(l);
              b.classList.toggle("on", lineSet.size === 0 || lineSet.has(l.id));
              b.tabIndex = 0;
              b.addEventListener("click", () => {
                const all = t.directLines.map((x) => x.id);
                const sel = new Set(lineSet.size ? lineSet : all);
                sel.has(l.id) ? sel.delete(l.id) : sel.add(l.id);
                const next = sel.size === all.length ? [] : [...sel];
                saveTransport({ lines: next }, "Lignes mises à jour.").then(rerender);
              });
              return b;
            })),
            h("div", { class: "row end", style: { marginTop: "14px" } }, h("button", { class: "btn primary", type: "button", onclick: () => { ui.transportTab = "reglages"; rerender(); } }, "Continuer →")),
          )
        : null,
    ];
  }

  function settingsTab() {
    const t = S.transport;
    const num = (key, min, max) => h("input", { type: "number", min, max, value: t[key], "data-key": key });
    const inputs = {
      walkToHomeStop: num("walkToHomeStop", 0, 60),
      walkFromSchoolStop: num("walkFromSchoolStop", 0, 60),
      walkToSchoolStop: num("walkToSchoolStop", 0, 60),
      walkFromHomeStop: num("walkFromHomeStop", 0, 60),
      arriveMinBefore: num("arriveMinBefore", 0, 90),
      notifyLeadMinutes: num("notifyLeadMinutes", 0, 120),
      delayAlertMinutes: num("delayAlertMinutes", 1, 30),
      morningWatchMinutes: num("morningWatchMinutes", 5, 180),
    };
    const save = () => saveTransport(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, Number(el.value)])));
    return [
      card("Marche", "Temps à pied", "Entre chez toi, les arrêts et l'établissement. Le temps en bus, lui, vient des horaires officiels : plus besoin de le deviner.",
        h("div", { class: "grid2" },
          field("Maison → arrêt", inputs.walkToHomeStop, "minutes"),
          field("Arrêt → établissement", inputs.walkFromSchoolStop, "minutes"),
          field("Établissement → arrêt (retour)", inputs.walkToSchoolStop, "minutes"),
          field("Arrêt → maison (retour)", inputs.walkFromHomeStop, "minutes"),
        ),
      ),
      card("Matin", "Heure de départ", "Mnémosyne retient le dernier passage qui te fait arriver à l'heure : tu dors le plus longtemps possible, sans être en retard.",
        h("div", { class: "grid2" },
          field("Arriver au moins … min avant le cours", inputs.arriveMinBefore),
          field("Préavis avant de partir", inputs.notifyLeadMinutes, "minutes avant l'heure de départ"),
          field("Alerter si retard ≥", inputs.delayAlertMinutes, "minutes"),
          field("Surveiller le bus pendant", inputs.morningWatchMinutes, "minutes avant son passage"),
        ),
        h("div", { class: "row end", style: { marginTop: "14px" } }, actionButton("Enregistrer", save)),
      ),
      card("Options", "Alertes de trajet", null,
        h("div", { class: "toggles" },
          toggle(t.eveningEnabled, (v) => saveTransport({ eveningEnabled: v }), "Fiche de retour", "À la fin des cours : les prochains départs vers la maison."),
          toggle(t.disruptionAlerts, (v) => saveTransport({ disruptionAlerts: v }), "Info trafic", S.transport.network?.alerts ? "Messages de perturbation publiés sur tes lignes." : "Ce réseau ne publie pas de flux de perturbations."),
        ),
        t.homeStop && t.schoolStop && !t.enabled ? h("div", { class: "row end", style: { marginTop: "14px" } }, actionButton("Activer les trajets", async () => { await save(); await saveTransport({ enabled: true }, "Trajets activés."); ui.transportTab = "apercu"; rerender(); })) : null,
      ),
    ];
  }

  function previewTab() {
    const out = h("div", { class: "journey" }, h("p", { class: "faint" }, "Calcul en cours…"));
    const img = h("div", { class: "preview-img" }, h("p", { class: "faint" }, "…"));
    let sens = "aller";
    const day = (() => { const d = new Date(); d.setDate(d.getDate() + (d.getHours() >= 12 ? 1 : 0)); while (d.getDay() === 0) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
    const dayInput = h("input", { type: "date", value: day, style: { maxWidth: "180px" } });

    const load = async () => {
      out.replaceChildren(h("p", { class: "faint" }, "Calcul en cours…"));
      try {
        const { plan } = await api(`/transport/preview?sens=${sens}&day=${dayInput.value}`);
        if (!plan) return out.replaceChildren(notice("warn", "Choisis d'abord tes deux arrêts."));
        const best = plan.options[plan.best];
        const head = plan.kind === "morning"
          ? plan.firstLesson ? `Premier cours : ${plan.firstLesson.subject} à ${plan.firstLesson.start} · arrivée au plus tard ${plan.deadline}` : "Pas de cours ce jour-là (ou emploi du temps pas encore synchronisé)."
          : plan.releaseAt ? `Sortie à ${plan.releaseAt}` : "Pas de cours ce jour-là.";
        out.replaceChildren(
          h("div", { class: "row" }, h("div", {}, kicker(best ? "Partir à" : "Aucun passage à l'heure", best ? "" : "warn"), h("div", { class: "bigtime" }, best ? best.leaveAt : "—")), h("p", { class: "muted", style: { flex: "1", minWidth: "220px" } }, head, plan.notifyAt ? ` · préavis à ${plan.notifyAt}` : "")),
          ...plan.options.map((o, i) => h("div", { class: `trip ${i === plan.best ? "best" : ""} ${o.viable ? "" : "off"}` },
            lineBadge(o), h("b", {}, `${o.departure} → ${o.arrival}`),
            h("span", { class: "muted" }, `partir ${o.leaveAt} · arrivée ${o.arriveAt}`, h("small", { class: "hide-sm" }, ` · vers ${o.headsign}`)),
            h("span", { class: `chip ${o.cancelled ? "err" : !o.viable ? "" : o.delay >= 2 ? "warn" : i === plan.best ? "hue" : "ok"}` }, o.cancelled ? "supprimé" : !o.viable ? (o.issue || "trop tard") : i === plan.best ? "retenu" : o.delay ? `+${o.delay} min` : o.realtime ? "à l'heure" : "théorique"))),
        );
        const pic = h("img", { alt: "Aperçu de l'image de trajet", src: `/api/images/trajet?sens=${sens}&day=${dayInput.value}&t=${Date.now()}` });
        pic.onload = () => img.replaceChildren(pic);
        pic.onerror = () => img.replaceChildren(h("p", { class: "faint" }, "Image indisponible."));
      } catch (err) {
        out.replaceChildren(notice("err", err.message));
      }
    };
    dayInput.addEventListener("change", load);
    load();

    return [
      card("Simulation", "Ton trajet", "Calculé avec tes vrais cours et les horaires officiels du réseau.",
        h("div", { class: "row", style: { marginBottom: "14px" } }, segmented([["aller", "Aller (matin)"], ["retour", "Retour (soir)"]], sens, (v) => { sens = v; load(); }), dayInput),
        out,
        h("hr", { class: "sep" }),
        h("div", { class: "row end" }, S.discord.ready ? actionButton("M'envoyer la fiche maintenant", async () => { await api("/test/trajet", {}); toast("Fiche de trajet envoyée."); }, "secondary", "send") : null),
      ),
      card("Image", "Ce que tu recevras", null, img),
    ];
  }

  // ─── Sac
  VIEWS.sac = () => {
    const subjects = [...new Set([...S.pronote.subjects, ...Object.keys(S.config.bag).filter((k) => !S.pronote.subjects.some((s) => keyOf(s) === k))])];
    const bag = JSON.parse(JSON.stringify(S.config.bag));
    const labelOf = (s) => S.pronote.subjects.find((x) => keyOf(x) === keyOf(s)) || s;
    const list = h("div", { class: "grid2" });

    const draw = () => list.replaceChildren(...(subjects.length ? subjects.map((subject) => {
      const key = keyOf(subject);
      const items = bag[key] || (bag[key] = []);
      return h("div", { class: "bag-subject" },
        h("header", {}, h("i", { style: { background: S.config.subjectColors[key] || "var(--hue)" } }), h("b", {}, labelOf(subject)), h("span", { class: "faint", style: { marginLeft: "auto" } }, `${items.length} élément${items.length > 1 ? "s" : ""}`)),
        items.map((it, i) => h("div", { class: "bag-item" },
          h("input", { type: "color", value: it.color, oninput: (e) => (it.color = e.target.value) }),
          h("input", { type: "text", value: it.label, placeholder: "Classeur, cahier, calculatrice…", oninput: (e) => (it.label = e.target.value) }),
          h("button", { class: "btn ghost small", type: "button", title: "Retirer", onclick: () => { items.splice(i, 1); draw(); } }, icon("trash", 15)),
        )),
        h("button", { class: "btn ghost small", type: "button", onclick: () => { items.push({ label: "", color: "#f472b6" }); draw(); } }, icon("plus", 15), "Ajouter"),
      );
    }) : [h("p", { class: "faint" }, "Les matières apparaîtront après la première synchronisation PRONOTE. Tu peux aussi en ajouter une à la main.")]));
    draw();

    const extra = h("input", { type: "text", placeholder: "Ajouter une matière (ex : Arts plastiques)" });
    return [
      hero("Le soir", "Ton sac", "Le matériel de chaque matière, avec sa couleur. La veille, le bot te le fait valider matière par matière."),
      card("Matériel", "Par matière", null,
        list,
        h("hr", { class: "sep" }),
        h("div", { class: "row" },
          h("div", { class: "input-row", style: { flex: "1", minWidth: "240px" } }, extra, h("button", { class: "btn secondary", type: "button", onclick: () => { const v = extra.value.trim(); if (v && !subjects.includes(v)) { subjects.push(v); extra.value = ""; draw(); } } }, icon("plus", 15), "Matière")),
          actionButton("Enregistrer le sac", () => {
            const payload = {};
            for (const s of subjects) payload[labelOf(s)] = bag[keyOf(s)] || [];
            return saveConfig({ bag: payload }, "Sac enregistré.");
          }),
        ),
      ),
    ];
  };
  const keyOf = (name) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  // ─── Apparence
  VIEWS.apparence = () => {
    const theme = S.config.imageTheme;
    const panelTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const colors = { ...S.config.subjectColors };
    const subjects = S.pronote.subjects;
    const kinds = [["timetable", "Emploi du temps"], ["notifications", "Alertes"], ["grades", "Notes"], ["bag", "Sac"], ["transport", "Trajets"]];

    return [
      hero("Thèmes", "Apparence", "Le thème du panneau, celui de chaque image envoyée, et la couleur de chaque matière."),
      card("Panneau", "Thème du panneau", "Mémorisé dans ce navigateur.",
        segmented([["dark", "Nuit"], ["light", "Jour"]], panelTheme, (v) => {
          if (v === "light") document.documentElement.dataset.theme = "light";
          else delete document.documentElement.dataset.theme;
          try { localStorage.setItem("mnemo-theme", v); } catch {}
        }),
      ),
      card("Images", "Thème des images", "Chaque type d'image peut être clair ou sombre.",
        h("div", { class: "toggles" }, kinds.map(([k, label]) => h("div", { class: "toggle-line" }, h("b", {}, label), segmented([["sombre", "Sombre"], ["clair", "Clair"]], theme[k], (v) => saveConfig({ imageTheme: { [k]: v } }, `Thème « ${label} » : ${v}.`))))),
        h("div", { class: "row end", style: { marginTop: "12px" } },
          actionButton("Tout en sombre", () => saveConfig({ imageTheme: Object.fromEntries(kinds.map(([k]) => [k, "sombre"])) }).then(rerender), "secondary", "moon"),
          actionButton("Tout en clair", () => saveConfig({ imageTheme: Object.fromEntries(kinds.map(([k]) => [k, "clair"])) }).then(rerender), "secondary", "sun"),
        ),
      ),
      card("Matières", "Couleurs des matières", subjects.length ? "Par défaut, la couleur PRONOTE ou une teinte générée. Le rouge est évité : il signale les annulations." : "Disponible après la première synchronisation PRONOTE.",
        h("div", { class: "grid3" }, subjects.map((s) => h("label", { class: "row", style: { gap: "10px" } }, h("input", { type: "color", value: colors[keyOf(s)] || "#9a95a3", oninput: (e) => (colors[keyOf(s)] = e.target.value) }), h("span", {}, s)))),
        subjects.length ? h("div", { class: "row end", style: { marginTop: "14px" } },
          h("button", { class: "btn ghost", type: "button", onclick: () => saveConfig({ subjectColors: {} }, "Couleurs par défaut rétablies.").then(rerender) }, "Rétablir"),
          actionButton("Enregistrer les couleurs", () => {
            const payload = {};
            for (const s of subjects) if (colors[keyOf(s)]) payload[s] = colors[keyOf(s)];
            return saveConfig({ subjectColors: payload });
          })) : null,
      ),
      imagesCard(),
    ];
  };

  // ─── Avancé
  VIEWS.avance = () => {
    const confirmInput = h("input", { type: "text", placeholder: "EFFACER", style: { maxWidth: "200px" } });
    return [
      hero("Maintenance", "Avancé", "Tests d'envoi, état du bot et remise à zéro."),
      card("Tests", "Vérifier que tout arrive", "Chaque bouton envoie un vrai message privé.",
        h("div", { class: "row" },
          actionButton("Brief du jour", async () => { await api("/test/brief", {}); toast("Brief envoyé."); }, "secondary", "send"),
          actionButton("Alerte", async () => { await api("/test/alerte", {}); toast("Alerte envoyée."); }, "secondary", "bell"),
          actionButton("Fiche de trajet", async () => { await api("/test/trajet", {}); toast("Fiche envoyée."); }, "secondary", "bus"),
          actionButton("Synchroniser PRONOTE", async () => { const r = await api("/sync", {}); await refresh(); r.ok ? toast("Synchronisé.") : toast(r.error, false); }, "secondary", "refresh"),
        ),
      ),
      card("État", "Diagnostic", null,
        h("dl", { class: "kv" },
          h("dt", {}, "Discord"), h("dd", {}, S.discord.ready ? `connecté (${S.discord.botTag})` : S.discord.configured ? "token présent, non connecté" : "aucun token"),
          h("dt", {}, "PRONOTE"), h("dd", {}, S.pronote.linked ? `relié · dernière synchro ${fmtDate(S.pronote.lastSync)}` : "non relié"),
          h("dt", {}, "Vérification"), h("dd", {}, `toutes les ${S.config.pollIntervalMinutes} min`),
          h("dt", {}, "Trajets"), h("dd", {}, S.transport.network ? `${S.transport.network.name}${S.transport.indexed ? ` · index du ${fmtDate(S.transport.indexed.builtAt)}` : ""}` : "non configurés"),
          h("dt", {}, "Commandes"), h("dd", {}, h("code", {}, "/settings"), " ouvre ce panneau depuis Discord."),
        ),
      ),
      h("section", { class: "card danger-zone" },
        h("header", {}, h("div", {}, kicker("Zone sensible", "warn"), dotTitle("h2", "Tout effacer"), h("p", {}, "Supprime la configuration, le compte PRONOTE lié, l'historique et le token Discord saisi ici. Irréversible."))),
        h("div", { class: "row" }, confirmInput, actionButton("Effacer définitivement", async () => {
          if (confirmInput.value !== "EFFACER") throw new Error("Tape EFFACER pour confirmer.");
          await api("/reset", { confirm: "EFFACER" });
          location.reload();
        }, "danger", "trash")),
      ),
    ];
  };

  // ─────────────────────────────────────────────────────── démarrage
  $("#menu").addEventListener("click", () => {
    const nav = $("#nav");
    nav.classList.toggle("open");
    $("#menu").setAttribute("aria-expanded", String(nav.classList.contains("open")));
  });
  $("#logout").addEventListener("click", async () => {
    await api("/logout", {});
    location.href = "/";
  });
  window.addEventListener("hashchange", route);
  route().catch((err) => {
    $("#main").replaceChildren(notice("err", `Impossible de charger le panneau : ${err.message}`));
  });
})();
