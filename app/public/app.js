/* 售前汇报素材库 —— 原生 JS 单页应用：素材库 / 购物车 / 草稿编辑器 / 统计 */

// ---------- 工具 ----------
const $app = document.getElementById('app');
async function api(path, { method = 'GET', json, body, headers = {} } = {}) {
  const r = await fetch('/api' + path, {
    method, body: json !== undefined ? JSON.stringify(json) : body,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function toast(msg, err = false, ms = 3500) {
  const el = h('div', { class: err ? 'err' : '' }, msg);
  document.getElementById('toast').append(el);
  setTimeout(() => el.remove(), ms);
}
const run = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true, 6000); } };
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const fill = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter((c) => c != null && c !== false)); return el; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmtTime = (ts) => ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }).replace(/:\d\d$/, '') : '';
const who = (u) => (u || '').replace(/\s*<.*>$/, '');
const thumbUrl = (s) => `/slides/${s.id}/thumb.jpg?v=${(s.content_hash || '').slice(0, 8)}`;

function frame(src, { onload, cls = '' } = {}) {
  const iframe = h('iframe', { src, loading: 'lazy', tabindex: '-1' });
  const box = h('div', { class: 'frame ' + cls }, iframe);
  new ResizeObserver(() => { iframe.style.transform = `scale(${box.clientWidth / 1920})`; }).observe(box);
  if (onload) iframe.addEventListener('load', () => onload(iframe));
  return box;
}

function dragList(container, itemSel, onDrop) {
  let dragged = null;
  container.querySelectorAll(itemSel).forEach((el) => {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => { dragged = el; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); container.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); if (el !== dragged) el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('over');
      if (!dragged || dragged === el) return;
      const items = [...container.querySelectorAll(itemSel)];
      const from = items.indexOf(dragged), to = items.indexOf(el);
      onDrop(from, to);
    });
  });
}
const move = (arr, from, to) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };

// ---------- 全局状态 ----------
const S = {
  index: null, byId: {}, q: '', filters: {}, results: null, selecting: false, collapsed: { '来源 deck': true },
  cart: Object.assign({ items: [], name: '', customer: '', theme: 'dark' }, JSON.parse(localStorage.getItem('psl.cart') || '{}')),
};
const saveCart = () => localStorage.setItem('psl.cart', JSON.stringify(S.cart));

async function loadIndex() {
  S.index = await api('/index');
  S.byId = Object.fromEntries(S.index.slides.map((s) => [s.id, s]));
  S.cart.items = S.cart.items.filter((id) => S.byId[id]);
}

const events = new EventSource('/api/watch');
const listeners = new Set();
events.onmessage = (e) => { const m = JSON.parse(e.data); listeners.forEach((fn) => fn(m)); };

// ---------- 顶栏 ----------
function topbar(extra = []) {
  const g = S.index?.git || {};
  const me = S.index?.me || {};
  const syncState = g.error ? 'err' : (!g.remote || g.unpushed) ? 'warn' : '';
  const syncTitle = g.error ? `同步异常：${g.error}` : !g.remote ? '未配置远程仓库' : g.unpushed ? `${g.unpushed} 个提交待推送` : `已同步 ${fmtTime(g.lastPull)}`;
  return h('div', { class: 'top' },
    h('div', { class: 'logo', onclick: () => { location.hash = '#/'; } }, h('i'), '售前汇报素材库'),
    ...extra,
    h('div', { class: 'me' },
      h('span', { class: `dot ${syncState}`, title: syncTitle }),
      h('a', { href: '#', title: syncTitle, onclick: run(async (e) => { e.preventDefault(); const r = await api('/sync', { method: 'POST' }); toast(r.pull.ok ? '已同步' : `同步失败：${r.pull.error}`, !r.pull.ok); await loadIndex(); route(); }) }, '同步'),
      me.name ? `${me.name}` : h('span', { style: { color: 'var(--red)' } }, '未设置 Git 身份')));
}

