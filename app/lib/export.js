import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { EXPORTS, THEMES, CACHE, rel } from './paths.js';
import { getDraft, draftSlideDir, markDraft } from './drafts.js';
import { renderSlides } from './render.js';
import { appendEvent } from './events.js';
import { commitAndPush, pull } from './git.js';
import { identity } from './identity.js';
import { listFiles, htmlToText, escapeHtml, shortId } from './util.js';

const safeName = (s) => String(s || 'deck').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);

function playerHtml(d, sections) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(d.name)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="theme.css">
<style>
html,body{margin:0;height:100%;background:#0b0b0c;overflow:hidden}
#stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center}
#stage>.page{position:absolute;inset:0;display:none}#stage>.page.on{display:block}
#hud{position:fixed;right:20px;bottom:14px;font:14px/1 system-ui;color:#888;opacity:.0;transition:.3s}
body:hover #hud{opacity:1}
@media print{html,body{overflow:visible;background:none}#stage{position:static;transform:none!important}#stage>.page{display:block!important;position:relative;page-break-after:always}#hud{display:none}}
</style></head>
<body class="theme-${d.theme}">
<div id="stage">${sections.map((s) => `<div class="page">${s.html}</div>`).join('\n')}</div>
<div id="hud"></div>
<script>
const pages=[...document.querySelectorAll('.page')];let i=Math.max(0,Math.min(pages.length-1,(+location.hash.slice(1)||1)-1));
const stage=document.getElementById('stage'),hud=document.getElementById('hud');
function fit(){const s=Math.min(innerWidth/1920,innerHeight/1080);stage.style.transform='translate(-50%,-50%) scale('+s+')';}
function show(n){i=Math.max(0,Math.min(pages.length-1,n));pages.forEach((p,k)=>p.classList.toggle('on',k===i));hud.textContent=(i+1)+' / '+pages.length+'  ←/→ 翻页  F 全屏';history.replaceState(null,'','#'+(i+1));}
addEventListener('keydown',e=>{if(['ArrowRight','ArrowDown','PageDown',' ','Enter'].includes(e.key))show(i+1);else if(['ArrowLeft','ArrowUp','PageUp','Backspace'].includes(e.key))show(i-1);else if(e.key==='Home')show(0);else if(e.key==='End')show(pages.length-1);else if(e.key==='f'||e.key==='F'){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();}});
addEventListener('click',e=>{if(e.target.closest('a'))return;show(e.clientX>innerWidth/3?i+1:i-1)});
addEventListener('resize',fit);fit();show(i);
</script></body></html>`;
}

/** 把每页的 assets/ 引用改写为 slides/NN/assets/ */
const rebase = (html, dir) => html
  .replace(/(\ssrc\s*=\s*["'])assets\//gi, `$1slides/${dir}/assets/`)
  .replace(/url\((["']?)assets\//gi, `url($1slides/${dir}/assets/`);

async function buildZip(d, outFile) {
  const zip = new JSZip();
  const root = zip.folder('deck');
  root.file('theme.css', fs.readFileSync(path.join(THEMES, 'theme.css')));
  const sections = [];
  d.slides.forEach((s, i) => {
    const dir = String(i + 1).padStart(2, '0');
    const src = draftSlideDir(d.id, s.key);
    for (const f of listFiles(src)) root.file(`slides/${dir}/${f}`, fs.readFileSync(path.join(src, f)));
    const html = fs.readFileSync(path.join(src, 'slide.html'), 'utf8');
    sections.push({ dir, html: rebase(html, dir) });
  });
  root.file('index.html', playerHtml(d, sections));
  root.file('deck.json', JSON.stringify({
    name: d.name, customer: d.customer, theme: d.theme, draft_id: d.id, exported_by: identity().display, exported_at: new Date().toISOString(),
    slides: d.slides.map((s, i) => ({ pos: i + 1, dir: `slides/${String(i + 1).padStart(2, '0')}`, source_id: s.source_id, modified: s.modified })),
  }, null, 2));
  fs.writeFileSync(outFile, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function buildPptx(d, outFile) {
  const work = path.join(CACHE, `export-${shortId(4)}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    const items = d.slides.map((s, i) => {
      const dir = draftSlideDir(d.id, s.key);
      return { html: fs.readFileSync(path.join(dir, 'slide.html'), 'utf8'), dir, theme: d.theme, jpg: path.join(work, `${i}.jpg`) };
    });
    await renderSlides(items);
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = d.name;
    pptx.author = identity().name;
    items.forEach((it) => {
      const slide = pptx.addSlide();
      slide.addImage({ path: it.jpg, x: 0, y: 0, w: 13.333, h: 7.5 });
      slide.addNotes(htmlToText(it.html));
    });
    await pptx.writeFile({ fileName: outFile });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** 导出草稿：生成 zip / pptx，记录一次使用（export 事件）并同步 */
export async function exportDraft(id, formats = ['zip', 'pptx']) {
  const d = getDraft(id);
  if (!d.slides.length) throw Object.assign(new Error('草稿是空的'), { expose: true });
  const outDir = path.join(EXPORTS, d.id);
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, safeName(d.name));
  const files = [];
  if (formats.includes('zip')) { await buildZip(d, base + '.zip'); files.push(base + '.zip'); }
  if (formats.includes('pptx')) { await buildPptx(d, base + '.pptx'); files.push(base + '.pptx'); }
  pull();
  const { event, file } = appendEvent('export', {
    draft_id: d.id, deck_name: d.name, customer: d.customer, formats, theme: d.theme,
    slides: d.slides.map((s, i) => ({ pos: i + 1, source_id: s.source_id, modified: s.modified, ...(s.modified ? { diff: s.diff } : {}) })),
  });
  const git = commitAndPush([rel(file)], `[导出] ${d.name}${d.customer ? `（${d.customer}）` : ''} ${d.slides.length} 页 by ${identity().name}`);
  markDraft(id, { exported_at: event.ts });
  return { files, event, git };
}
