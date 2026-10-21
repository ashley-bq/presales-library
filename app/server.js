import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC, THEMES, SLIDES, DRAFTS, EXPORTS, TEMPLATES, LIB, EVENTS, UPLOADS, rel } from './lib/paths.js';
import { buildIndex, filterSlides, history, usageRanking } from './lib/indexer.js';
import { applyTags, addTaxonomyValue } from './lib/library.js';
import { createDraft, listDrafts, getDraft, loadDraft, updateDraft, insertSlide, removeSlide, saveSlideHtml, saveSlideAsset, draftSlideDir } from './lib/drafts.js';
import { exportDraft } from './lib/export.js';
import { promoteDraft } from './lib/promote.js';
import { slideDocument } from './lib/render.js';
import { appendEvent } from './lib/events.js';
import { identity, requestUser } from './lib/identity.js';
import { ingestFile, importImages, IMAGE_EXT } from './lib/ingest.js';
import { rewriteSlide, undoAiEdit, autoTag } from './lib/ai.js';
import { llmEnabled, loadConfig } from './lib/config.js';
import { login, verify, parseCookies, listUsers } from './lib/auth.js';
import { shortId, fail } from './lib/util.js';
import * as git from './lib/git.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.zip': 'application/zip', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.woff2': 'font/woff2' };
const COOKIE = 'psl_session';
const MAX_UPLOAD = 300 * 1024 * 1024;
const MAX_JSON = 5 * 1024 * 1024;

let SERVER_MODE = false;
let indexCache = null;
const index = () => (indexCache ||= buildIndex({ write: true }));
const invalidate = () => { indexCache = null; };

const selfWrites = new Map();
const watchers = new Set();
const notify = (msg) => { for (const res of watchers) res.write(`data: ${JSON.stringify(msg)}\n\n`); };

/** 写操作串行执行，避免多人同时 git 提交互相干扰 */
let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

function sendFile(res, file, extraHeaders = {}) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...extraHeaders });
  fs.createReadStream(file).pipe(res);
}
function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}
const safeJoin = (base, p) => {
  const full = path.resolve(base, '.' + path.sep + decodeURIComponent(p));
  return full.startsWith(path.resolve(base) + path.sep) ? full : null;
};
async function body(req, limit = MAX_JSON) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) fail(`内容过大（上限 ${Math.round(limit / 1048576)}MB）`);
    chunks.push(c);
  }
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

const uploadDir = () => path.join(UPLOADS, identity().slug);

