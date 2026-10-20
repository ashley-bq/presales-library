import path from 'node:path';
import { listSlides, listDecks, loadTaxonomy } from './library.js';
import { readEvents } from './events.js';
import { writeJson } from './util.js';
import { CACHE } from './paths.js';

export function buildIndex({ write = false } = {}) {
  const taxonomy = loadTaxonomy();
  const slides = listSlides();
  const decks = listDecks();
  const events = readEvents();
  const byId = Object.fromEntries(slides.map((s) => [s.id, s]));
  const usage = {};
  const mods = {};
  const customers = {};
  for (const e of events.filter((e) => e.type === 'export')) {
    if (e.customer) {
      const c = (customers[e.customer] ||= { customer: e.customer, exports: 0, slides: 0, users: new Set() });
      c.exports++; c.slides += e.slides.length; c.users.add(e.user);
    }
    for (const s of e.slides || []) {
      if (!s.source_id) continue;
      const u = (usage[s.source_id] ||= { exports: 0, users: new Set(), customers: new Set(), last: null, modified: 0 });
      u.exports++; u.users.add(e.user); if (e.customer) u.customers.add(e.customer); u.last = e.ts;
      if (s.modified) {
        u.modified++;
        (mods[s.source_id] ||= []).push({ ts: e.ts, user: e.user, customer: e.customer, deck_name: e.deck_name, diff: s.diff, promoted_as: null });
      }
    }
  }
  for (const e of events.filter((e) => e.type === 'promote')) {
    for (const p of e.slides || []) {
      const list = mods[p.parent_id];
      const m = list && [...list].reverse().find((x) => x.deck_name === e.deck_name && !x.promoted_as);
      if (m) m.promoted_as = p.id;
    }
  }
  const children = {};
  for (const s of slides) if (s.parent_id) (children[s.parent_id] ||= []).push(s.id);

  const deckTitle = Object.fromEntries(decks.map((d) => [d.id, d.title]));
  const items = slides.map((s) => {
    const u = usage[s.id];
    return {
      ...s,
      deck_title: s.deck_title || deckTitle[s.source?.deck_id] || '',
      usage: { exports: u?.exports || 0, users: u ? [...u.users] : [], customers: u ? [...u.customers] : [], last: u?.last || null, modified: u?.modified || 0 },
      children: children[s.id] || [],
    };
  }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '') || a.id.localeCompare(b.id));

  const facets = {};
  for (const d of taxonomy.dimensions) {
    facets[d.key] = Object.fromEntries(d.values.map((v) => [v, 0]));
    for (const s of items) for (const v of s.tags?.[d.key] || []) facets[d.key][v] = (facets[d.key][v] || 0) + 1;
  }
  facets['来源 deck'] = {};
  for (const s of items) if (s.deck_title) facets['来源 deck'][s.deck_title] = (facets['来源 deck'][s.deck_title] || 0) + 1;
  facets['客户'] = {};
  for (const s of items) if (s.customer) facets['客户'][s.customer] = (facets['客户'][s.customer] || 0) + 1;
  facets['来源'] = { 原创: items.filter((s) => s.origin !== 'derived').length, 微调: items.filter((s) => s.origin === 'derived').length };

  const index = {
    generated_at: new Date().toISOString(), taxonomy,
    counts: { slides: items.length, decks: decks.length, exports: events.filter((e) => e.type === 'export').length, untagged: items.filter((s) => !s.tagged).length },
    slides: items, decks, facets, mods,
    customers: Object.values(customers).map((c) => ({ ...c, users: [...c.users] })).sort((a, b) => b.exports - a.exports),
    recent: events.slice(-50).reverse(),
    byId: undefined,
  };
  index.byId = Object.fromEntries(items.map((s) => [s.id, s]));
  if (write) writeJson(path.join(CACHE, 'index.json'), { ...index, byId: undefined, slides: items.map(({ text, ...s }) => ({ ...s, text: text.slice(0, 400) })) });
  return index;
}

const FILTER_KEYS = new Set(['来源 deck', '客户', '来源']);
export function filterSlides(index, { q = '', filters = {} } = {}) {
  const terms = String(q).toLowerCase().split(/[\s,，、]+/).filter(Boolean);
  const res = [];
  for (const s of index.slides) {
    let ok = true;
    for (const [dim, vals] of Object.entries(filters)) {
      if (!vals?.length) continue;
      let have;
      if (dim === '来源 deck') have = [s.deck_title];
      else if (dim === '客户') have = [s.customer];
      else if (dim === '来源') have = [s.origin === 'derived' ? '微调' : '原创'];
      else if (!FILTER_KEYS.has(dim)) have = s.tags?.[dim] || [];
      if (!vals.some((v) => have.includes(v))) { ok = false; break; }
    }
    if (!ok) continue;
    let score = 0;
    if (terms.length) {
      const title = (s.title || '').toLowerCase();
      const tags = Object.values(s.tags || {}).flat().join(' ').toLowerCase();
      const meta = `${s.customer} ${s.deck_title} ${s.id}`.toLowerCase();
      const text = (s.text || '').toLowerCase();
      let matched = 0;
      for (const t of terms) {
        const hit = (title.includes(t) ? 6 : 0) + (tags.includes(t) ? 4 : 0) + (meta.includes(t) ? 4 : 0) + (text.includes(t) ? 1 + Math.min(3, text.split(t).length - 2) : 0);
        if (hit) matched++;
        score += hit;
      }
      if (!score) continue;
      if (matched === terms.length) score *= 2;
    }
    res.push({ s, score: score + Math.min(3, s.usage.exports) * 0.5 });
  }
  return res.sort((a, b) => b.score - a.score).map((r) => r.s);
}

/** 某页的版本树：根 → 所有衍生，以及每个节点的使用和修改记录 */
export function history(index, id) {
  const s = index.byId[id];
  if (!s) return null;
  let root = s;
  while (root.parent_id && index.byId[root.parent_id]) root = index.byId[root.parent_id];
  const node = (x) => ({
    id: x.id, title: x.title, origin: x.origin, author: x.author, created_at: x.created_at, customer: x.customer,
    usage: x.usage, modifications: index.mods[x.id] || [], children: x.children.map((c) => index.byId[c]).filter(Boolean).map(node),
  });
  const ancestors = [];
  for (let p = s; p.parent_id && index.byId[p.parent_id]; p = index.byId[p.parent_id]) ancestors.unshift(p.parent_id);
  return { id, root_id: root.id, ancestors, tree: node(root) };
}

export function usageRanking(index, { limit = 50, filters = {}, q = '' } = {}) {
  return filterSlides(index, { q, filters })
    .filter((s) => s.usage.exports > 0)
    .sort((a, b) => b.usage.exports - a.usage.exports || b.usage.users.length - a.usage.users.length)
    .slice(0, limit)
    .map((s) => ({ id: s.id, title: s.title, deck_title: s.deck_title, origin: s.origin, exports: s.usage.exports, users: s.usage.users, customers: s.usage.customers, modified: s.usage.modified, last: s.usage.last }));
}
