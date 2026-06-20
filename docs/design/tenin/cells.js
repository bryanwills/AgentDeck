// AgentDeck 10" — session cells + shared detail overlay.
window.TENL = (function () {
  const { AGENTS, STATE } = window.TEN;

  function ava(s, size) {
    const ag = AGENTS[s.agent];
    return '<span class="ava" style="color:' + ag.color + '">' + window.TENC.svg(ag.creature, size || 22, ag.color) + '</span>';
  }
  function toolHTML(tool) {
    return '<span class="dollar">▸ </span>' + tool;
  }

  // tier: 'xl' | 'lg' | 'md' | 'sm' | 'xs'
  function renderCell(s, tier) {
    const ag = AGENTS[s.agent], st = STATE[s.state];
    // awaiting / error always carry a prompt + buttons — never collapse them
    if ((s.state === 'awaiting' || s.state === 'error') && (tier === 'xs' || tier === 'sm')) tier = 'md';
    const el = document.createElement('div');
    el.className = 'cell s-' + s.state + ' t-' + tier;
    el.dataset.sid = s.id;
    el.style.setProperty('--accent', st.color);
    if (tier === 'xs') {
      el.innerHTML = '<div class="xs-in">' + ava(s, 22) + '<span class="xs-dot"></span></div>';
      el.title = ag.label + ' · ' + s.project + ' · ' + st.label;
      return el;
    }

    let body = '';
    if (s.state === 'awaiting') {
      body =
        '<div class="ask-box">' +
          (s.tool ? '<div class="tool mono">' + toolHTML(s.tool) + '</div>' : '') +
          '<div class="q">' + s.prompt + '</div>' +
          '<div class="row">' +
            '<button class="btn yes" data-act="approve">Approve</button>' +
            '<button class="btn no" data-act="deny">Deny</button>' +
          '</div>' +
        '</div>';
    } else if (s.state === 'error') {
      body =
        '<div class="cb">' +
          '<div class="tool mono" style="border-color:rgba(255,107,107,0.4);color:#ffb3b3">✕ ' + (s.err || 'failed') + '</div>' +
          (s.think ? '<div class="think">' + s.think + '</div>' : '') +
        '</div>' +
        '<div class="ask-box">' +
          '<div class="row">' +
            '<button class="btn danger" data-act="retry">Retry</button>' +
            '<button class="btn no" data-act="dismiss">Dismiss</button>' +
          '</div>' +
        '</div>';
    } else {
      const think = s.think
        ? '<div class="think">' + s.think + (s.state === 'processing' ? '<span class="cur"></span>' : '') + '</div>'
        : '<div class="think" style="color:var(--faint)">No active task — session warm, ready to resume.</div>';
      const gauge = s.state === 'processing'
        ? '<div class="tgauge"><div class="b"><i style="width:' + Math.min(96, 30 + (s.heat || 0) * 3) + '%"></i></div></div>'
        : '';
      body =
        '<div class="cb">' +
          (s.tool ? '<div class="tool mono">' + toolHTML(s.tool) + '</div>' : '') +
          think +
        '</div>' +
        '<div class="cf mono">' +
          '<span class="k">' + s.model + '</span>' +
          (s.diff ? '<span>' + s.diff + '</span>' : '') +
          '<span class="sp"></span>' + gauge +
          '<span>' + s.elapsed + '</span>' +
        '</div>';
    }

    el.innerHTML =
      '<div class="ch">' + ava(s) +
        '<div class="who"><div class="nm">' + ag.short + '</div><div class="pj mono">' + s.project + '</div></div>' +
        '<span class="pill"><i></i><span class="pl">' + st.label + '</span></span>' +
      '</div>' + body;
    return el;
  }

  // ───────── shared detail overlay ─────────
  function createDetail(root, handlers) {
    handlers = handlers || {};
    const back = document.createElement('div');
    back.className = 'detail-back';
    back.innerHTML = '<div class="detail"></div>';
    const panel = back.querySelector('.detail');
    root.appendChild(back);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });

    function close() { back.classList.remove('open'); }

    function open(s) {
      const ag = AGENTS[s.agent], st = STATE[s.state];
      panel.style.setProperty('--accent', st.color);
      let foot = '';
      if (s.state === 'awaiting') {
        foot = '<button class="btn yes" data-act="approve">Approve</button><button class="btn no" data-act="deny">Deny</button>';
      } else if (s.state === 'error') {
        foot = '<button class="btn danger" data-act="retry">Retry</button><button class="btn no" data-act="dismiss">Dismiss</button>';
      } else if (s.state === 'processing') {
        foot = '<button class="btn no" data-act="interrupt">Interrupt</button><button class="btn" data-act="close" style="flex:0 0 auto;padding:0 22px">Close</button>';
      } else {
        foot = '<button class="btn" data-act="close" style="flex:0 0 auto;padding:0 22px;margin-left:auto">Close</button>';
      }
      const logLines = (s.log || []).map((l, i) =>
        '<div class="line"><span class="t">' + String(i + 1).padStart(2, '0') + '</span>' + l + '</div>').join('');
      panel.innerHTML =
        '<div class="dh">' + ava(s, 30) +
          '<div><div class="nm">' + ag.label + '</div><div class="pj mono">' + s.project + ' · ' + s.model + ' · ' + s.elapsed + '</div></div>' +
          '<button class="x" data-act="close">×</button>' +
        '</div>' +
        '<div class="dbody">' +
          (s.prompt ? '<div><div class="dsec-l">Awaiting decision</div><div style="font-size:15px;line-height:1.5">' + s.prompt + '</div></div>' : '') +
          (s.tool ? '<div><div class="dsec-l">Current action</div><div class="tool mono">' + toolHTML(s.tool) + '</div></div>' : '') +
          (s.err ? '<div><div class="dsec-l">Error</div><div class="tool mono" style="color:#ffb3b3;border-color:rgba(255,107,107,0.4)">✕ ' + s.err + '</div></div>' : '') +
          (s.think ? '<div><div class="dsec-l">Reasoning</div><div style="font-size:13.5px;line-height:1.55;color:var(--dim)">' + s.think + '</div></div>' : '') +
          '<div><div class="dsec-l">Activity log</div><div class="log mono">' + (logLines || '<div class="line">—</div>') + '</div></div>' +
        '</div>' +
        '<div class="dfoot">' + foot + '</div>';
      panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'close') return close();
        if (handlers.onAct) handlers.onAct(s, act);
        close();
      }));
      back.classList.add('open');
    }
    return { open, close, el: back };
  }

  return { renderCell, createDetail, ava };
})();
