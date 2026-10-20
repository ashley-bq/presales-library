import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { SLIDES, DECKS, TAXONOMY } from './paths.js';
import { readJson, writeJson, shortId, contentHash, htmlToText, htmlTitle, nowIso, fail } from './util.js';
import { identity } from './identity.js';

export const loadTaxonomy = () => YAML.parse(fs.readFileSync(TAXONOMY, 'utf8'));
export const saveTaxonomy = (t) => fs.writeFileSync(TAXONOMY, YAML.stringify(t));

export function addTaxonomyValue(dim, value) {
  const t = loadTaxonomy();
  const d = t.dimensions.find((x) => x.key === dim) || fail(`未知标签维度：${dim}`);
  if (!d.values.includes(value)) { d.values.push(value); saveTaxonomy(t); }
  return t;
}

export const slideDir = (id) => path.join(SLIDES, id);
export const getSlide = (id) => readJson(path.join(slideDir(id), 'meta.json')) || fail(`找不到页面：${id}`);
export const saveMeta = (meta) => writeJson(path.join(slideDir(meta.id), 'meta.json'), meta);

export function listSlides() {
  if (!fs.existsSync(SLIDES)) return [];
  return fs.readdirSync(SLIDES).filter((id) => fs.existsSync(path.join(SLIDES, id, 'meta.json'))).map((id) => readJson(path.join(SLIDES, id, 'meta.json'))).filter(Boolean);
}

export function listDecks() {
  if (!fs.existsSync(DECKS)) return [];
  return fs.readdirSync(DECKS).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(DECKS, f))).filter(Boolean);
}

export const saveDeck = (deck) => writeJson(path.join(DECKS, `${deck.id}.json`), deck);

export function newSlideId(prefix, page) {
  let id;
  do { id = `${prefix}-${String(page).padStart(2, '0')}-${shortId()}`; } while (fs.existsSync(slideDir(id)));
  return id;
}

export function emptyTags() {
  return Object.fromEntries(loadTaxonomy().dimensions.map((d) => [d.key, []]));
}

/** 写入一页素材。files: [{name, data|src}]，name 相对页目录（如 assets/page.jpg） */
export function createSlide({ id, html, files = [], meta = {} }) {
  const dir = slideDir(id);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'slide.html'), html.trim() + '\n');
  for (const f of files) {
    const dst = path.join(dir, f.name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    f.src ? fs.copyFileSync(f.src, dst) : fs.writeFileSync(dst, f.data);
  }
  const me = identity();
  const full = {
    id,
    title: htmlTitle(html) || meta.title || id,
    text: htmlToText(html),
    tags: emptyTags(),
    customer: '',
    scope: 'universal',
    origin: 'original',
    parent_id: null,
    root_id: id,
    source: {},
    theme: 'dark',
    tagged: false,
    author: me.display,
    created_at: nowIso(),
    ...meta,
  };
  full.content_hash = contentHash(dir);
  saveMeta(full);
  return full;
}

export function refreshSlideText(id) {
  const meta = getSlide(id);
  const html = fs.readFileSync(path.join(slideDir(id), 'slide.html'), 'utf8');
  meta.title = htmlTitle(html) || meta.title;
  if (meta.source?.format !== 'pptx') meta.text = htmlToText(html);
  meta.content_hash = contentHash(slideDir(id));
  saveMeta(meta);
  return meta;
}

/** 更新标签。patch: {tags?:{维度:[值]}, customer?, scope?} ；未知标签值会自动加入 taxonomy */
export function applyTags(id, patch) {
  const meta = getSlide(id);
  const tax = loadTaxonomy();
  if (patch.tags) {
    for (const [dim, vals] of Object.entries(patch.tags)) {
      const d = tax.dimensions.find((x) => x.key === dim) || fail(`未知标签维度：${dim}（可选：${tax.dimensions.map((x) => x.key).join('、')}）`);
      const list = [...new Set([].concat(vals).filter(Boolean))];
      for (const v of list) if (!d.values.includes(v)) d.values.push(v);
      meta.tags[dim] = list;
    }
    saveTaxonomy(tax);
  }
  for (const k of ['customer', 'scope', 'title']) if (patch[k] !== undefined) meta[k] = patch[k];
  meta.tagged = true;
  saveMeta(meta);
  return meta;
}
