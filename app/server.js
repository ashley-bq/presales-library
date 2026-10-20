import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC, THEMES, SLIDES, DRAFTS, EXPORTS, TEMPLATES, LIB, EVENTS } from './lib/paths.js';
import { buildIndex, filterSlides, history, usageRanking } from './lib/indexer.js';
import { applyTags, addTaxonomyValue } from './lib/library.js';
import { createDraft, listDrafts, getDraft, updateDraft, insertSlide, removeSlide, saveSlideHtml, saveSlideAsset, draftSlideDir } from './lib/drafts.js';
import { exportDraft } from './lib/export.js';
import { promoteDraft } from './lib/promote.js';
import { slideDocument } from './lib/render.js';
import { appendEvent } from './lib/events.js';
import { identity } from './lib/identity.js';
import * as git from './lib/git.js';
import { rel } from './lib/paths.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.zip': 'application/zip', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.woff2': 'font/woff2' };

let indexCache = null;
const index = () => (indexCache ||= buildIndex({ write: true }));
const invalidate = () => { indexCache = null; };

const selfWrites = new Map();
const watchers = new Set();
const notify = (msg) => { for (const res of watchers) res.write(`data: ${JSON.stringify(msg)}\n\n`); };

function sendFile(res, file, extraHeaders = {}) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...extraHeaders });
  fs.createReadStream(file).pipe(res);
}
function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
const safeJoin = (base, p) => {
  const full = path.resolve(base, '.' + path.sep + decodeURIComponent(p));
  return full.startsWith(path.resolve(base) + path.sep) ? full : null;
};
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  return (req.headers['content-type'] || '').includes('application/json') ? JSON.parse(buf.toString('utf8') || '{}') : buf;
}

const EDIT_HEAD = `<style>
[data-editable]{outline:1px dashed transparent;outline-offset:6px;border-radius:4px;transition:outline-color .15s}
body.editing [data-editable]:hover{outline-color:rgba(245,184,0,.7);cursor:text}
body.editing [data-editable]:focus{outline:2px solid #f5b800}
body.editing img{cursor:pointer}body.editing img:hover{outline:3px solid rgba(245,184,0,.8)}
img[src=""]{min-width:400px;min-height:240px;background:repeating-linear-gradient(45deg,rgba(128,128,128,.15) 0 20px,transparent 20px 40px)}
</style>`;