// ---------- 素材库 ----------
let $side, $grid, $cart, $toolbar;
function libraryView() {
  const c = S.index.counts;
  const search = h('input', { class: 'input', placeholder: '搜一搜：描述需求 / 客户名 / 关键词（空格分隔）', value: S.q, oninput: debounce((e) => { S.q = e.target.value; doSearch(); }, 220) });
  const shell = h('div', { class: 'shell' },
    topbar([
      h('div', { class: 'counts' }, `${c.slides} 页 · ${S.index.decks} decks · ${c.exports} 次使用${c.untagged ? ` · ${c.untagged} 页待打标` : ''}`),
      h('div', { class: 'search' }, search),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn ' + (S.selecting ? 'active' : ''), onclick: () => { S.selecting = !S.selecting; route(); } }, S.selecting ? '退出选择' : `购物模式${S.cart.items.length ? `（${S.cart.items.length}）` : ''}`),
      h('button', { class: 'btn ghost', onclick: () => { location.hash = '#/stats'; } }, '使用排行'),
      h('button', { class: 'btn ghost', onclick: () => { location.hash = '#/drafts'; } }, '我的草稿'),
      h('button', { class: 'btn ghost', onclick: () => { S.filters = {}; S.q = ''; search.value = ''; doSearch(); } }, '清空筛选'),
    ]),
    h('div', { class: 'lib' + (S.selecting ? ' selecting' : '') },
      $side = h('div', { class: 'side' }),
      h('div', { class: 'main' }, $toolbar = h('div', { class: 'toolbar' }), $grid = h('div', { class: 'grid' })),
      S.selecting ? ($cart = h('div', { class: 'cart' })) : null));
  fill($app, shell);
  doSearch();
  if (S.selecting) renderCart();
}

const doSearch = run(async () => {
  const hasFilter = Object.values(S.filters).some((v) => v.length);
  S.results = (S.q.trim() || hasFilter)
    ? (await api(`/search?q=${encodeURIComponent(S.q)}&filters=${encodeURIComponent(JSON.stringify(S.filters))}`)).map((id) => S.byId[id]).filter(Boolean)
    : S.index.slides;
  renderSide(); renderGrid();
});

function facetCounts(dim) {
  const counts = {};
  for (const s of S.results) {
    const vals = dim === '来源 deck' ? [s.deck_title] : dim === '客户' ? [s.customer] : dim === '来源' ? [s.origin === 'derived' ? '微调' : '原创'] : (s.tags?.[dim] || []);
    for (const v of vals) if (v) counts[v] = (counts[v] || 0) + 1;
  }
  return counts;
}

function renderSide() {
  const dims = [...S.index.taxonomy.dimensions.map((d) => d.key), '客户', '来源', '来源 deck'];
  fill($side, dims.map((dim) => {
    const all = S.index.facets[dim] || {};
    const counts = facetCounts(dim);
    const values = Object.keys(all).filter((v) => all[v] > 0 || (S.filters[dim] || []).includes(v));
    if (!values.length) return null;
    const open = !S.collapsed[dim];
    return h('div', { class: 'facet' },
      h('h4', { onclick: () => { S.collapsed[dim] = open; renderSide(); } }, dim, h('span', {}, open ? '−' : '+')),
      open && values.map((v) => {
        const on = (S.filters[dim] || []).includes(v);
        return h('label', { class: !counts[v] && !on ? 'zero' : '' },
          h('input', { type: 'checkbox', checked: on, onchange: (e) => {
            const cur = new Set(S.filters[dim] || []);
            e.target.checked ? cur.add(v) : cur.delete(v);
            S.filters[dim] = [...cur];
            doSearch();
          } }), v, h('span', { class: 'n' }, counts[v] || 0));
      }));
  }));
}

function card(s, { onclick, selected, showCheck } = {}) {
  const tags = Object.values(s.tags || {}).flat().slice(0, 4);
  return h('div', { class: 'card' + (selected ? ' sel' : ''), onclick },
    h('div', { class: 'thumb', style: { backgroundImage: `url("${thumbUrl(s)}")` } }),
    showCheck && h('div', { class: 'check' }, selected ? '✓' : ''),
    h('div', { class: 'body' },
      h('div', { class: 't', title: s.title }, s.title),
      h('div', { class: 'sub', title: s.deck_title }, s.deck_title || '—'),
      h('div', { class: 'chips' },
        h('span', { class: 'chip ' + (s.origin === 'derived' ? 'b' : 'g') }, s.origin === 'derived' ? '微调' : '原创'),
        h('span', { class: 'chip ' + (s.scope === 'customer-specific' ? 'r' : '') }, s.scope === 'customer-specific' ? 'customer-specific' : 'universal'),
        !s.tagged && h('span', { class: 'chip y' }, '待打标'),
        tags.map((t) => h('span', { class: 'chip y' }, t))),
      h('div', { class: 'foot' },
        h('span', { title: s.id }, s.id),
        h('span', {}, s.customer ? `客户：${s.customer}` : ''),
        h('span', { title: s.usage.users.join('、') }, `用过 ${s.usage.exports} 次 · ${s.usage.users.length} 人`))));
}

