/* global window, document, location, localStorage */

(() => {
  'use strict';

  const data = window.AGENTDECK_DESIGN_SYSTEM;
  if (!data) throw new Error('Design-system manifest is missing.');

  const ui = {
    en: {
      preview: 'Preview',
      source: 'Markdown',
      metadata: 'Metadata',
      search: 'tokens, hardware, handover…',
      fallback: 'This page is not translated yet. Showing the canonical English source.',
      canonical: 'Canonical',
      translated: 'Reader translation',
      generated: 'Generated',
      tokens: 'Token library',
      components: 'Component lab',
      assets: 'Asset library',
      tokensDesc: 'Live values parsed from design/tokens.css, the cross-platform token source of truth.',
      componentsDesc: 'Reference specimens rendered with the same tokens used by this viewer.',
      assetsDesc: 'Canonical product and agent marks from design/brand. No duplicate asset source.',
      tools: 'Specimens',
      docs: 'Documents',
      noResults: 'No catalog entries match this search.',
    },
    ko: {
      preview: '미리보기',
      source: 'Markdown',
      metadata: '메타데이터',
      search: '토큰, 하드웨어, 인계 검색…',
      fallback: '아직 번역되지 않은 문서입니다. 영어 정본을 표시합니다.',
      canonical: '영어 정본',
      translated: '독자용 번역',
      generated: '생성',
      tokens: '토큰 라이브러리',
      components: '컴포넌트 랩',
      assets: '에셋 라이브러리',
      tokensDesc: '크로스플랫폼 토큰 정본 design/tokens.css에서 읽은 실제 값입니다.',
      componentsDesc: '이 뷰어와 동일한 토큰으로 렌더한 기준 specimen입니다.',
      assetsDesc: 'design/brand가 소유하는 제품·에이전트 정본 에셋입니다. 중복 소스는 없습니다.',
      tools: '미리보기',
      docs: '문서',
      noResults: '검색과 일치하는 문서가 없습니다.',
    },
    ja: {
      preview: 'プレビュー',
      source: 'Markdown',
      metadata: 'メタデータ',
      search: 'token、hardware、handover…',
      fallback: 'この文書は未翻訳です。英語の正本を表示します。',
      canonical: '英語正本',
      translated: '読者向け翻訳',
      generated: '生成',
      tokens: 'トークンライブラリ',
      components: 'コンポーネントラボ',
      assets: 'アセットライブラリ',
      tokensDesc: 'クロスプラットフォーム正本 design/tokens.css から取得した実値です。',
      componentsDesc: 'この Viewer と同じ token で描画する基準 specimen です。',
      assetsDesc: 'design/brand が所有する製品・agent の正本 asset です。重複 source はありません。',
      tools: 'Specimen',
      docs: '文書',
      noResults: '検索に一致する文書がありません。',
    },
  };

  const special = new Set(['tokens', 'components', 'assets']);
  const knownPaths = new Map();
  for (const document of data.documents) {
    for (const locale of Object.values(document.locales)) knownPaths.set(locale.path, document.id);
  }

  const els = {
    navigation: document.querySelector('#navigation'),
    search: document.querySelector('#search'),
    locale: document.querySelector('#locale'),
    generatedAt: document.querySelector('#generated-at'),
    fallback: document.querySelector('#fallback'),
    eyebrow: document.querySelector('#eyebrow'),
    title: document.querySelector('#title'),
    description: document.querySelector('#description'),
    badges: document.querySelector('#badges'),
    tabs: document.querySelector('.view-tabs'),
    tabButtons: [...document.querySelectorAll('.view-tabs button')],
    view: document.querySelector('#view'),
  };

  let locale = localStorage.getItem('agentdeck-design-locale') || data.defaultLocale;
  if (!data.locales.includes(locale)) locale = data.defaultLocale;
  let activeId = decodeURIComponent(location.hash.slice(1)) || 'system.readme';
  if (!special.has(activeId) && !data.documents.some((item) => item.id === activeId)) activeId = 'system.readme';
  let viewMode = 'preview';
  let query = '';

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
    );
  }

  function inlineMarkdown(value, sourcePath) {
    const code = [];
    let output = String(value).replace(/`([^`]+)`/g, (_, inner) => {
      code.push(`<code>${escapeHtml(inner)}</code>`);
      return `\u0000CODE${code.length - 1}\u0000`;
    });
    output = escapeHtml(output)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
        const target = resolveLink(href, sourcePath);
        return `<a href="${escapeHtml(target)}">${label}</a>`;
      });
    return output.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
  }

  function resolveLink(href, sourcePath) {
    if (/^(https?:|mailto:|#)/.test(href)) return href;
    const base = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
    const normalized = normalizePath(`${base}${href}`);
    const documentId = knownPaths.get(normalized);
    if (documentId) return `#${encodeURIComponent(documentId)}`;
    return `https://github.com/puritysb/AgentDeck/blob/master/${normalized}`;
  }

  function normalizePath(value) {
    const stack = [];
    for (const part of value.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return stack.join('/');
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  function cells(line) {
    return line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  function markdownToHtml(markdown, sourcePath) {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }
      if (/^```/.test(line)) {
        const language = line.slice(3).trim();
        const code = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
        index += 1;
        html.push(`<pre><code data-language="${escapeHtml(language)}">${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }
      if (index + 1 < lines.length && line.includes('|') && isTableSeparator(lines[index + 1])) {
        const headers = cells(line);
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].includes('|') && lines[index].trim())
          rows.push(cells(lines[index++]));
        html.push(
          `<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(cell, sourcePath)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell, sourcePath)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
        );
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMarkdown(heading[2], sourcePath)}</h${level}>`);
        index += 1;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const tag = ordered ? 'ol' : 'ul';
        const items = [];
        const pattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*]\s+(.+)$/;
        while (index < lines.length) {
          const match = lines[index].match(pattern);
          if (!match) break;
          items.push(`<li>${inlineMarkdown(match[1], sourcePath)}</li>`);
          index += 1;
        }
        html.push(`<${tag}>${items.join('')}</${tag}>`);
        continue;
      }
      if (/^>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
        html.push(`<blockquote>${inlineMarkdown(quote.join(' '), sourcePath)}</blockquote>`);
        continue;
      }
      if (/^---+$/.test(line.trim())) {
        html.push('<hr>');
        index += 1;
        continue;
      }
      const paragraph = [line.trim()];
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^(#{1,6})\s|^```|^>\s?|^\s*[-*]\s+|^\s*\d+\.\s+|^---+$/.test(lines[index])
      ) {
        if (index + 1 < lines.length && lines[index].includes('|') && isTableSeparator(lines[index + 1])) break;
        paragraph.push(lines[index].trim());
        index += 1;
      }
      html.push(`<p>${inlineMarkdown(paragraph.join(' '), sourcePath)}</p>`);
    }
    return html.join('');
  }

  function localizedDocument(documentEntry) {
    return {
      page: documentEntry.locales[locale] || documentEntry.locales.en,
      fallback: !documentEntry.locales[locale],
    };
  }

  function strings() {
    return ui[locale];
  }

  function updateChrome() {
    const text = strings();
    els.locale.value = locale;
    els.search.placeholder = text.search;
    els.tabButtons[0].textContent = text.preview;
    els.tabButtons[1].textContent = text.source;
    els.tabButtons[2].textContent = text.metadata;
    document.documentElement.lang = locale === 'ko' ? 'ko' : locale === 'ja' ? 'ja' : 'en';
    const date = new Date(data.generatedAt);
    els.generatedAt.textContent = `${text.generated} ${date.toLocaleDateString(document.documentElement.lang)}`;
  }

  function navigationItems() {
    const items = data.documents.map((entry) => {
      const localized = localizedDocument(entry);
      return {
        id: entry.id,
        title: localized.page.metadata.title,
        category: localized.page.metadata.category,
        locale: localized.page.metadata.locale,
        search:
          `${localized.page.metadata.title} ${localized.page.metadata.description} ${localized.page.body}`.toLowerCase(),
      };
    });
    items.push(
      {
        id: 'tokens',
        title: strings().tokens,
        category: strings().tools,
        locale: 'live',
        search: 'tokens colors type spacing radius motion',
      },
      {
        id: 'components',
        title: strings().components,
        category: strings().tools,
        locale: 'live',
        search: 'components buttons badges status placeholder typography',
      },
      {
        id: 'assets',
        title: strings().assets,
        category: strings().tools,
        locale: 'live',
        search: 'assets logo icon brands claude codex openclaw opencode antigravity',
      },
    );
    return items.filter((item) => !query || item.search.includes(query));
  }

  function renderNavigation() {
    const grouped = new Map();
    for (const item of navigationItems()) {
      if (!grouped.has(item.category)) grouped.set(item.category, []);
      grouped.get(item.category).push(item);
    }
    if (grouped.size === 0) {
      els.navigation.innerHTML = `<p class="description">${escapeHtml(strings().noResults)}</p>`;
      return;
    }
    els.navigation.innerHTML = [...grouped.entries()]
      .map(
        ([category, items]) =>
          `<section class="rail-group"><h3 class="rail-title">${escapeHtml(category)}</h3>${items.map((item) => `<button class="rail-button${item.id === activeId ? ' active' : ''}" data-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.locale)}</small></button>`).join('')}</section>`,
      )
      .join('');
    for (const button of els.navigation.querySelectorAll('[data-id]')) {
      button.addEventListener('click', () => activate(button.dataset.id));
    }
  }

  function badge(label, className = '') {
    return `<span class="badge ${className}">${escapeHtml(label)}</span>`;
  }

  function renderDocument() {
    const entry = data.documents.find((item) => item.id === activeId);
    const localized = localizedDocument(entry);
    const page = localized.page;
    const meta = page.metadata;
    els.tabs.hidden = false;
    els.fallback.hidden = !localized.fallback;
    els.fallback.textContent = localized.fallback ? strings().fallback : '';
    els.eyebrow.textContent = `${meta.category} · ${page.path}`;
    els.title.textContent = meta.title;
    els.description.textContent = meta.description;
    els.badges.innerHTML =
      badge(meta.canonical ? strings().canonical : strings().translated, meta.canonical ? 'canonical' : '') +
      badge(meta.status, meta.status === 'required' ? 'required' : '') +
      badge(meta.locale);

    if (viewMode === 'preview') {
      els.view.innerHTML = `<article class="markdown">${markdownToHtml(page.body, page.path)}</article>`;
    } else if (viewMode === 'source') {
      els.view.innerHTML = `<pre class="source-code">${escapeHtml(page.raw)}</pre>`;
    } else {
      els.view.innerHTML = metadataView(meta, page.path);
    }
  }

  function metadataView(metadata, sourcePath) {
    const rows = { ...metadata, path: sourcePath };
    return `<dl class="metadata-grid">${Object.entries(rows)
      .map(
        ([key, value]) =>
          `<div><dt>${escapeHtml(key)}</dt><dd>${Array.isArray(value) ? `<ul>${value.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : escapeHtml(value)}</dd></div>`,
      )
      .join('')}</dl>`;
  }

  function renderTokens() {
    const grouped = new Map();
    for (const token of data.tokens) {
      if (!grouped.has(token.group)) grouped.set(token.group, []);
      grouped.get(token.group).push(token);
    }
    const sections = [...grouped.entries()]
      .map(
        ([group, tokens]) =>
          `<section class="token-section"><h3>${escapeHtml(group)}</h3><div class="token-grid">${tokens.map((token) => `<article class="token-card"><div class="swatch" style="--swatch:${escapeHtml(token.value)}"></div><div class="token-copy"><strong>${escapeHtml(token.name)}</strong><small>${escapeHtml(token.value)}</small></div></article>`).join('')}</div></section>`,
      )
      .join('');
    specialHeader(
      strings().tokens,
      strings().tokensDesc,
      'Foundations · design/tokens.css',
      badge('CSS SSOT', 'canonical'),
    );
    els.view.innerHTML = `<p class="specimen-intro">${escapeHtml(strings().tokensDesc)}</p><div class="token-groups">${sections}</div>`;
  }

  function renderAssets() {
    specialHeader(
      strings().assets,
      strings().assetsDesc,
      'Foundations · design/brand',
      badge(`${data.assets.length} assets`, 'canonical'),
    );
    els.view.innerHTML = `<p class="specimen-intro">${escapeHtml(strings().assetsDesc)}</p><div class="asset-grid">${data.assets.map((asset) => `<article class="asset-card"><div class="asset-stage"><img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.name)}"></div><h3>${escapeHtml(asset.name)}</h3><p>${escapeHtml(asset.source)} · ${escapeHtml(asset.type)} · ${asset.bytes.toLocaleString()} B</p></article>`).join('')}</div>`;
  }

  function renderComponents() {
    specialHeader(
      strings().components,
      strings().componentsDesc,
      'Foundations · reviewed specimens',
      badge('Token driven', 'canonical'),
    );
    els.view.innerHTML = `<p class="specimen-intro">${escapeHtml(strings().componentsDesc)}</p><div class="component-grid">
      <article class="component-card"><span class="demo-kicker">Actions</span><h3>Primary and ghost</h3><div class="demo-row"><button class="demo-button">View devices</button><button class="demo-button ghost">Read spec</button></div></article>
      <article class="component-card dark"><span class="badge canonical">App Store</span><h3>Two tiers, one surface</h3><p>Kelp and ink for the calm product tier. Coral marks developer-only edges.</p></article>
      <article class="component-card"><span class="demo-kicker">Attention only</span><h3>Status semantics</h3><div class="demo-row"><span class="demo-status"><i></i>Awaiting input</span><span class="status-dot"></span><span class="path">processing</span></div></article>
      <article class="component-card"><span class="demo-kicker">Type as instrument</span><h3>IBM Plex Sans</h3><p>Human copy stays calm. <code>JetBrains Mono</code> carries paths, timestamps, tokens, and machine output.</p></article>
    </div>`;
  }

  function specialHeader(title, description, eyebrow, badges) {
    els.tabs.hidden = true;
    els.fallback.hidden = true;
    els.eyebrow.textContent = eyebrow;
    els.title.textContent = title;
    els.description.textContent = description;
    els.badges.innerHTML = badges;
  }

  function render() {
    updateChrome();
    renderNavigation();
    if (activeId === 'tokens') renderTokens();
    else if (activeId === 'components') renderComponents();
    else if (activeId === 'assets') renderAssets();
    else renderDocument();
  }

  function activate(id) {
    activeId = id;
    viewMode = 'preview';
    location.hash = encodeURIComponent(id);
    updateTabs();
    render();
    document.querySelector('#content').focus({ preventScroll: true });
  }

  function updateTabs() {
    for (const button of els.tabButtons) {
      const active = button.dataset.view === viewMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    }
  }

  els.search.addEventListener('input', () => {
    query = els.search.value.trim().toLowerCase();
    renderNavigation();
  });
  els.locale.addEventListener('change', () => {
    locale = els.locale.value;
    localStorage.setItem('agentdeck-design-locale', locale);
    render();
  });
  for (const button of els.tabButtons) {
    button.addEventListener('click', () => {
      viewMode = button.dataset.view;
      updateTabs();
      renderDocument();
    });
  }
  window.addEventListener('hashchange', () => {
    const next = decodeURIComponent(location.hash.slice(1));
    if (next && next !== activeId && (special.has(next) || data.documents.some((item) => item.id === next))) {
      activeId = next;
      viewMode = 'preview';
      updateTabs();
      render();
    }
  });

  updateTabs();
  render();
})();
