import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { CACHE, THEMES, ROOT } from './paths.js';
import { shortId } from './util.js';

const W = 1920, H = 1080;
let browserPromise;

export function browser() {
  if (!browserPromise) {
    const args = ['--allow-file-access-from-files'];
    browserPromise = chromium.launch({ args }).catch(async (e) => {
      for (const channel of ['chrome', 'msedge']) {
        try { return await chromium.launch({ args, channel }); } catch {}
      }
      throw new Error(`无法启动 Chromium：请运行 npx playwright install chromium（${e.message.split('\n')[0]}）`);
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await b?.close(); }
}

/** 生成完整的单页文档。base/themeHref 可以是 file:// 或 http 路径 */
export function slideDocument({ html, base, theme = 'dark', themeHref, head = '', body = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<base href="${base}">
<link rel="stylesheet" href="${themeHref}">
<style>html,body{margin:0;background:transparent}body.render .slide{margin:0}</style>${head}
</head><body class="theme-${theme} render">${html}${body}</body></html>`;
}

const fileUrl = (p) => pathToFileURL(p).href;
const themeFileHref = () => fileUrl(path.join(THEMES, 'theme.css'));

/**
 * 渲染若干页。items: [{html, dir, theme, png?, jpg?, thumb?}]
 * dir 为该页资源目录（assets/ 相对它解析）
 */
export async function renderSlides(items) {
  const b = await browser();
  const full = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const small = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 / 3 });
  fs.mkdirSync(CACHE, { recursive: true });
  const tmp = path.join(CACHE, `render-${shortId(4)}.html`);
  try {
    for (const it of items) {
      fs.writeFileSync(tmp, slideDocument({ html: it.html, base: fileUrl(it.dir + path.sep), theme: it.theme, themeHref: themeFileHref() }));
      const shoot = async (page, opts) => {
        await page.goto(fileUrl(tmp), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        return page.screenshot({ clip: { x: 0, y: 0, width: W, height: H }, ...opts });
      };
      if (it.png) await shoot(full, { path: it.png, type: 'png' });
      if (it.jpg) await shoot(full, { path: it.jpg, type: 'jpeg', quality: 88 });
      if (it.thumb) await shoot(small, { path: it.thumb, type: 'jpeg', quality: 80 });
    }
  } finally {
    fs.rmSync(tmp, { force: true });
    await full.close();
    await small.close();
  }
}

/** 用 pdf.js 把 PDF 每页渲染为 JPEG（宽 1920），返回文件路径列表 */
export async function pdfToJpegs(pdfPath, outDir, width = W) {
  const b = await browser();
  const page = await b.newPage();
  fs.mkdirSync(outDir, { recursive: true });
  const pdfjs = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build');
  const host = path.join(CACHE, `pdf-${shortId(4)}.html`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(host, `<!doctype html><meta charset="utf-8"><script type="module">
import * as pdfjsLib from '${fileUrl(path.join(pdfjs, 'pdf.min.mjs'))}';
pdfjsLib.GlobalWorkerOptions.workerSrc = '${fileUrl(path.join(pdfjs, 'pdf.worker.min.mjs'))}';
window.pdfjsLib = pdfjsLib;
</script>`);
  try {
    await page.goto(fileUrl(host));
    await page.waitForFunction(() => window.pdfjsLib);
    const data = fs.readFileSync(pdfPath).toString('base64');
    const count = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      window._pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      return window._pdf.numPages;
    }, data);
    const out = [];
    for (let i = 1; i <= count; i++) {
      const b64 = await page.evaluate(async ({ i, width }) => {
        const p = await window._pdf.getPage(i);
        const vp0 = p.getViewport({ scale: 1 });
        const vp = p.getViewport({ scale: width / vp0.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await p.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
        return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
      }, { i, width });
      const f = path.join(outDir, `page-${String(i).padStart(3, '0')}.jpg`);
      fs.writeFileSync(f, Buffer.from(b64, 'base64'));
      out.push(f);
    }
    return out;
  } finally {
    fs.rmSync(host, { force: true });
    await page.close();
  }
}