function renderGrid() {
  const filtersOn = Object.entries(S.filters).flatMap(([d, vs]) => vs.map((v) => [d, v]));
  fill($toolbar,
    h('span', {}, `${S.results.length} / ${S.index.slides.length} 页`),
    h('div', { class: 'chips' }, filtersOn.map(([d, v]) => h('span', { class: 'chip y' }, `${d}：${v}`, h('button', { onclick: () => { S.filters[d] = S.filters[d].filter((x) => x !== v); doSearch(); } }, '×')))),
    S.selecting && h('span', {}, '点击卡片加入/移出购物车；按住 Alt 点击查看详情'));
  if (!S.results.length) return fill($grid, h('div', { class: 'empty' }, S.index.slides.length ? '没有匹配的页面' : '素材库还是空的：让 Agent 执行 "psl ingest-html" 或 "psl import-pptx" 入库'));
  fill($grid, S.results.map((s) => {
    const inCart = S.cart.items.includes(s.id);
    return card(s, {
      selected: S.selecting && inCart, showCheck: S.selecting,
      onclick: (e) => {
        if (!S.selecting || e.altKey) return openDetail(s.id);
        S.cart.items = inCart ? S.cart.items.filter((x) => x !== s.id) : [...S.cart.items, s.id];
        saveCart(); renderGrid(); renderCart();
      },
    });
  }));
}

function renderCart() {
  if (!$cart) return;
  const items = h('div', { class: 'items' }, S.cart.items.map((id, i) => {
    const s = S.byId[id];
    return h('div', { class: 'cart-item' },
      h('span', { class: 'h', title: '拖动排序' }, '⋮⋮'),
      h('span', { class: 'no' }, i + 1),
      h('div', { class: 'tb', style: { backgroundImage: `url("${thumbUrl(s)}")` } }),
      h('div', { class: 'tt', title: s.title }, s.title),
      h('button', { class: 'x', title: '移除', onclick: () => { S.cart.items = S.cart.items.filter((x) => x !== id); saveCart(); renderCart(); renderGrid(); } }, '×'));
  }));
  fill($cart,
    h('h3', {}, '已选购物车', h('span', { class: 'hint' }, `${S.cart.items.length} 页`)),
    h('div', { class: 'form' },
      h('input', { class: 'input', placeholder: 'deck 名称，例：XX银行 代发长尾经营交流', value: S.cart.name, oninput: (e) => { S.cart.name = e.target.value; saveCart(); } }),
      h('input', { class: 'input', placeholder: '客户（用于统计"给谁讲过"）', value: S.cart.customer, oninput: (e) => { S.cart.customer = e.target.value; saveCart(); } }),
      h('select', { class: 'input', onchange: (e) => { S.cart.theme = e.target.value; saveCart(); } },
        h('option', { value: 'dark', selected: S.cart.theme === 'dark' }, '黑底主题'),
        h('option', { value: 'light', selected: S.cart.theme === 'light' }, '白底主题'))),
    S.cart.items.length ? items : h('div', { class: 'items' }, h('div', { class: 'empty' }, '从左侧挑选页面')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { S.cart.items = []; saveCart(); renderCart(); renderGrid(); } }, '清空'),
      h('button', { class: 'btn primary', disabled: !S.cart.items.length, onclick: run(async () => {
        const d = await api('/drafts', { method: 'POST', json: { name: S.cart.name || '未命名 deck', customer: S.cart.customer, theme: S.cart.theme, slide_ids: S.cart.items } });
        S.cart = { items: [], name: '', customer: '', theme: S.cart.theme }; saveCart();
        S.selecting = false;
        location.hash = `#/draft/${d.id}`;
      }) }, '生成草稿 →')));
  dragList(items, '.cart-item', (from, to) => { S.cart.items = move(S.cart.items, from, to); saveCart(); renderCart(); });
}

