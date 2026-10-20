import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import { createSlide, newSlideId, saveDeck, slideDir, getSlide, saveMeta } from './library.js';
import { renderSlides, pdfToJpegs } from './render.js';
import { appendEvent } from './events.js';
import { commitAndPush, pull } from './git.js';
import { identity } from './identity.js';
import { asciiSlug, shortId, today, nowIso, decodeEntities, escapeHtml, fail, contentHash } from './util.js';
import { rel, SLIDES, DECKS, CACHE } from './paths.js';

const SECTION_RE = /<section\b[^>]*class\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi;

export async function renderThumbs(ids) {
  await renderSlides(ids.map((id) => {
    const dir = slideDir(id);
    return { html: fs.readFileSync(path.join(dir, 'slide.html'), 'utf8'), dir, theme: getSlide(id).theme, thumb: path.join(dir, 'thumb.jpg') };
  }));
}

function deckRecord(opts, slideIds, format, sourceFile) {
  const me = identity();
  const id = `${today()}-${asciiSlug(opts.slug || opts.title)}-${shortId()}`;
  const deck = {
    id, title: opts.title, customer: opts.customer || '', report_type: opts.reportType || '',
    format, source_file: sourceFile ? path.basename(sourceFile) : null,
    slides: slideIds, author: me.display, created_at: nowIso(),
  };
  saveDeck(deck);
  return deck;
}

async function finish(deck, slides, format) {
  await renderThumbs(slides.map((s) => s.id));
  const { file } = appendEvent('ingest', { deck_id: deck.id, deck_title: deck.title, format, slide_ids: slides.map((s) => s.id) });
  const git = commitAndPush([rel(SLIDES), rel(DECKS), rel(file)], `[入库] ${deck.title}（${slides.length} 页）by ${identity().name}`);
  return {
    deck_id: deck.id, git, untagged: slides.map((s) => ({ id: s.id, title: s.title, text: s.text.slice(0, 600) })),
    next: '请为以上页面打标：psl tag --file tags.json（格式见 SKILL.md），或在网页详情里编辑',
  };
}

/** 入库一个 HTML deck：文件中每个 <section class="slide"> 为一页 */
export async function ingestHtml(file, opts = {}) {
  pull();
  const html = fs.readFileSync(file, 'utf8');
  const sections = html.match(SECTION_RE) || fail('没有找到 <section class="slide">，请按 slide-spec 组织 HTML');
  const baseDir = path.dirname(path.resolve(file));
  const title = opts.title || decodeEntities((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim() || path.basename(file, path.extname(file));
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
  return finish(deck, slides, 'html');
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

/** PPTX → PDF（PowerPoint 优先，其次 LibreOffice） */
function pptxToPdf(pptx, workDir) {
  const kind = pptxRenderer();
  const pdf = path.join(workDir, 'deck.pdf');
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
      execFileSync('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 620000 });
      fs.copyFileSync(outFile, pdf);
      return pdf;
    } catch (e) {
      console.error('PowerPoint 转换失败，尝试 LibreOffice：', (e.stderr || e.message).toString().trim());
    } finally { for (const f of [inFile, outFile]) fs.rmSync(f, { force: true }); }
  }
  if (kind === 'powerpoint-win') {
    const ps = `$ErrorActionPreference='Stop'; $app=New-Object -ComObject PowerPoint.Application;
      $p=$app.Presentations.Open('${pptx.replace(/'/g, "''")}', $true, $false, $false);
      $p.SaveAs('${pdf.replace(/'/g, "''")}', 32); $p.Close(); $app.Quit()`;
    try { execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 }); return pdf; } catch (e) {
      console.error('PowerPoint COM 转换失败，尝试 LibreOffice：', (e.stderr || e.message).toString().trim());
    }
  }
  const soffice = kind?.startsWith('libreoffice:') ? kind.slice(12) : (which('soffice') || which('libreoffice'));
  if (soffice) {
    execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', workDir, pptx], { stdio: 'ignore', timeout: 300000 });
    const out = path.join(workDir, path.basename(pptx).replace(/\.pptx$/i, '.pdf'));
    if (fs.existsSync(out)) { fs.renameSync(out, pdf); return pdf; }
  }
  return null;
}

export async function importPptx(file, opts = {}) {
  pull();
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const { order, cy } = await slideOrder(zip);
  const pages = [];
  for (const p of order) {
    const xml = await zip.file(p).async('string');
    const parsed = parseSlideXml(xml, cy);
    zip.file(p, parsed.stripped);
    const notesRel = (await zip.file(p.replace('slides/', 'slides/_rels/') + '.rels')?.async('string')) || '';
    const notesTarget = (notesRel.match(/Target="\.\.\/notesSlides\/([^"]+)"/) || [])[1];
    const notes = notesTarget ? paragraphs(await zip.file(`ppt/notesSlides/${notesTarget}`).async('string')).filter((t) => !/^\d+$/.test(t)).join('\n') : '';
    pages.push({ ...parsed, notes });
  }
  const work = path.join(CACHE, `pptx-${shortId(4)}`);
  fs.mkdirSync(work, { recursive: true });
  const strippedPptx = path.join(work, 'stripped.pptx');
  fs.writeFileSync(strippedPptx, await zip.generateAsync({ type: 'nodebuffer' }));
  let images = [];
  try {
    const pdf = pptxToPdf(strippedPptx, work);
    if (pdf) images = await pdfToJpegs(pdf, path.join(work, 'img'));
  } catch (e) { console.error('渲染整页图失败：', e.message); }

  const title = opts.title || path.basename(file, path.extname(file));
  const prefix = asciiSlug(opts.slug || title);
  const theme = opts.theme || 'light';
  const slides = pages.map((pg, i) => {
    const t = pg.title || `第 ${i + 1} 页`;
    const img = images[i];
    const html = `<section class="slide layout-image-page" data-layout="image-page">
  <h2 data-editable>${escapeHtml(t)}</h2>
  <div class="page-image">${img ? '<img src="assets/page.jpg" alt="" data-replaceable>' : '<p class="muted">（未能渲染原页图片：请安装 PowerPoint 或 LibreOffice 后重新导入）</p>'}</div>
</section>`;
    const s = createSlide({
      id: newSlideId(prefix, i + 1), html, files: img ? [{ name: 'assets/page.jpg', src: img }] : [],
      meta: {
        title: t, text: [pg.text, pg.notes && `备注：${pg.notes}`].filter(Boolean).join('\n'), theme,
        customer: opts.customer || '', scope: opts.customer ? 'customer-specific' : 'universal',
        source: { format: 'pptx', deck_id: null, page: i + 1, file: path.basename(file), image: !!img },
      },
    });
    return s;
  });
  fs.rmSync(work, { recursive: true, force: true });
  const deck = deckRecord({ ...opts, title }, slides.map((s) => s.id), 'pptx', file);
  for (const s of slides) { s.source.deck_id = deck.id; s.deck_title = title; s.content_hash = contentHash(slideDir(s.id)); saveMeta(s); }
  const res = await finish(deck, slides, 'pptx');
  return { ...res, rendered_images: images.length, renderer: pptxRenderer() };
}
