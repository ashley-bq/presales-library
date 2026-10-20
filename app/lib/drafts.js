import fs from 'node:fs';
import path from 'node:path';
import { DRAFTS, TEMPLATES } from './paths.js';
import { slideDir, getSlide } from './library.js';
import { identity } from './identity.js';
import { readJson, writeJson, shortId, today, nowIso, copyDir, contentHash, assetsHash, htmlTitle, htmlToText, fail } from './util.js';

const draftDir = (id) => path.join(DRAFTS, id);
const draftFile = (id) => path.join(draftDir(id), 'draft.json');
export const draftSlideDir = (id, key) => path.join(draftDir(id), 'slides', key);

export function loadDraft(id) {
  return readJson(draftFile(id)) || fail(`找不到草稿：${id}`);
}
const saveDraft = (d) => { d.updated_at = nowIso(); writeJson(draftFile(d.id), d); return d; };

function addSlide(d, { source_id, layout }, pos) {
  const key = `s${shortId(3)}`;
  const dst = draftSlideDir(d.id, key);
  let entry;
  if (source_id) {
    const meta = getSlide(source_id);
    copyDir(slideDir(source_id), dst, (f) => f === 'meta.json' || f === 'thumb.jpg');
    entry = { key, source_id, base_hash: contentHash(dst), base_assets: assetsHash(dst), base_title: meta.title, base_text: htmlToText(fs.readFileSync(path.join(dst, 'slide.html'), 'utf8')) };
  } else {
    const tpl = path.join(TEMPLATES, `${layout || 'bullets'}.html`);
    if (!fs.existsSync(tpl)) fail(`没有这个版式：${layout}`);
    fs.mkdirSync(path.join(dst, 'assets'), { recursive: true });
    fs.copyFileSync(tpl, path.join(dst, 'slide.html'));
    entry = { key, source_id: null, layout, base_hash: null };
  }
  d.slides.splice(pos ?? d.slides.length, 0, entry);
  return entry;
}

export function createDraft({ name, customer = '', theme = 'dark', slide_ids = [] }) {
  const me = identity();
  const id = `${today()}-${shortId(3)}`;
  const d = { id, name: name || '未命名 deck', customer, theme, owner: me.display, created_at: nowIso(), slides: [] };
  fs.mkdirSync(draftDir(id), { recursive: true });
  for (const sid of slide_ids) addSlide(d, { source_id: sid });
  return saveDraft(d);
}

export function listDrafts() {
  if (!fs.existsSync(DRAFTS)) return [];
  return fs.readdirSync(DRAFTS).map((id) => readJson(draftFile(id))).filter(Boolean)
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map((d) => ({ id: d.id, name: d.name, customer: d.customer, pages: d.slides.length, updated_at: d.updated_at, exported_at: d.exported_at || null, promoted_at: d.promoted_at || null }));
}

/** 计算某页相对来源页的修改情况 */
export function slideState(d, s) {
  const dir = draftSlideDir(d.id, s.key);
  const html = fs.readFileSync(path.join(dir, 'slide.html'), 'utf8');
  const title = htmlTitle(html);
  if (!s.source_id) return { modified: true, is_new: true, title, diff: { new_slide: true, layout: s.layout } };
  const modified = contentHash(dir) !== s.base_hash;
  if (!modified) return { modified: false, title };
  const text = htmlToText(html);
  return {
    modified: true, title,
    diff: {
      title: title !== s.base_title ? [s.base_title, title] : null,
      text_changed: text !== s.base_text,
      image_replaced: assetsHash(dir) !== s.base_assets,
    },
  };
}

export function getDraft(id) {
  const d = loadDraft(id);
  return { ...d, slides: d.slides.map((s) => ({ ...s, ...slideState(d, s) })) };
}

export function updateDraft(id, patch) {
  const d = loadDraft(id);
  for (const k of ['name', 'customer', 'theme']) if (patch[k] !== undefined) d[k] = patch[k];
  if (patch.order) {
    const map = Object.fromEntries(d.slides.map((s) => [s.key, s]));
    if (patch.order.length !== d.slides.length || !patch.order.every((k) => map[k])) fail('排序参数与草稿页不一致');
    d.slides = patch.order.map((k) => map[k]);
  }
  saveDraft(d);
  return getDraft(id);
}

export function insertSlide(id, { source_id, layout, pos }) {
  const d = loadDraft(id);
  const entry = addSlide(d, { source_id, layout }, pos);
  saveDraft(d);
  return entry;
}

export function removeSlide(id, key) {
  const d = loadDraft(id);
  d.slides = d.slides.filter((s) => s.key !== key);
  fs.rmSync(draftSlideDir(id, key), { recursive: true, force: true });
  saveDraft(d);
}

export function saveSlideHtml(id, key, html) {
  const d = loadDraft(id);
  if (!d.slides.some((s) => s.key === key)) fail('草稿中没有这一页');
  if (!/<section\b[^>]*class=["'][^"']*\bslide\b/.test(html)) fail('内容必须是一个 <section class="slide">');
  fs.writeFileSync(path.join(draftSlideDir(id, key), 'slide.html'), html.trim() + '\n');
  saveDraft(d);
}

export function saveSlideAsset(id, key, filename, buf) {
  const safe = `${Date.now().toString(36)}-${path.basename(filename).replace(/[^\w.\-]+/g, '_')}`;
  const p = path.join(draftSlideDir(id, key), 'assets', safe);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  return `assets/${safe}`;
}

export function markDraft(id, patch) {
  const d = loadDraft(id);
  Object.assign(d, patch);
  return saveDraft(d);
}