// ---------- 详情抽屉 ----------
const openDetail = run(async (id) => {
  document.querySelectorAll('.drawer, .drawer-mask').forEach((x) => x.remove());
  const { slide: s, history } = await api(`/slide/${encodeURIComponent(id)}`);
  const close = () => { mask.remove(); drawer.remove(); };
  const mask = h('div', { class: 'drawer-mask', onclick: close });
  const tags = structuredClone(s.tags || {});
  let customer = s.customer, scope = s.scope;
  const tagBox = h('div');
  const renderTags = () => fill(tagBox, S.index.taxonomy.dimensions.map((d) => h('div', { class: 'tagdim' },
    h('b', {}, d.key),
    h('div', { class: 'chips' },
      [...new Set([...d.values, ...(tags[d.key] || [])])].map((v) => h('span', {
        class: 'chip tagopt' + ((tags[d.key] || []).includes(v) ? ' on' : ''),
        onclick: () => { const cur = new Set(tags[d.key] || []); cur.has(v) ? cur.delete(v) : cur.add(v); tags[d.key] = [...cur]; renderTags(); },
      }, v)),
      h('input', { class: 'input addtag', placeholder: '+ 新增', onkeydown: (e) => {
        const v = e.target.value.trim();
        if (e.key !== 'Enter' || !v) return;
        tags[d.key] = [...new Set([...(tags[d.key] || []), v])];
        if (!d.values.includes(v)) d.values.push(v);
        renderTags();
      } })))));
  renderTags();

  const treeNode = (n) => h('li', {},
    h('span', { class: 'node' + (n.id === s.id ? ' cur' : ''), onclick: () => openDetail(n.id) },
      h('span', { class: 'chip ' + (n.origin === 'derived' ? 'b' : 'g') }, n.origin === 'derived' ? '微调' : '原创'),
      n.title, h('span', { class: 'hint' }, `${who(n.author)} · ${fmtTime(n.created_at)} · 用过 ${n.usage.exports} 次`)),
    n.modifications.length ? h('div', { class: 'mods' }, n.modifications.map((m) => h('div', {},
      `✎ ${fmtTime(m.ts)} ${who(m.user)} 在「${m.deck_name}」${m.customer ? `（${m.customer}）` : ''}中临时修改：`,
      [m.diff?.title && `标题「${m.diff.title[0]}」→「${m.diff.title[1]}」`, m.diff?.text_changed && '改文字', m.diff?.image_replaced && '换图'].filter(Boolean).join('、') || '内容调整',
      m.promoted_as ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); openDetail(m.promoted_as); } }, ' → 已入库') : ''))) : null,
    n.children.length ? h('ul', {}, n.children.map(treeNode)) : null);

  const drawer = h('div', { class: 'drawer' },
    h('div', { class: 'bar2', style: { justifyContent: 'space-between' } },
      h('h2', {}, s.title),
      h('div', { class: 'bar2' },
        h('button', { class: 'btn', onclick: () => { if (!S.cart.items.includes(s.id)) S.cart.items.push(s.id); saveCart(); S.selecting = true; close(); route(); toast('已加入购物车'); } }, S.cart.items.includes(s.id) ? '已在购物车' : '加入购物车'),
        h('button', { class: 'btn ghost', onclick: close }, '关闭'))),
    h('div', { class: 'hint', style: { marginBottom: '12px' } }, s.id),
    frame(`/render/slide/${encodeURIComponent(s.id)}`),
    h('div', { class: 'sec' }, h('h4', {}, '信息'), h('div', { class: 'kv' },
      h('b', {}, '来源 deck'), h('span', {}, s.deck_title || '—'),
      h('b', {}, '作者'), h('span', {}, `${who(s.author)}，${fmtTime(s.created_at)}`),
      h('b', {}, '格式'), h('span', {}, s.source?.format === 'pptx' ? `旧 PPTX 第 ${s.source.page} 页（${s.source.file}）` : 'HTML'),
      h('b', {}, '使用'), h('span', {}, `导出 ${s.usage.exports} 次，${s.usage.users.length} 人：${s.usage.users.map(who).join('、') || '—'}`),
      h('b', {}, '讲给'), h('span', {}, s.usage.customers.join('、') || '—'))),
    h('div', { class: 'sec' }, h('h4', {}, '标签（点击切换，回车新增）'), tagBox,
      h('div', { class: 'tagdim' }, h('b', {}, '客户'), h('input', { class: 'input', value: customer, placeholder: '客户名，通用页留空', oninput: (e) => { customer = e.target.value; } })),
      h('div', { class: 'tagdim' }, h('b', {}, '范围'), h('select', { class: 'input', onchange: (e) => { scope = e.target.value; } },
        h('option', { value: 'universal', selected: scope === 'universal' }, '通用 universal'),
        h('option', { value: 'customer-specific', selected: scope === 'customer-specific' }, '客户专属 customer-specific'))),
      h('button', { class: 'btn primary', onclick: run(async () => {
        await api(`/slide/${encodeURIComponent(s.id)}/tags`, { method: 'POST', json: { tags, customer, scope } });
        toast('标签已保存并同步'); await loadIndex(); close(); if (location.hash.startsWith('#/stats')) route(); else doSearch();
      }) }, '保存标签')),
    h('div', { class: 'sec' }, h('h4', {}, '版本树与修改记录'), h('div', { class: 'tree' }, h('ul', {}, treeNode(history.tree)))),
    h('div', { class: 'sec' }, h('h4', {}, '全文'), h('pre', { style: { whiteSpace: 'pre-wrap', color: 'var(--text-2)', fontSize: '12px', fontFamily: 'inherit' } }, s.text)));
  document.body.append(mask, drawer);
});

