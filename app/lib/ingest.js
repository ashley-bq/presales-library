import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { createSlide, newSlideId, saveDeck, slideDir, getSlide, saveMeta, listDecks } from './library.js';
import { renderSlides, pdfToJpegs, pdfPages } from './render.js';
import { appendEvent } from './events.js';
import { commitAndPush, pull } from './git.js';
import { identity } from './identity.js';
import { asciiSlug, shortId, today, nowIso, decodeEntities, escapeHtml, fail, contentHash } from './util.js';
import { rel, SLIDES, DECKS, CACHE } from './paths.js';
import { dropBoilerplate } from './classify.js';

const SECTION_RE = /<section\b[^>]*class\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi;
const run = promisify(execFile);

/** 进度/暂停/取消钩子：网页上传时由服务端任务传入；命令行用默认空实现 */
export const NOJOB = { step() {}, async checkpoint() {}, signal: undefined };

export async function renderThumbs(ids, job = NOJOB) {
  await renderSlides(ids.map((id) => {
    const dir = slideDir(id);
    return { html: fs.readFileSync(path.join(dir, 'slide.html'), 'utf8'), dir, theme: getSlide(id).theme, thumb: path.join(dir, 'thumb.jpg') };
  }), { onEach: async (i, n) => { job.step('生成缩略图', i, n); await job.checkpoint(); } });
}

/** 入库中途取消/失败：删掉本次新建的页面和 deck，不留半成品 */
function rollback(ids, deckId) {
  for (const id of ids) fs.rmSync(slideDir(id), { recursive: true, force: true });
  if (deckId) fs.rmSync(path.join(DECKS, `${deckId}.json`), { force: true });
}

function deckRecord(opts, slideIds, format, sourceFile) {
  const me = identity();
  const id = `${today()}-${asciiSlug(opts.slug || opts.title)}-${shortId()}`;
  const deck = {
    id, title: opts.title, customer: opts.customer || '', report_type: opts.reportType || '',
    format, source_file: sourceFile ? path.basename(sourceFile) : null,
    slides: slideIds, author: me.display, created_at: nowIso(), ...(opts.deckExtra || {}),
  };
  saveDeck(deck);
  return deck;
}

async function finish(deck, slides, format, job = NOJOB) {
  try {
    await renderThumbs(slides.map((s) => s.id), job);
    await job.checkpoint();
  } catch (e) { rollback(slides.map((s) => s.id), deck.id); throw e; }
  job.step('提交到共享仓库');
  const { file } = appendEvent('ingest', { deck_id: deck.id, deck_title: deck.title, format, slide_ids: slides.map((s) => s.id), ...(deck.skipped?.length ? { skipped: deck.skipped } : {}) });
  const git = commitAndPush([rel(SLIDES), rel(DECKS), rel(file)], `[入库] ${deck.title}（${slides.length} 页）by ${identity().name}`);
  return {
    deck_id: deck.id, git, skipped: deck.skipped || [], untagged: slides.map((s) => ({ id: s.id, title: s.title, text: s.text.slice(0, 600) })),
    next: '请为以上页面打标：psl tag --file tags.json（格式见 SKILL.md），或在网页详情里编辑',
  };
}

