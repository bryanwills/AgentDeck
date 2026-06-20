// AgentDeck 10" — living terrarium. Creatures swim; state drives behaviour.
// Roster-linked: setActive(id) dims the school and spotlights one creature.
window.TENT = (function () {
  const { AGENTS, STATE } = window.TEN;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function Terrarium(container, sessions, opts) {
    opts = opts || {};
    const base = opts.size || 38;       // base creature px
    const onHover = opts.onHover || function () {};
    const showTags = opts.tags !== false;
    container.classList.add('terr');

    // bubbles
    const bubbles = [];
    const nb = opts.bubbles == null ? 7 : opts.bubbles;
    for (let i = 0; i < nb; i++) {
      const b = document.createElement('div');
      b.className = 'bubble';
      const r = rnd(4, 11);
      b.style.width = b.style.height = r + 'px';
      container.appendChild(b);
      bubbles.push({ el: b, fx: Math.random(), fy: rnd(0.2, 1), spd: rnd(0.03, 0.08), r });
    }

    const creatures = sessions.map((s, i) => {
      const ag = AGENTS[s.agent];
      const st = STATE[s.state];
      const node = document.createElement('div');
      node.className = 'cr' + (showTags ? '' : '');
      node.dataset.sid = s.id;
      const sizeFactor = s.state === 'awaiting' ? 1.16 : s.state === 'idle' ? 0.82 : s.state === 'error' ? 0.95 : 1;
      const sz = base * sizeFactor;
      const badge = s.state === 'awaiting'
        ? '<div class="ask">?</div>'
        : s.state === 'error' ? '<div class="bang">!</div>' : '';
      node.innerHTML =
        '<div class="body" style="color:' + ag.color + ';width:' + sz + 'px;height:' + sz + 'px">' +
          '<div class="glow" style="background:radial-gradient(circle,' + st.color + ',transparent 70%)"></div>' +
          window.TENC.svg(ag.creature, sz, ag.color) + badge +
        '</div>' +
        (showTags ? '<div class="tag">' + ag.short + ' · ' + s.project + '</div>' : '');
      container.appendChild(node);
      node.addEventListener('pointerenter', () => onHover(s.id));
      node.addEventListener('pointerleave', () => onHover(null));
      node.addEventListener('click', (e) => { e.stopPropagation(); if (opts.onClick) opts.onClick(s); });

      // band by state
      const band = s.state === 'awaiting' ? rnd(0.26, 0.40)
        : s.state === 'processing' ? rnd(0.34, 0.58)
        : s.state === 'error' ? rnd(0.66, 0.78)
        : rnd(0.70, 0.84); // idle near floor
      return {
        s, node, sz,
        fx: rnd(0.12, 0.88), fy: band, band,
        vx: rnd(-0.05, 0.05), vy: 0,
        ph: Math.random() * Math.PI * 2,
        spd: s.state === 'processing' ? rnd(0.10, 0.16) : s.state === 'idle' ? rnd(0.012, 0.03) : rnd(0.03, 0.06),
        amp: s.state === 'processing' ? rnd(0.015, 0.03) : rnd(0.006, 0.014),
      };
    });

    let W = container.clientWidth || container.getBoundingClientRect().width || 600;
    let H = container.clientHeight || container.getBoundingClientRect().height || 300;
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w) W = w; if (h) H = h;
    });
    ro.observe(container);

    function place(c, t) {
      const bobY = Math.sin(t * 1.3 + c.ph) * c.amp;
      const px = c.fx * W - c.sz / 2;
      const py = (c.fy + bobY) * H - c.sz / 2;
      const tilt = clamp(c.vx * 90, -10, 10);
      c.node.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px) rotate(' + tilt.toFixed(1) + 'deg)';
    }
    // seed first paint so creatures are spread even before rAF settles
    creatures.forEach((c) => place(c, 0));
    bubbles.forEach((b) => { b.el.style.transform = 'translate(' + (b.fx * W) + 'px,' + (b.fy * H) + 'px)'; });

    let last = performance.now(), running = true, raf = 0;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (now - (frame._t || 0) < 33) return; // ~30fps
      const t = now / 1000; frame._t = now;
      const mx = 0.07;
      for (const c of creatures) {
        // horizontal wander
        c.vx += rnd(-1, 1) * c.spd * dt;
        c.vx = clamp(c.vx, -c.spd * 1.6, c.spd * 1.6);
        c.fx += c.vx * dt;
        if (c.fx < mx) { c.fx = mx; c.vx = Math.abs(c.vx); }
        if (c.fx > 1 - mx) { c.fx = 1 - mx; c.vx = -Math.abs(c.vx); }
        // vertical steer toward band + bob
        c.fy += (c.band - c.fy) * 0.9 * dt;
        const bobY = Math.sin(t * 1.3 + c.ph) * c.amp;
        const px = c.fx * W - c.sz / 2;
        const py = (c.fy + bobY) * H - c.sz / 2;
        const tilt = clamp(c.vx * 90, -10, 10);
        const sc = c.s.state === 'processing' ? 1 + Math.sin(t * 2.2 + c.ph) * 0.04 : 1;
        c.node.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px) rotate(' + tilt.toFixed(1) + 'deg) scale(' + sc.toFixed(3) + ')';
      }
      for (const b of bubbles) {
        b.fy -= b.spd * dt;
        if (b.fy < 0.05) { b.fy = rnd(0.95, 1.05); b.fx = Math.random(); }
        const wob = Math.sin(t * 2 + b.fx * 10) * 0.01;
        b.el.style.transform = 'translate(' + ((b.fx + wob) * W).toFixed(1) + 'px,' + (b.fy * H).toFixed(1) + 'px)';
        b.el.style.opacity = String(clamp(b.fy, 0, 0.7));
      }
    }
    raf = requestAnimationFrame(frame);

    return {
      setActive(id) {
        container.classList.toggle('hover-any', !!id);
        creatures.forEach((c) => c.node.classList.toggle('active', c.s.id === id));
      },
      updateState(id, state) {
        const c = creatures.find((x) => x.s.id === id);
        if (!c || c.s.state === state) return;
        c.s.state = state;
        const ag = AGENTS[c.s.agent], st = STATE[state];
        c.band = state === 'awaiting' ? rnd(0.26, 0.40) : state === 'processing' ? rnd(0.34, 0.58)
          : state === 'error' ? rnd(0.66, 0.78) : rnd(0.70, 0.84);
        c.spd = state === 'processing' ? rnd(0.10, 0.16) : state === 'idle' ? rnd(0.012, 0.03) : rnd(0.03, 0.06);
        c.amp = state === 'processing' ? rnd(0.015, 0.03) : rnd(0.006, 0.014);
        const f = state === 'awaiting' ? 1.16 : state === 'idle' ? 0.82 : state === 'error' ? 0.95 : 1;
        c.sz = base * f;
        const body = c.node.querySelector('.body');
        body.style.width = body.style.height = c.sz + 'px';
        body.querySelector('svg').setAttribute('width', c.sz);
        body.querySelector('svg').setAttribute('height', c.sz);
        body.querySelector('.glow').style.background = 'radial-gradient(circle,' + st.color + ',transparent 70%)';
        const old = body.querySelector('.ask,.bang'); if (old) old.remove();
        if (state === 'awaiting') body.insertAdjacentHTML('beforeend', '<div class="ask">?</div>');
        else if (state === 'error') body.insertAdjacentHTML('beforeend', '<div class="bang">!</div>');
      },
      destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
      nodes: creatures,
    };
  }

  return { Terrarium };
})();