// ---------- 草稿列表 ----------
const draftsView = run(async () => {
  const list = await api('/drafts');
  fill($app, h('div', { class: 'shell' }, topbar([h('div', { class: 'counts' }, '我的草稿（仅保存在本机）'), h('div', { class: 'spacer' })]),
    h('div', { class: 'main' }, list.length ? h('table', { class: 't' },
      h('tr', {}, ['名称', '客户', '页数', '更新', '已导出', '已入库'].map((x) => h('th', {}, x))),
      list.map((d) => h('tr', { class: 'click', onclick: () => { location.hash = `#/draft/${d.id}`; } },
        h('td', {}, d.name), h('td', {}, d.customer || '—'), h('td', {}, d.pages), h('td', {}, fmtTime(d.updated_at)),
        h('td', {}, d.exported_at ? fmtTime(d.exported_at) : '—'), h('td', {}, d.promoted_at ? fmtTime(d.promoted_at) : '—'))))
      : h('div', { class: 'empty' }, '还没有草稿：进入"购物模式"挑选页面后生成'))));
});

// ---------- 草稿编辑器 ----------
let D = null, curKey = null, $pages, $stage, $status, $result, editFrame;
const draftView = run(async (id) => {
  D = await api(`/drafts/${id}`);
  if (!D.slides.some((s) => s.key === curKey)) curKey = D.slides[0]?.key || null;
  const patch = debounce(run(async (p) => { D = await api(`/drafts/${D.id}`, { method: 'PATCH', json: p }); renderStatus(); }), 400);
  fill($app, h('div', { class: 'shell' },
    topbar([
      h('input', { class: 'input', style: { width: '300px' }, value: D.name, title: 'deck 名称', oninput: (e) => patch({ name: e.target.value }) }),
      h('input', { class: 'input', style: { width: '180px' }, value: D.customer, placeholder: '客户', oninput: (e) => patch({ customer: e.target.value }) }),
      h('select', { class: 'input', onchange: run(async (e) => { D = await api(`/drafts/${D.id}`, { method: 'PATCH', json: { theme: e.target.value } }); renderPages(); renderStage(); }) },
        h('option', { value: 'dark', selected: D.theme === 'dark' }, '黑底'), h('option', { value: 'light', selected: D.theme === 'light' }, '白底')),
      $status = h('div', { class: 'counts' }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => doExport(['zip']) }, '导出 zip'),
      h('button', { class: 'btn', onclick: () => doExport(['pptx']) }, '导出 PPTX'),
      h('button', { class: 'btn primary', onclick: doPromote, title: '讲完效果好：把改过的页存为"微调"版本入库' }, '效果好，入库'),
    ]),
    h('div', { class: 'editor' },
      h('div', { class: 'pages' },
        $pages = h('div'),
        h('div', { class: 'bar2', style: { marginTop: '8px' } },
          h('button', { class: 'btn sm', onclick: pickFromLibrary }, '+ 从素材库插入'),
          h('button', { class: 'btn sm', onclick: pickTemplate }, '+ 新建页'))),
      $stage = h('div', { class: 'stage' }))));
  renderStatus(); renderPages(); renderStage();
});

function renderStatus() {
  const mod = D.slides.filter((s) => s.modified && !s.is_new).length, added = D.slides.filter((s) => s.is_new).length;
  fill($status, `${D.slides.length} 页 · 已改 ${mod} · 新增 ${added}${D.exported_at ? ` · 上次导出 ${fmtTime(D.exported_at)}` : ''}`);
}