function slideDoc(dir, urlBase, theme, edit) {
  const html = fs.readFileSync(path.join(dir, 'slide.html'), 'utf8');
  return slideDocument({ html, base: urlBase, theme, themeHref: '/themes/theme.css', head: edit ? EDIT_HEAD : '' });
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const m = req.method;
  const [a, b, c, d] = parts;

  if (a === 'index' && m === 'GET') {
    const ix = index();
    const me = identity({ required: false });
    return send(res, 200, {
      counts: ix.counts, taxonomy: ix.taxonomy, facets: ix.facets, decks: ix.decks.length,
      slides: ix.slides.map(({ text, ...s }) => ({ ...s, snippet: text.slice(0, 160) })),
      me, git: { ...git.status, remote: git.hasRemote(), unpushed: git.unpushedCount() },
    });
  }
  if (a === 'search' && m === 'GET') {
    const filters = JSON.parse(url.searchParams.get('filters') || '{}');
    return send(res, 200, filterSlides(index(), { q: url.searchParams.get('q') || '', filters }).map((s) => s.id));
  }
  if (a === 'slide' && b && !c && m === 'GET') {
    const ix = index();
    const s = ix.byId[b];
    if (!s) return send(res, 404, { error: '没有这一页' });
    return send(res, 200, { slide: s, history: history(ix, b) });
  }
  if (a === 'slide' && b && c === 'tags' && m === 'POST') {
    const patch = await body(req);
    const meta = applyTags(b, patch);
    const { file } = appendEvent('tag_edit', { slide_id: b, patch });
    invalidate();
    const g = git.commitAndPush([rel(SLIDES), rel(path.join(LIB, 'taxonomy.yaml')), rel(file)], `[打标] ${meta.title} by ${identity().name}`);
    return send(res, 200, { slide: meta, git: g });
  }
  if (a === 'taxonomy' && m === 'POST') {
    const { dim, value } = await body(req);
    const t = addTaxonomyValue(dim, value);
    invalidate();
    git.commitAndPush([rel(path.join(LIB, 'taxonomy.yaml'))], `[标签] ${dim} 新增「${value}」 by ${identity().name}`);
    return send(res, 200, t);
  }
  if (a === 'stats' && m === 'GET') {
    const ix = index();
    return send(res, 200, { ranking: usageRanking(ix, { limit: 100 }), customers: ix.customers, recent: ix.recent, counts: ix.counts });
  }
  if (a === 'sync' && m === 'POST') {
    const p = git.pull();
    const pushed = git.pushPending();
    invalidate();
    return send(res, 200, { pull: p, push: pushed });
  }
  if (a === 'templates' && m === 'GET') {
    return send(res, 200, fs.readdirSync(TEMPLATES).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')));
  }
  if (a === 'drafts') {
    if (!b && m === 'GET') return send(res, 200, listDrafts());
    if (!b && m === 'POST') return send(res, 200, createDraft(await body(req)));
    if (b && !c && m === 'GET') return send(res, 200, getDraft(b));
    if (b && !c && m === 'PATCH') return send(res, 200, updateDraft(b, await body(req)));
    if (b && c === 'slides' && !d && m === 'POST') { const e = insertSlide(b, await body(req)); return send(res, 200, { entry: e, draft: getDraft(b) }); }
    if (b && c === 'slides' && d && m === 'DELETE') { removeSlide(b, d); return send(res, 200, getDraft(b)); }
    if (b && c === 'slides' && d && parts[4] === 'html' && m === 'POST') {
      const { html } = await body(req);
      selfWrites.set(`${b}/${d}`, Date.now());
      saveSlideHtml(b, d, html);
      return send(res, 200, getDraft(b).slides.find((s) => s.key === d));
    }
    if (b && c === 'slides' && d && parts[4] === 'asset' && m === 'POST') {
      selfWrites.set(`${b}/${d}`, Date.now());
      const src = saveSlideAsset(b, d, url.searchParams.get('name') || 'image.png', await body(req));
      return send(res, 200, { src });
    }
    if (b && c === 'export' && m === 'POST') {
      const { formats } = await body(req);
      const r = await exportDraft(b, formats);
      invalidate();
      return send(res, 200, { ...r, files: r.files.map((f) => '/exports/' + path.relative(EXPORTS, f).split(path.sep).map(encodeURIComponent).join('/')) });
    }
    if (b && c === 'promote' && m === 'POST') {
      const r = await promoteDraft(b, await body(req));
      invalidate();
      return send(res, 200, r);
    }
  }
  return send(res, 404, { error: `未知接口 ${m} ${url.pathname}` });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/watch')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': ok\n\n');
      watchers.add(res);
      req.on('close', () => watchers.delete(res));
      return;
    }
    if (p.startsWith('/api/')) return await api(req, res, url);
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(PUBLIC, 'index.html'));
    if (p.startsWith('/themes/')) return sendFile(res, safeJoin(THEMES, p.slice(8)));
    if (p.startsWith('/exports/')) {
      const f = safeJoin(EXPORTS, p.slice(9));
      return sendFile(res, f, { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f || ''))}` });
    }
    let mm;
    if ((mm = p.match(/^\/render\/slide\/([^/]+)\/?$/))) {
      const s = index().byId[mm[1]];
      if (!s) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(slideDoc(path.join(SLIDES, s.id), `/slides/${s.id}/`, url.searchParams.get('theme') || s.theme, false));
    }
    if ((mm = p.match(/^\/render\/draft\/([^/]+)\/([^/]+)\/?$/))) {
      const dr = getDraft(mm[1]);
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(slideDoc(draftSlideDir(mm[1], mm[2]), `/drafts/${mm[1]}/slides/${mm[2]}/`, dr.theme, url.searchParams.has('edit')));
    }
    if ((mm = p.match(/^\/render\/template\/([\w-]+)$/))) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(slideDocument({ html: fs.readFileSync(path.join(TEMPLATES, mm[1] + '.html'), 'utf8'), base: '/', theme: url.searchParams.get('theme') || 'dark', themeHref: '/themes/theme.css' }));
    }
    if (p.startsWith('/slides/')) return sendFile(res, safeJoin(SLIDES, p.slice(8)));
    if (p.startsWith('/drafts/')) return sendFile(res, safeJoin(DRAFTS, p.slice(8)));
    return sendFile(res, safeJoin(PUBLIC, p.slice(1)));
  } catch (e) {
    if (!e.expose) console.error(e);
    if (!res.headersSent) send(res, e.expose ? 400 : 500, { error: e.message });
  }
}

function watch() {
  const watchDir = (dir, fn) => {
    fs.mkdirSync(dir, { recursive: true });
    try { fs.watch(dir, { recursive: true }, fn); } catch (e) { console.warn('文件监听不可用：', e.message); }
  };
  let t;
  watchDir(DRAFTS, (ev, file) => {
    if (!file) return;
    const [id, sub, key] = file.split(/[\\/]/);
    if (sub !== 'slides' || !key) return;
    if (Date.now() - (selfWrites.get(`${id}/${key}`) || 0) < 1500) return;
    clearTimeout(t);
    t = setTimeout(() => notify({ type: 'draft', id, key }), 250);
  });
  let t2;
  const libChanged = () => { clearTimeout(t2); t2 = setTimeout(() => { invalidate(); notify({ type: 'library' }); }, 600); };
  watchDir(SLIDES, libChanged);
  watchDir(EVENTS, libChanged);
}

export function serve({ port = 4173, open = false } = {}) {
  identity({ required: false });
  const r = git.pull();
  if (!r.ok) console.warn('同步失败：', r.error);
  git.pushPending();
  setInterval(() => { const before = git.status.lastPull; git.pull(); git.pushPending(); if (git.status.lastPull !== before) { invalidate(); notify({ type: 'library' }); } }, 5 * 60 * 1000).unref?.();
  watch();
  const server = http.createServer(handle);
  server.listen(port, '127.0.0.1', () => {
    const addr = `http://localhost:${port}`;
    console.log(`售前素材库已启动：${addr}（Ctrl+C 退出）`);
    if (open) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', addr] : [addr];
      import('node:child_process').then(({ spawn }) => spawn(cmd, args, { stdio: 'ignore', detached: true }).unref());
    }
  });
  return server;
}