/** 入库一个 HTML deck：文件中每个 <section class="slide"> 为一页 */
export async function ingestHtml(file, opts = {}) {
  pull();
  const html = fs.readFileSync(file, 'utf8');
  const sections = html.match(SECTION_RE) || fail('没有找到 <section class="slide">，请按 slide-spec 组织 HTML');
  const baseDir = path.dirname(path.resolve(file));
  const title = opts.title || decodeEntities((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim() || (opts.sourceName || path.basename(file)).replace(/\.[^.]+$/, '');
  const theme = opts.theme || (/<body[^>]*class=["'][^"']*theme-light/i.test(html) ? 'light' : 'dark');
  const prefix = asciiSlug(opts.slug || title);
  const deckId = `pending-${shortId()}`;
  const slides = sections.map((sec, i) => {
    const files = [];
    const rewrite = (src) => {
      if (!src || /^(https?:|data:|#|\/\/)/i.test(src)) return src;
      const abs = path.resolve(baseDir, decodeURI(src));
      if (!fs.existsSync(abs)) return src;
      const name = `assets/${path.basename(abs)}`;
      if (!files.some((f) => f.name === name)) files.push({ name, src: abs });
      return name;
    };
    const fixed = sec
      .replace(/(\ssrc\s*=\s*["'])([^"']+)(["'])/gi, (m, a, src, b) => a + rewrite(src) + b)
      .replace(/url\((["']?)([^)"']+)\1\)/gi, (m, q, src) => `url(${q}${rewrite(src)}${q})`);
    return createSlide({
      id: newSlideId(prefix, i + 1), html: fixed, files,
      meta: { theme, customer: opts.customer || '', scope: opts.customer ? 'customer-specific' : 'universal', source: { format: 'html', deck_id: deckId, page: i + 1, file: path.basename(file) } },
    });
  });
  const deck = deckRecord({ ...opts, title }, slides.map((s) => s.id), 'html', file);
  for (const s of slides) { s.source.deck_id = deck.id; s.deck_title = title; saveMeta(s); }
  return finish(deck, slides, 'html', opts.job);
}

/* ---------------- PPTX ---------------- */

const xmlText = (s) => decodeEntities((s.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map((t) => t.replace(/<\/?a:t>/g, '')).join(''));
const paragraphs = (xml) => (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []).map(xmlText).map((t) => t.trim()).filter(Boolean);

async function slideOrder(zip) {
  const pres = await zip.file('ppt/presentation.xml').async('string');
  const rels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  const target = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(([r]) => [
    (r.match(/Id="([^"]+)"/) || [])[1], (r.match(/Target="([^"]+)"/) || [])[1],
  ]));
  const cy = Number((pres.match(/<p:sldSz[^>]*cy="(\d+)"/) || [])[1] || 6858000);
  const order = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map(([, rid]) => 'ppt/' + target[rid].replace(/^\/?ppt\//, '').replace(/^\.\//, ''));
  return { order, cy };
}

/** 解析一页：标题（优先 title 占位符，其次靠上的第一个文本框）、全文；返回去掉标题形状后的 xml */
function parseSlideXml(xml, cy) {
  const shapes = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
  let titleShape = shapes.find((s) => /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(s));
  if (!titleShape) {
    titleShape = shapes.find((s) => {
      if (!paragraphs(s).length) return false;
      const y = Number((s.match(/<a:off\b[^>]*y="(-?\d+)"/) || [])[1] ?? NaN);
      return Number.isFinite(y) && y < cy * 0.25;
    });
  }
  const title = titleShape ? paragraphs(titleShape).join(' ') : '';
  return { title, text: paragraphs(xml).join('\n'), stripped: titleShape ? xml.replace(titleShape, '') : xml };
}

function which(cmd) {
  try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim(); } catch { return ''; }
}

export function pptxRenderer() {
  if (process.platform === 'darwin' && fs.existsSync('/Applications/Microsoft PowerPoint.app')) return 'powerpoint-mac';
  if (process.platform === 'win32') return 'powerpoint-win';
  const soffice = which('soffice') || which('libreoffice') || (fs.existsSync('/Applications/LibreOffice.app') ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : '');
  return soffice ? `libreoffice:${soffice}` : null;
}

/** PPTX → PDF（PowerPoint 优先，其次 LibreOffice）。异步执行，转换期间服务仍可响应进度查询；signal 用于取消 */
async function pptxToPdf(pptx, workDir, signal) {
  const kind = pptxRenderer();
  const pdf = path.join(workDir, 'deck.pdf');
  const cancelled = () => signal?.aborted && fail('已取消');
  if (kind === 'powerpoint-mac') {
    // PowerPoint 处于沙盒中：固定使用 .cache/powerpoint 目录，首次会弹"授予访问权限"，授权一次后永久有效
    const box = path.join(CACHE, 'powerpoint');
    fs.mkdirSync(box, { recursive: true });
    const tag = shortId(4);
    const inFile = path.join(box, `${tag}.pptx`), outFile = path.join(box, `${tag}.pdf`);
    fs.copyFileSync(pptx, inFile);
    const script = `
      with timeout of 600 seconds
        tell application "Microsoft PowerPoint"
          open POSIX file "${inFile}"
          set p to active presentation
          save p in POSIX file "${outFile}" as save as PDF
          close p saving no
        end tell
      end timeout`;
    try {
      console.error('正在用 PowerPoint 渲染整页图（首次使用请在 PowerPoint 弹窗中点击"授予访问权限"）…');
      await run('osascript', ['-e', script], { timeout: 620000, signal });
      fs.copyFileSync(outFile, pdf);
      return pdf;
    } catch (e) {
      cancelled();
      const msg = (e.stderr || e.message).toString().trim();
      console.error('PowerPoint 转换失败，尝试 LibreOffice：', msg);
      if (msg.includes('-9074')) console.error('提示：PowerPoint 没有访问权限。请切换到 PowerPoint，在弹出的"授予访问权限"窗口中点击允许，然后重新导入。');
    } finally { for (const f of [inFile, outFile]) fs.rmSync(f, { force: true }); }
  }
  if (kind === 'powerpoint-win') {
    const ps = `$ErrorActionPreference='Stop'; $app=New-Object -ComObject PowerPoint.Application;
      $p=$app.Presentations.Open('${pptx.replace(/'/g, "''")}', $true, $false, $false);
      $p.SaveAs('${pdf.replace(/'/g, "''")}', 32); $p.Close(); $app.Quit()`;
    try { await run('powershell', ['-NoProfile', '-Command', ps], { timeout: 180000, signal }); return pdf; } catch (e) {
      cancelled();
      console.error('PowerPoint COM 转换失败，尝试 LibreOffice：', (e.stderr || e.message).toString().trim());
    }
  }
  const soffice = kind?.startsWith('libreoffice:') ? kind.slice(12) : (which('soffice') || which('libreoffice'));
  if (soffice) {
    try { await run(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', workDir, pptx], { timeout: 600000, signal }); } catch (e) { cancelled(); throw e; }
    const out = path.join(workDir, path.basename(pptx).replace(/\.pptx$/i, '.pdf'));
    if (fs.existsSync(out)) { fs.renameSync(out, pdf); return pdf; }
  }
  return null;
}

/**
 * 解析 PPTX 并渲染整页图：{pages:[{title,text,notes,hidden,image?}], images, renderer, work}
 * 隐藏页会被 PowerPoint/LibreOffice 导出 PDF 时跳过，导致页图缺失甚至错位，所以渲染前先取消隐藏。
 */
async function renderPptx(file, job) {
  job.step('解析 PPTX');
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const { order, cy } = await slideOrder(zip);
  const pages = [];
  for (const p of order) {
    const xml = await zip.file(p).async('string');
    const hidden = /<p:sld\b[^>]*\sshow="(0|false)"/.test(xml);
    const parsed = parseSlideXml(xml, cy);
    zip.file(p, parsed.stripped.replace(/(<p:sld\b[^>]*?)\s+show="(?:0|false)"/, '$1'));
    const notesRel = (await zip.file(p.replace('slides/', 'slides/_rels/') + '.rels')?.async('string')) || '';
    const notesTarget = (notesRel.match(/Target="\.\.\/notesSlides\/([^"]+)"/) || [])[1];
    const notes = notesTarget ? paragraphs(await zip.file(`ppt/notesSlides/${notesTarget}`).async('string')).filter((t) => !/^\d+$/.test(t)).join('\n') : '';
    pages.push({ ...parsed, notes, hidden, page: pages.length + 1 });
  }
  const work = path.join(CACHE, `pptx-${shortId(4)}`);
  fs.mkdirSync(work, { recursive: true });
  const strippedPptx = path.join(work, 'stripped.pptx');
  fs.writeFileSync(strippedPptx, await zip.generateAsync({ type: 'nodebuffer' }));
  await job.checkpoint();
  let images = [];
  const renderer = pptxRenderer();
  try {
    job.step(`转换整页图（${renderer?.startsWith('powerpoint') ? 'PowerPoint' : 'LibreOffice'}，${pages.length} 页，大文件需要几分钟）`);
    const pdf = await pptxToPdf(strippedPptx, work, job.signal);
    await job.checkpoint();
    if (pdf) images = await pdfToJpegs(pdf, path.join(work, 'img'), { onEach: async (i, n) => { job.step('拆分页面图', i, n); await job.checkpoint(); } });
  } catch (e) {
    if (job.signal?.aborted) { fs.rmSync(work, { recursive: true, force: true }); throw e; }
    console.error('渲染整页图失败：', e.message);
  }
  if (images.length && images.length !== pages.length) {
    // 页数对不上时按序号对齐会张冠李戴，宁可不放图
    console.error(`整页图数量（${images.length}）与幻灯片数量（${pages.length}）不一致，已放弃页图以免错位`);
    images = [];
  }
  pages.forEach((pg, i) => { pg.image = images[i]; });
  return { pages, images, renderer, work };
}

/** 默认去掉封面/封底/目录/人员介绍页（opts.skipBoilerplate === false 时全部保留） */
async function skipPages(pages, opts, job) {
  const extra = { source_pages: pages.length };
  if (opts.skipBoilerplate === false) return { pages, extra };
  const { keep, skipped, by, error } = await dropBoilerplate(pages, job);
  if (error) console.error('AI 识别封面/目录页失败，已改用规则：', error);
  await job.checkpoint();
  return { pages: keep, by, extra: { ...extra, skipped } };
}

const noImageNote = (renderer) => renderer
  ? '（这一页的整页图没有生成成功：可在"上传素材"里重新上传同名 PPTX，选择"补全缺图页"）'
  : '（未能渲染原页图片：服务器缺少 PowerPoint / LibreOffice）';

export async function importPptx(file, opts = {}) {
  pull();
  const job = opts.job || NOJOB;
  const { pages, images, renderer, work } = await renderPptx(file, job);
  try {
    const keep = await skipPages(pages, opts, job);
    const res = await imageDeck(keep.pages, { ...opts, noImage: noImageNote(renderer), deckExtra: keep.extra }, 'pptx', file);
    return { ...res, rendered_images: images.length, pages: pages.length, hidden_pages: keep.pages.filter((p) => p.hidden).length, renderer, classified_by: keep.by };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

/** 已入库的 PPTX deck 有缺图页时：重新渲染同一份 PPTX，只给缺图页补上整页图（页面 id、标签、血缘都不变） */
export async function repairPptxImages(deckId, file, opts = {}) {
  pull();
  const job = opts.job || NOJOB;
  const deck = listDecks().find((d) => d.id === deckId) || fail(`没有这个 deck：${deckId}`);
  const missing = deck.slides.map((id, i) => ({ id, meta: getSlide(id) })).filter((x) => x.meta && !x.meta.source?.image).map((x) => ({ ...x, i: (x.meta.source?.page || 1) - 1 }));
  if (!missing.length) return { deck_id: deckId, repaired: [], note: '这个 deck 没有缺图页' };
  const { pages, images, work } = await renderPptx(file, job);
  try {
    const expect = deck.source_pages || deck.slides.length;
    if (pages.length !== expect) fail(`上传的 PPTX 有 ${pages.length} 页，库中「${deck.title}」的原文件有 ${expect} 页，不是同一份文件，不能补图`);
    if (!images.length) fail('整页图仍然没有渲染出来，请检查 PowerPoint / LibreOffice');
    const repaired = [];
    for (const { id, i, meta } of missing) {
      const img = pages[i].image;
      if (!img) continue;
      const dir = slideDir(id);
      const ext = path.extname(img).toLowerCase() || '.jpg';
      fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
      fs.copyFileSync(img, path.join(dir, `assets/page${ext}`));
      const htmlFile = path.join(dir, 'slide.html');
      fs.writeFileSync(htmlFile, fs.readFileSync(htmlFile, 'utf8').replace(/<div class="page-image">[\s\S]*?<\/div>/, `<div class="page-image"><img src="assets/page${ext}" alt="" data-replaceable></div>`));
      meta.source = { ...meta.source, image: true, ...(pages[i].hidden ? { hidden: true } : {}) };
      meta.content_hash = contentHash(dir);
      saveMeta(meta);
      repaired.push({ id, page: i + 1, title: meta.title });
    }
    await renderThumbs(repaired.map((r) => r.id), job);
    job.step('提交到共享仓库');
    const git = commitAndPush([rel(SLIDES)], `[补图] ${deck.title}：补全 ${repaired.length} 页整页图 by ${identity().name}`);
    return { deck_id: deckId, repaired, git };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

/** 通用："HTML 主标题 + 整页图"的 deck。pages: [{title, text, notes?, image?, hidden?}] */
async function imageDeck(pages, opts, format, file) {
  const job = opts.job || NOJOB;
  const fileName = opts.sourceName || path.basename(file);
  const title = opts.title || fileName.replace(/\.[^.]+$/, '');
  const prefix = asciiSlug(opts.slug || fileName.replace(/\.[^.]+$/, ''), format);
  const theme = opts.theme || 'light';
  const slides = [];
  try {
    for (const [i, pg] of pages.entries()) {
      job.step('写入页面', i, pages.length);
      const no = pg.page ?? i + 1;
      const t = pg.title || `${title} 第 ${no} 页`;
      const ext = pg.image ? path.extname(pg.image).toLowerCase() || '.jpg' : '';
      const html = `<section class="slide layout-image-page" data-layout="image-page">
  <h2 data-editable>${escapeHtml(t)}</h2>
  <div class="page-image">${pg.image ? `<img src="assets/page${ext}" alt="" data-replaceable>` : `<p class="muted">${escapeHtml(opts.noImage || '（这一页没有整页图）')}</p>`}</div>
</section>`;
      slides.push(createSlide({
        id: newSlideId(prefix, no), html, files: pg.image ? [{ name: `assets/page${ext}`, src: pg.image }] : [],
        meta: {
          title: t, text: [pg.text || t, pg.notes && `备注：${pg.notes}`].filter(Boolean).join('\n'), theme,
          customer: opts.customer || '', scope: opts.customer ? 'customer-specific' : 'universal',
          source: { format, deck_id: null, page: no, file: pg.file || fileName, image: !!pg.image, ...(pg.hidden ? { hidden: true } : {}) },
        },
      }));
    }
    await job.checkpoint();
  } catch (e) { rollback(slides.map((s) => s.id)); throw e; }
  const deck = deckRecord({ ...opts, title }, slides.map((s) => s.id), format, fileName);
  for (const s of slides) { s.source.deck_id = deck.id; s.deck_title = title; s.content_hash = contentHash(slideDir(s.id)); saveMeta(s); }
  return finish(deck, slides, format, job);
}

/** PDF 入库：每页整页图 + 提取的标题与文字 */
export async function importPdf(file, opts = {}) {
  pull();
  const job = opts.job || NOJOB;
  const work = path.join(CACHE, `pdf-${shortId(4)}`);
  try {
    const pages = await pdfPages(file, work, { onEach: async (i, n) => { job.step('渲染 PDF 页面', i, n); await job.checkpoint(); } });
    if (!pages.length) fail('PDF 没有页面');
    const keep = await skipPages(pages.map((p, i) => ({ title: p.title, text: p.text, image: p.file, page: i + 1 })), opts, job);
    return { ...(await imageDeck(keep.pages, { ...opts, deckExtra: keep.extra }, 'pdf', file)), pages: pages.length, classified_by: keep.by };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

/** 图片入库：每张图一页，标题取文件名；files: [{path, name}] */
export async function importImages(files, opts = {}) {
  pull();
  if (!files.length) fail('没有图片');
  const pages = files.map((f) => {
    const base = (f.name || path.basename(f.path)).replace(/\.[^.]+$/, '');
    return { title: base, text: base, image: f.path, file: f.name || path.basename(f.path) };
  });
  return imageDeck(pages, { title: opts.title || (files.length === 1 ? pages[0].title : `图片素材 ${today()}`), ...opts, sourceName: opts.sourceName || files[0].name || path.basename(files[0].path) }, 'image', files[0].path);
}

export const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;

/** 按扩展名分发入库 */
export function ingestFile(file, opts = {}) {
  const name = opts.sourceName || path.basename(file);
  if (/\.pptx$/i.test(name)) return importPptx(file, opts);
  if (/\.pdf$/i.test(name)) return importPdf(file, opts);
  if (/\.html?$/i.test(name)) return ingestHtml(file, opts);
  if (IMAGE_EXT.test(name)) return importImages([{ path: file, name }], opts);
  fail(`不支持的文件类型：${name}（支持 PPTX / PDF / 图片 / HTML）`);
}