function badge(s) {
  return s.is_new ? h('span', { class: 'chip g' }, '新') : s.modified ? h('span', { class: 'chip y' }, '已改') : h('span', { class: 'chip' }, '原样');
}

function renderPages() {
  const v = Date.now();
  fill($pages, D.slides.map((s, i) => h('div', { class: 'page-item' + (s.key === curKey ? ' cur' : ''), onclick: () => { curKey = s.key; renderPages(); renderStage(); } },
    h('div', { class: 'no' }, i + 1),
    h('div', {},
      frame(`/render/draft/${D.id}/${s.key}?v=${v}`),
      h('div', { class: 'meta' }, badge(s), h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: s.title }, s.title),
        h('button', { class: 'x', title: '删除此页', onclick: run(async (e) => { e.stopPropagation(); if (!confirm(`从草稿中删除第 ${i + 1} 页？`)) return; D = await api(`/drafts/${D.id}/slides/${s.key}`, { method: 'DELETE' }); if (curKey === s.key) curKey = D.slides[0]?.key; renderStatus(); renderPages(); renderStage(); }) }, '×'))))));
  dragList($pages, '.page-item', run(async (from, to) => {
    D = await api(`/drafts/${D.id}`, { method: 'PATCH', json: { order: move(D.slides.map((s) => s.key), from, to) } });
    renderPages();
  }));
}

