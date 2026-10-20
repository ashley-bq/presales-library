import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

export const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
};

export const sha = (data) => crypto.createHash('sha1').update(data).digest('hex');
export const shortId = (n = 2) => crypto.randomBytes(n).toString('hex');
export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

export function asciiSlug(s, fallback = 'deck') {
  const slug = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || fallback;
}

export function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  }).sort();
}

export function copyDir(src, dst, skip = () => false) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of listFiles(src)) {
    if (skip(f)) continue;
    fs.mkdirSync(path.dirname(path.join(dst, f)), { recursive: true });
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

const CONTENT_SKIP = new Set(['meta.json', 'thumb.jpg', 'draft.json']);
export function contentHash(dir) {
  const h = crypto.createHash('sha1');
  for (const f of listFiles(dir)) {
    if (CONTENT_SKIP.has(f)) continue;
    h.update(f + '\0').update(fs.readFileSync(path.join(dir, f)));
  }
  return h.digest('hex');
}

export function assetsHash(dir) {
  const h = crypto.createHash('sha1');
  for (const f of listFiles(path.join(dir, 'assets'))) h.update(f + '\0').update(fs.readFileSync(path.join(dir, 'assets', f)));
  return h.digest('hex');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

export function htmlTitle(html) {
  const m = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || String(html).match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  return m ? htmlToText(m[1]).replace(/\n/g, ' ') : '';
}

export function fail(message, extra = {}) {
  const err = new Error(message);
  Object.assign(err, extra, { expose: true });
  throw err;
}