async function handleUploadIngest({ items = [], title, customer, theme, report_type, auto_tag = true }) {
  if (!items.length) fail('请先选择文件');
  const files = items.map((it) => {
    if (!/^[\w.-]+$/.test(it.token || '')) fail('上传凭证不合法');
    const p = path.join(uploadDir(), it.token);
    if (!fs.existsSync(p)) fail(`上传文件已失效，请重新上传：${it.name}`);
    return { path: p, name: it.name || it.token };
  });
  const opts = { customer: customer || '', theme: theme || undefined, reportType: report_type || '' };
  const results = [];
  const images = files.filter((f) => IMAGE_EXT.test(f.name));
  const others = files.filter((f) => !IMAGE_EXT.test(f.name));
  try {
    for (const f of others) {
      results.push({ file: f.name, ...(await ingestFile(f.path, { ...opts, sourceName: f.name, title: others.length === 1 && !images.length ? title || undefined : undefined })) });
    }
    if (images.length) results.push({ file: images.map((f) => f.name).join('、'), ...(await importImages(images, { ...opts, title: title || undefined })) });
  } finally {
    for (const f of files) fs.rmSync(f.path, { force: true });
  }
  const ids = results.flatMap((r) => r.untagged.map((u) => u.id));
  let tagged = [], tag_error = null;
  if (auto_tag && llmEnabled() && ids.length) {
    try { tagged = await autoTag(ids); } catch (e) { tag_error = e.message; }
  }
  invalidate();
  return {
    decks: results.map((r) => ({ file: r.file, deck_id: r.deck_id, slides: r.untagged.map((u) => ({ id: u.id, title: u.title })), rendered_images: r.rendered_images, git: r.git })),
    auto_tagged: tagged.length, tag_error, llm: llmEnabled(),
  };
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
      me, mode: SERVER_MODE ? 'server' : 'local', llm: { enabled: llmEnabled(), model: loadConfig().llm.model || '' },
      git: { ...git.status, remote: git.hasRemote(), unpushed: git.unpushedCount() },
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
    return serial(() => {
      const meta = applyTags(b, { ...patch, tag_source: 'manual' });
      const { file } = appendEvent('tag_edit', { slide_id: b, patch });
      invalidate();
      const g = git.commitAndPush([rel(SLIDES), rel(path.join(LIB, 'taxonomy.yaml')), rel(file)], `[打标] ${meta.title} by ${identity().name}`);
      send(res, 200, { slide: meta, git: g });
    });
  }
  if (a === 'taxonomy' && m === 'POST') {
    const { dim, value } = await body(req);
    return serial(() => {
      const t = addTaxonomyValue(dim, value);
      invalidate();
      git.commitAndPush([rel(path.join(LIB, 'taxonomy.yaml'))], `[标签] ${dim} 新增「${value}」 by ${identity().name}`);
      send(res, 200, t);
    });
  }
  if (a === 'stats' && m === 'GET') {
    const ix = index();
    return send(res, 200, { ranking: usageRanking(ix, { limit: 100 }), customers: ix.customers, recent: ix.recent, counts: ix.counts });
  }
  if (a === 'sync' && m === 'POST') {
    return serial(() => { const p = git.pull(); const pushed = git.pushPending(); invalidate(); send(res, 200, { pull: p, push: pushed }); });
  }
  if (a === 'templates' && m === 'GET') {
    return send(res, 200, fs.readdirSync(TEMPLATES).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')));
  }
  if (a === 'me' && m === 'GET') return send(res, 200, { me: identity({ required: false }), mode: SERVER_MODE ? 'server' : 'local' });
  if (a === 'upload' && !b && m === 'POST') {
    const name = path.basename(url.searchParams.get('name') || 'file');
    if (!/\.(pptx|pdf|html?|png|jpe?g|webp|gif|svg)$/i.test(name)) fail('只支持 PPTX / PDF / 图片 / HTML');
    const buf = await body(req, MAX_UPLOAD);
    const token = `${Date.now().toString(36)}-${shortId(4)}${path.extname(name).toLowerCase()}`;
    fs.mkdirSync(uploadDir(), { recursive: true });
    fs.writeFileSync(path.join(uploadDir(), token), buf);
    return send(res, 200, { token, name, size: buf.length });
  }
  if (a === 'upload' && b === 'ingest' && m === 'POST') {
    const payload = await body(req);
    return serial(async () => send(res, 200, await handleUploadIngest(payload)));
  }
  if (a === 'ai' && b === 'rewrite' && m === 'POST') {
    const { draft, key, instruction } = await body(req);
    return serial(async () => {
      selfWrites.set(`${draft}/${key}`, Date.now() + 120000);
      try { send(res, 200, await rewriteSlide(draft, key, instruction)); } finally { selfWrites.set(`${draft}/${key}`, Date.now()); }
    });
  }
  if (a === 'ai' && b === 'undo' && m === 'POST') {
    const { draft, key } = await body(req);
    return serial(() => { selfWrites.set(`${draft}/${key}`, Date.now()); send(res, 200, undoAiEdit(draft, key)); });
  }
  if (a === 'ai' && b === 'tag' && m === 'POST') {
    const { ids } = await body(req);
    return serial(async () => { const r = await autoTag(ids || []); invalidate(); send(res, 200, { tagged: r }); });
  }
  if (a === 'drafts') {
    if (!b && m === 'GET') return send(res, 200, listDrafts());
    if (!b && m === 'POST') { const p = await body(req); return send(res, 200, createDraft(p)); }
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
      const src = saveSlideAsset(b, d, url.searchParams.get('name') || 'image.png', await body(req, 30 * 1024 * 1024));
      return send(res, 200, { src });
    }
    if (b && c === 'export' && m === 'POST') {
      const { formats } = await body(req);
      return serial(async () => {
        const r = await exportDraft(b, formats);
        invalidate();
        send(res, 200, { ...r, files: r.files.map((f) => '/exports/' + path.relative(EXPORTS, f).split(path.sep).map(encodeURIComponent).join('/')) });
      });
    }
    if (b && c === 'promote' && m === 'POST') {
      const p = await body(req);
      return serial(async () => { const r = await promoteDraft(b, p); invalidate(); send(res, 200, r); });
    }
  }
  return send(res, 404, { error: `未知接口 ${m} ${url.pathname}` });
}