function cleanSectionHtml(doc) {
  const sec = doc.querySelector('section.slide').cloneNode(true);
  sec.querySelectorAll('[contenteditable]').forEach((el) => { el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck'); });
  return sec.outerHTML;
}

function renderStage() {
  const s = D.slides.find((x) => x.key === curKey);
  if (!s) return fill($stage, h('div', { class: 'empty' }, '草稿是空的，从左侧插入页面'));
  const n = D.slides.indexOf(s) + 1;
  const $badge = h('span', {}, badge(s));
  const save = debounce(run(async (doc) => {
    const r = await api(`/drafts/${D.id}/slides/${s.key}/html`, { method: 'POST', json: { html: cleanSectionHtml(doc) } });
    Object.assign(s, r); renderStatus(); fill($badge, badge(s));
    const item = $pages.children[n - 1];
    if (item) { item.querySelector('.meta').firstChild.replaceWith(badge(s)); const f = item.querySelector('iframe'); f.src = `/render/draft/${D.id}/${s.key}?v=${Date.now()}`; }
  }), 700);
  editFrame = frame(`/render/draft/${D.id}/${s.key}?edit&v=${Date.now()}`, { onload: (iframe) => {
    const doc = iframe.contentDocument;
    doc.body.classList.add('editing');
    doc.querySelectorAll('[data-editable]').forEach((el) => { el.contentEditable = 'true'; el.spellcheck = false; });
    doc.addEventListener('input', () => save(doc));
    doc.addEventListener('paste', (e) => { e.preventDefault(); doc.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    doc.querySelectorAll('img').forEach((img) => img.addEventListener('click', () => {
      const input = h('input', { type: 'file', accept: 'image/*', onchange: run(async () => {
        const f = input.files[0]; if (!f) return;
        const { src } = await api(`/drafts/${D.id}/slides/${s.key}/asset?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } });
        img.setAttribute('src', src); save(doc); toast('图片已替换');
      }) });
      input.click();
    }));
  } });
  const src = s.source_id ? S.byId[s.source_id] : null;
  fill($stage,
    h('div', { class: 'bar2' },
      h('b', {}, `第 ${n} 页`), $badge,
      src ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); openDetail(src.id); } }, `来源：${src.title}`) : h('span', { class: 'hint' }, s.source_id ? `来源：${s.source_id}` : '新建页'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm', onclick: run(async () => {
        const text = `/presales-library 改写草稿 ${D.id} 第 ${n} 页（key=${s.key}，文件 drafts/${D.id}/slides/${s.key}/slide.html）：\n<在这里写修改要求，例如：把案例换成 ${D.customer || 'XX银行'} 的代发数据，语气更偏方法论>`;
        await navigator.clipboard.writeText(text); toast('已复制，粘贴给 Agent 并补充修改要求；改完网页会自动刷新');
      }) }, '复制 AI 改写指令')),
    editFrame,
    h('div', { class: 'hint' }, '直接点击文字即可编辑（自动保存）；点击图片可替换。复杂改动请用"复制 AI 改写指令"交给 Agent。修改只保存在本机草稿中，导出时会记录修改摘要。'),
    $result = h('div'));
}

const doExport = run(async (formats) => {
  fill($result, h('div', { class: 'result' }, `正在导出 ${formats.join(' / ')}…（PPTX 需要逐页渲染，请稍候）`));
  const r = await api(`/drafts/${D.id}/export`, { method: 'POST', json: { formats } });
  D = await api(`/drafts/${D.id}`); renderStatus();
  fill($result, h('div', { class: 'result' },
    h('div', {}, '✓ 导出完成，已记录本次使用', r.git?.pushed ? '并同步到仓库' : r.git?.error ? `（同步失败：${r.git.error}）` : '（仅本地提交）'),
    r.files.map((f) => h('div', {}, h('a', { href: f }, decodeURIComponent(f.split('/').pop()))))));
  r.files.forEach((f) => { const a = h('a', { href: f, download: '' }); document.body.append(a); a.click(); a.remove(); });
});

const doPromote = run(async () => {
  const changed = D.slides.filter((s) => s.modified);
  if (!changed.length) return toast('草稿中没有修改过的页，无需入库');
  const note = prompt(`将 ${changed.length} 页（改过 ${changed.filter((s) => !s.is_new).length}、新增 ${changed.filter((s) => s.is_new).length}）入库为新版本。\n可写一句效果说明（可留空）：`, '');
  if (note === null) return;
  const r = await api(`/drafts/${D.id}/promote`, { method: 'POST', json: { note } });
  await loadIndex();
  fill($result, h('div', { class: 'result' }, `✓ 已入库 ${r.created.length} 页：`, r.created.map((c) => h('div', {},
    h('span', { class: 'chip ' + (c.origin === 'derived' ? 'b' : 'g') }, c.origin === 'derived' ? '微调' : '原创'), ' ',
    h('a', { href: '#', onclick: (e) => { e.preventDefault(); openDetail(c.id); } }, c.title), c.tagged ? '' : '（新页待打标）'))));
});

function modal(title, content, headerExtra = []) {
  const mask = h('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
  mask.append(h('div', { class: 'modal' }, h('header', {}, h('b', {}, title), ...headerExtra, h('div', { class: 'spacer' }), h('button', { class: 'btn ghost', onclick: () => mask.remove() }, '关闭')), h('div', { class: 'content' }, content)));
  document.body.append(mask);
  return mask;
}
const insertAt = () => { const i = D.slides.findIndex((s) => s.key === curKey); return i < 0 ? D.slides.length : i + 1; };

function pickFromLibrary() {
  const grid = h('div', { class: 'grid' });
  const show = run(async (q) => {
    const ids = q ? await api(`/search?q=${encodeURIComponent(q)}`) : S.index.slides.map((s) => s.id);
    fill(grid, ids.map((id) => S.byId[id]).filter(Boolean).map((s) => card(s, { onclick: run(async () => {
      const r = await api(`/drafts/${D.id}/slides`, { method: 'POST', json: { source_id: s.id, pos: insertAt() } });
      D = r.draft; curKey = r.entry.key; m.remove(); renderStatus(); renderPages(); renderStage(); toast('已插入');
    }) })));
  });
  const m = modal('从素材库插入（插到当前页之后）', grid, [h('input', { class: 'input', style: { width: '360px' }, placeholder: '搜索', oninput: debounce((e) => show(e.target.value), 220) })]);
  show('');
}

const pickTemplate = run(async () => {
  const names = await api('/templates');
  const label = { cover: '封面', section: '章节', bullets: '要点', method: '方法论', data: '数据', case: '案例', compare: '对比', fusion: '融合一页', 'image-text': '左文右图' };
  const m = modal('新建页：选择版式', h('div', { class: 'grid' }, names.map((n) => h('div', { class: 'card', onclick: run(async () => {
    const r = await api(`/drafts/${D.id}/slides`, { method: 'POST', json: { layout: n, pos: insertAt() } });
    D = r.draft; curKey = r.entry.key; m.remove(); renderStatus(); renderPages(); renderStage();
  }) }, h('div', { style: { pointerEvents: 'none' } }, frame(`/render/template/${n}?theme=${D.theme}`)), h('div', { class: 'body' }, h('div', { class: 't' }, label[n] || n))))));
});

// ---------- 统计 ----------
const statsView = run(async () => {
  const st = await api('/stats');
  const typeLabel = { export: '导出', ingest: '入库', promote: '再入库', tag_edit: '打标' };
  fill($app, h('div', { class: 'shell' }, topbar([h('div', { class: 'counts' }, `共 ${st.counts.exports} 次导出 · ${st.counts.slides} 页`), h('div', { class: 'spacer' }),
    h('button', { class: 'btn ghost', onclick: () => { location.hash = '#/'; } }, '← 返回素材库')]),
  h('div', { class: 'main' },
    h('h3', {}, '页面使用排行'),
    st.ranking.length ? h('table', { class: 't' },
      h('tr', {}, ['#', '', '页面', '导出次数', '使用人', '讲给哪些客户', '被临时修改', '最近使用'].map((x) => h('th', {}, x))),
      st.ranking.map((r, i) => {
        const s = S.byId[r.id];
        return h('tr', { class: 'click', onclick: () => openDetail(r.id) },
          h('td', {}, i + 1), h('td', {}, s ? h('div', { class: 'mini', style: { backgroundImage: `url("${thumbUrl(s)}")` } }) : ''),
          h('td', {}, h('div', {}, r.title), h('div', { class: 'hint' }, `${r.deck_title || ''} · ${r.origin === 'derived' ? '微调' : '原创'}`)),
          h('td', {}, h('b', { style: { color: 'var(--accent)', fontSize: '16px' } }, r.exports)), h('td', {}, r.users.map(who).join('、')),
          h('td', {}, r.customers.join('、') || '—'), h('td', {}, r.modified ? `${r.modified} 次` : '—'), h('td', {}, fmtTime(r.last)));
      })) : h('div', { class: 'empty' }, '还没有导出记录'),
    h('h3', { style: { marginTop: '32px' } }, '客户案例热度'),
    st.customers.length ? h('table', { class: 't' }, h('tr', {}, ['客户', '导出 deck 次数', '累计页数', '售前'].map((x) => h('th', {}, x))),
      st.customers.map((c) => h('tr', {}, h('td', {}, c.customer), h('td', {}, c.exports), h('td', {}, c.slides), h('td', {}, c.users.map(who).join('、'))))) : h('div', { class: 'empty' }, '—'),
    h('h3', { style: { marginTop: '32px' } }, '最近动态'),
    h('table', { class: 't' }, st.recent.map((e) => h('tr', {}, h('td', { style: { width: '160px' } }, fmtTime(e.ts)), h('td', { style: { width: '120px' } }, who(e.user)),
      h('td', { style: { width: '80px' } }, h('span', { class: 'chip y' }, typeLabel[e.type] || e.type)),
      h('td', {}, e.type === 'export' ? `「${e.deck_name}」${e.customer ? `→ ${e.customer}` : ''}，${e.slides.length} 页（改 ${e.slides.filter((x) => x.modified).length}）`
        : e.type === 'ingest' ? `「${e.deck_title}」${e.slide_ids.length} 页`
          : e.type === 'promote' ? `「${e.deck_name}」${e.slides.length} 页${e.note ? `：${e.note}` : ''}`
            : `${(e.slide_ids || [e.slide_id]).length} 页`)))))));
});

// ---------- 路由 ----------
async function route() {
  document.querySelectorAll('.drawer, .drawer-mask, .modal-mask').forEach((x) => x.remove());
  if (!S.index) await loadIndex();
  const hash = location.hash.replace(/^#\/?/, '');
  const [view, arg] = hash.split('/');
  if (view === 'draft' && arg) return draftView(arg);
  if (view === 'drafts') return draftsView();
  if (view === 'stats') return statsView();
  return libraryView();
}
listeners.add(run(async (m) => {
  const hash = location.hash;
  if (m.type === 'library') {
    await loadIndex();
    if (!hash.startsWith('#/draft/') && !document.querySelector('.drawer')) { if (hash.startsWith('#/stats')) route(); else { renderSide && $side?.isConnected && doSearch(); } }
  }
  if (m.type === 'draft' && D && m.id === D.id && hash.startsWith('#/draft/')) {
    D = await api(`/drafts/${D.id}`); renderStatus(); renderPages();
    if (m.key === curKey) renderStage();
    toast('草稿已被 Agent 更新');
  }
}));
addEventListener('hashchange', route);
route().catch((e) => toast(e.message, true, 8000));
