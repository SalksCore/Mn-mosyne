/* Couche panthéon partagée : étoiles déterministes, frises de méandres,
   nom grec en creux et emblème néon. Même rendu que le site. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  let uid = 0;

  /** Frise de grecques : une clé en spirale tous les `step` px, posée sur un filet. */
  function meander({ step = 22, h = 14, opacity = 0.24, cls = "" } = {}) {
    const id = `meander-${++uid}`;
    const u = step / 6;
    const k = h / 4;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", `meander ${cls}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", String(h));
    svg.setAttribute("aria-hidden", "true");
    svg.style.opacity = String(opacity);
    svg.innerHTML =
      `<defs><pattern id="${id}" width="${step}" height="${h}" patternUnits="userSpaceOnUse">` +
      `<path d="M0 ${h} V0 H${4 * u} V${3 * k} H${1.5 * u} V${1.4 * k} H${2.6 * u}" fill="none" stroke="var(--hue)" stroke-width="1.6" stroke-linecap="square"/>` +
      `</pattern></defs><rect width="100%" height="${h}" fill="url(#${id})"/>` +
      `<line x1="0" x2="100%" y1="${h - 0.8}" y2="${h - 0.8}" stroke="var(--hue)" stroke-width="1.6"/>`;
    return svg;
  }

  function stars(count = 60, seed = 7) {
    let s = seed;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const box = document.createElement("div");
    box.className = "stars";
    for (let i = 0; i < count; i++) {
      const star = document.createElement("i");
      const size = 1 + r() * 2.2;
      star.style.cssText = `left:${r() * 100}%;top:${r() * 100}%;width:${size}px;height:${size}px;opacity:${0.15 + r() * 0.45};animation-delay:${(r() * 4).toFixed(2)}s`;
      if (i % 4 === 0) star.className = "tw";
      box.appendChild(star);
    }
    return box;
  }

  /** Décor complet d'un bandeau : étoiles, nom grec, emblème, frises. */
  function layer(host, { greek = "ΜΝΗΜΟΣΥΝΗ", emblem = true, count = 64, seed = 7 } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "pantheon";
    wrap.setAttribute("aria-hidden", "true");
    wrap.appendChild(stars(count, seed));
    if (greek) {
      const name = document.createElement("span");
      name.className = "greek-name";
      name.textContent = greek;
      wrap.appendChild(name);
    }
    if (emblem) {
      const img = document.createElement("img");
      img.className = "emblem";
      img.src = "/img/emblem.svg";
      img.alt = "";
      wrap.appendChild(img);
    }
    wrap.appendChild(meander({ cls: "top" }));
    wrap.appendChild(meander({ cls: "bottom" }));
    host.prepend(wrap);
  }

  /** Séparateur : deux frises, le point de la marque au centre. */
  function frieze() {
    const el = document.createElement("div");
    el.className = "frieze";
    el.setAttribute("aria-hidden", "true");
    el.append(meander({ step: 20, h: 18, opacity: 0.3 }), document.createElement("span"), meander({ step: 20, h: 18, opacity: 0.3 }));
    return el;
  }

  window.Pantheon = { meander, stars, layer, frieze };
})();