const PUBLIC_PATHS = new Set(['/login.html', '/style.css', '/api/login']);

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (SERVER_MODE) {
      if (p === '/api/login' && req.method === 'POST') {
        const { username, password } = await body(req);
        const r = login(username, password);
        const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
        return send(res, 200, { user: r.user }, { 'Set-Cookie': `${COOKIE}=${r.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${r.maxAge}${secure}` });
      }
      if (p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
      const user = verify(parseCookies(req.headers.cookie)[COOKIE]);
      if (!user) {
        if (PUBLIC_PATHS.has(p)) return sendFile(res, path.join(PUBLIC, p.slice(1)));
        if (p.startsWith('/api/')) return send(res, 401, { error: '请先登录', login: true });
        res.writeHead(302, { Location: '/login.html' });
        return res.end();
      }
      return await requestUser.run(user, () => route(req, res, url));
    }
    return await route(req, res, url);
  } catch (e) {
    if (!e.expose && !(e instanceof SyntaxError)) console.error(e);
    if (!res.headersSent) send(res, e.expose || e instanceof SyntaxError ? 400 : 500, { error: e.message });
  }
}

async function route(req, res, url) {
  const p = url.pathname;
  try {
    if (p.startsWith('/api/watch')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': ok\n\n');
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      watchers.add(res);
      req.on('close', () => { clearInterval(ping); watchers.delete(res); });
      return;
    }
    if (p.startsWith('/api/')) return await api(req, res, url);
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(PUBLIC, 'index.html'));
    if (p.startsWith('/themes/')) return sendFile(res, safeJoin(THEMES, p.slice(8)));
    if (p.startsWith('/exports/')) {
      const f = safeJoin(EXPORTS, p.slice(9));
      if (f) loadDraft(path.relative(EXPORTS, f).split(path.sep)[0]);
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
      if (!dr.slides.some((s) => s.key === mm[2])) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(slideDoc(draftSlideDir(mm[1], mm[2]), `/drafts/${mm[1]}/slides/${mm[2]}/`, dr.theme, url.searchParams.has('edit')));
    }
    if ((mm = p.match(/^\/render\/template\/([\w-]+)$/))) {
      const tpl = path.join(TEMPLATES, mm[1] + '.html');
      if (!fs.existsSync(tpl)) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(slideDocument({ html: fs.readFileSync(tpl, 'utf8'), base: '/', theme: url.searchParams.get('theme') || 'dark', themeHref: '/themes/theme.css' }));
    }
    if (p.startsWith('/slides/')) return sendFile(res, safeJoin(SLIDES, p.slice(8)));
    if (p.startsWith('/drafts/')) {
      const f = safeJoin(DRAFTS, p.slice(8));
      if (f) loadDraft(path.relative(DRAFTS, f).split(path.sep)[0]);
      return sendFile(res, f);
    }
    return sendFile(res, safeJoin(PUBLIC, p.slice(1)));
  } catch (e) {
    if (!e.expose && !(e instanceof SyntaxError)) console.error(e);
    if (!res.headersSent) send(res, e.expose || e instanceof SyntaxError ? 400 : 500, { error: e.message });
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

export function serve({ port = 4173, host, open = false, server = false } = {}) {
  SERVER_MODE = server || process.env.PSL_MODE === 'server';
  const bind = host || process.env.PSL_HOST || (SERVER_MODE ? '0.0.0.0' : '127.0.0.1');
  if (SERVER_MODE && !listUsers().length) console.warn('⚠ 还没有任何账号：请运行 psl user add <用户名> --name 姓名 --email 邮箱');
  if (!SERVER_MODE) identity({ required: false });
  const r = git.pull();
  if (!r.ok) console.warn('同步失败：', r.error);
  git.pushPending();
  setInterval(() => serial(() => { const before = git.status.lastPull; git.pull(); git.pushPending(); if (git.status.lastPull !== before) { invalidate(); notify({ type: 'library' }); } }), 5 * 60 * 1000).unref?.();
  watch();
  const srv = http.createServer(handle);
  srv.requestTimeout = 15 * 60 * 1000;
  srv.listen(port, bind, () => {
    const addr = `http://${bind === '0.0.0.0' ? 'localhost' : bind === '127.0.0.1' ? 'localhost' : bind}:${port}`;
    console.log(`售前素材库已启动（${SERVER_MODE ? '服务器模式，需登录' : '本地模式'}）：${addr}（Ctrl+C 退出）`);
    if (open) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', addr] : [addr];
      import('node:child_process').then(({ spawn }) => spawn(cmd, args, { stdio: 'ignore', detached: true }).unref());
    }
  });
  return srv;
}
