#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, CODE_ROOT, SKILL_DIR, SLIDES } from '../app/lib/paths.js';
import { readJson } from '../app/lib/util.js';

const HELP = `psl —— 售前素材库命令行（所有输出为 JSON）

素材库
  psl serve [--port 4173] [--open]           启动本地网页
  psl serve --server [--host 0.0.0.0]        服务器模式：多人通过网址访问，需账号登录
  psl ingest <文件>                           按扩展名自动入库（PPTX / PDF / 图片 / HTML）
  psl ingest-html <deck.html> [--title T] [--customer C] [--theme dark|light] [--slug ascii-slug] [--report-type 交流]
  psl import-pptx <deck.pptx> [同上参数] [--keep-all]   旧 PPTX 入库：HTML 主标题 + 整页图；默认跳过封面/封底/目录/人物介绍页，--keep-all 全部入库
  psl import-pdf <file.pdf> [同上参数]         PDF 入库：每页整页图 + 提取的文字
  psl import-images <a.png> [b.jpg …] [同上参数]  图片入库：每张一页
  psl repair-images <deckId> <deck.pptx>      已入库 PPTX deck 有缺图页时，用同一份 PPTX 补全整页图（id/标签/血缘不变）
  psl ai-tag [slideId …]                     AI 自动打标（默认对所有待打标页）
  psl delete <slideId …> [--yes] [--reason 说明]   管理员删除已入库页面（不加 --yes 只预览）
AI 与配置
  psl config llm --base-url https://api.deepseek.com/v1 --api-key sk-… --model deepseek-chat   配置 OpenAI 兼容模型
  psl ai-rewrite <draftId> <key> --instruction "改写要求"   AI 改写草稿中的一页（记录到使用日志）
  psl ai-undo <draftId> <key>                撤销最近一次 AI 改写
  psl user add <用户名> --name 姓名 --email 邮箱 [--password P] [--admin] | user list | user passwd <用户名> | user remove <用户名>（服务器模式账号）
  psl untagged                               列出待打标页面（含全文）
  psl tag <slideId> --json '{"tags":{"条线":["零售"]},"customer":"","scope":"universal"}'
  psl tag --file tags.json                   批量打标：{"<slideId>": {tags, customer, scope}, ...}
  psl search [关键词] [--filter '{"条线":["零售"]}'] [--limit 20]
  psl show <slideId>                         查看页面元数据、HTML 路径、版本树
  psl taxonomy                               查看标签体系
拼装与修改
  psl draft create --name N [--customer C] [--theme dark|light] --slides id1,id2,...
  psl draft list | show <draftId> | path <draftId>
  psl draft insert <draftId> (--source <slideId> | --layout <cover|section|bullets|method|data|case|compare|fusion|image-text>) [--pos 0]
  psl draft remove <draftId> <key> | order <draftId> key1,key2,... | set <draftId> [--name] [--customer] [--theme]
  psl draft checkpoint <draftId> <key>       Agent 改写前打检查点
  psl draft log-edit <draftId> <key> --instruction "要求" --by "Devin"   Agent 改完后记录本次 AI 改写（可在网页撤销）
  psl export <draftId> [--formats zip,pptx]   导出并记录一次使用
  psl promote <draftId> [--keys k1,k2] [--note 说明]   讲完效果好：改过的页入库为"微调"
统计与维护
  psl stats [--limit 30]                     页面使用排行、客户热度
  psl history <slideId>                      版本树与修改记录
  psl sync | reindex | render-thumbs [ids...] | doctor | install-skill | where
`;

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) opt[k] = true; else { opt[k] = v; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}
const out = (o) => console.log(JSON.stringify(o, null, 2));
const list = (s) => (typeof s === 'string' ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
const ingestOpts = (o) => ({ title: o.title, customer: o.customer, theme: o.theme, slug: o.slug, reportType: o['report-type'], keepAll: !!o['keep-all'] });

async function doctor() {
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, ...(ok ? {} : { fix }) });
  const run = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }).trim(); } catch (e) { return { error: (e.stderr || e.stdout || e.message).toString().trim() }; } };
  const major = Number(process.versions.node.split('.')[0]);
  add('Node.js', major >= 18, process.version, '安装 Node.js 18 及以上版本（https://nodejs.org）');
  const name = run('git', ['config', 'user.name']), email = run('git', ['config', 'user.email']);
  add('Git 身份', typeof name === 'string' && name && typeof email === 'string' && email, `${name?.error ? '' : name} <${email?.error ? '' : email}>`, 'git config --global user.name "姓名" && git config --global user.email "邮箱"');
  const remote = run('git', ['remote', 'get-url', 'origin']);
  add('远程仓库', typeof remote === 'string', typeof remote === 'string' ? remote : '未配置', 'git remote add origin git@github.com:<owner>/presales-library.git');
  if (typeof remote === 'string' && remote.startsWith('git@')) {
    const host = remote.split('@')[1].split(':')[0];
    let r = '';
    try { execFileSync('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', `git@${host}`], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }); } catch (e) { r = (e.stderr || '').toString(); }
    add('SSH 认证', /successfully authenticated/i.test(r), r.trim().split('\n').pop(), '生成 SSH 密钥（ssh-keygen -t ed25519）并把 ~/.ssh/id_ed25519.pub 添加到 GitHub → Settings → SSH keys');
  }
  if (typeof remote === 'string') {
    const ls = run('git', ['ls-remote', '--heads', 'origin']);
    add('远程仓库可访问', typeof ls === 'string', typeof ls === 'string' ? '可访问' : ls.error, '确认仓库地址正确，且你的 GitHub 账号已被邀请为 Collaborator');
  }
  add('依赖已安装', fs.existsSync(path.join(CODE_ROOT, 'node_modules', 'playwright')), '', 'npm install');
  try {
    const { browser, closeBrowser } = await import('../app/lib/render.js');
    await browser(); await closeBrowser();
    add('Chromium（渲染缩略图/PPTX）', true, '可用');
  } catch (e) { add('Chromium（渲染缩略图/PPTX）', false, e.message, 'npx playwright install chromium'); }
  const { pptxRenderer } = await import('../app/lib/ingest.js');
  const r = pptxRenderer();
  add('旧 PPTX 渲染工具', !!r, r || '未找到 PowerPoint / LibreOffice', '安装 Microsoft PowerPoint 或 LibreOffice（否则旧 PPTX 只能导入文字）');
  const conf = readJson(path.join(os.homedir(), '.presales-library.json'));
  add('Skill 已安装', conf?.root === CODE_ROOT, conf?.root || '未安装', 'npm run install-skill');
  return { ok: checks.every((c) => c.ok || c.name === '旧 PPTX 渲染工具'), checks };
}

function installSkill() {
  const home = os.homedir();
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const targets = process.platform === 'win32'
    ? [path.join(appdata, 'devin', 'skills'), path.join(home, '.claude', 'skills'), path.join(home, '.agents', 'skills')]
    : [path.join(home, '.config', 'devin', 'skills'), path.join(home, '.claude', 'skills'), path.join(home, '.agents', 'skills')];
  const results = [];
  for (const t of targets) {
    const link = path.join(t, 'presales-library');
    try {
      fs.mkdirSync(t, { recursive: true });
      let exists = false;
      try { fs.lstatSync(link); exists = true; } catch {}
      if (exists) {
        const real = fs.realpathSync(link);
        if (real === fs.realpathSync(SKILL_DIR)) { results.push({ target: link, status: '已安装' }); continue; }
        results.push({ target: link, status: '已存在同名目录，未覆盖', points_to: real }); continue;
      }
      fs.symlinkSync(SKILL_DIR, link, process.platform === 'win32' ? 'junction' : 'dir');
      results.push({ target: link, status: '已链接' });
    } catch (e) { results.push({ target: link, status: '失败', error: e.message }); }
  }
  fs.writeFileSync(path.join(home, '.presales-library.json'), JSON.stringify({ root: CODE_ROOT }, null, 2));
  let shim = null;
  if (process.platform !== 'win32') {
    const bin = path.join(home, '.local', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    shim = path.join(bin, 'psl');
    fs.writeFileSync(shim, `#!/bin/sh\nexec node "${path.join(CODE_ROOT, 'bin', 'psl.js')}" "$@"\n`, { mode: 0o755 });
  } else {
    const bin = path.join(home, '.local', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    shim = path.join(bin, 'psl.cmd');
    fs.writeFileSync(shim, `@node "${path.join(CODE_ROOT, 'bin', 'psl.js')}" %*\r\n`);
  }
  return { skill: results, config: path.join(home, '.presales-library.json'), shim, note: `若命令行找不到 psl，可把 ${path.dirname(shim)} 加入 PATH，或直接使用 node "${path.join(CODE_ROOT, 'bin', 'psl.js')}"` };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  if (!cmd || cmd === 'help' || opt.help) return console.log(HELP);

  if (cmd === 'where') return out({ root: CODE_ROOT, data: ROOT, skill: path.join(SKILL_DIR, 'SKILL.md') });
  if (cmd === 'doctor') return out(await doctor());
  if (cmd === 'install-skill') return out(installSkill());
  if (cmd === 'serve') {
    const { serve } = await import('../app/server.js');
    serve({ port: Number(opt.port || process.env.PSL_PORT) || 4173, host: opt.host, open: !!opt.open, server: !!opt.server });
    return;
  }
  if (cmd === 'config') {
    const { saveConfig, loadConfig, llmEnabled } = await import('../app/lib/config.js');
    if (pos[0] === 'llm' && (opt['base-url'] || opt['api-key'] || opt.model)) {
      const patch = {};
      if (opt['base-url']) patch.base_url = opt['base-url'];
      if (opt['api-key']) patch.api_key = opt['api-key'];
      if (opt.model) patch.model = opt.model;
      saveConfig({ llm: patch });
    }
    const c = loadConfig();
    return out({ llm: { base_url: c.llm.base_url, model: c.llm.model, api_key: c.llm.api_key ? `已配置（…${c.llm.api_key.slice(-4)}）` : '未配置', enabled: llmEnabled() } });
  }
  if (cmd === 'user') {
    const auth = await import('../app/lib/auth.js');
    const [sub, username] = pos;
    if (sub === 'add') return out(auth.addUser({ username, name: opt.name, email: opt.email, password: opt.password, role: opt.admin ? 'admin' : 'member' }));
    if (sub === 'passwd') return out(auth.setPassword(username, opt.password));
    if (sub === 'remove') return out(auth.removeUser(username));
    return out(auth.listUsers());
  }

  const { buildIndex, filterSlides, history, usageRanking } = await import('../app/lib/indexer.js');
  const lib = await import('../app/lib/library.js');
  const { closeBrowser } = await import('../app/lib/render.js');
  try {
    switch (cmd) {
      case 'ingest': { const { ingestFile } = await import('../app/lib/ingest.js'); return out(await ingestFile(pos[0], ingestOpts(opt))); }
      case 'import-pdf': { const { importPdf } = await import('../app/lib/ingest.js'); return out(await importPdf(pos[0], ingestOpts(opt))); }
      case 'import-images': { const { importImages } = await import('../app/lib/ingest.js'); return out(await importImages(pos.map((p) => ({ path: p, name: path.basename(p) })), ingestOpts(opt))); }
      case 'ai-tag': {
        const { autoTag } = await import('../app/lib/ai.js');
        const ids = pos.length ? pos : lib.listSlides().filter((s) => !s.tagged).map((s) => s.id);
        return out({ tagged: await autoTag(ids) });
      }
      case 'ai-rewrite': { const { rewriteSlide } = await import('../app/lib/ai.js'); return out(await rewriteSlide(pos[0], pos[1], opt.instruction || pos.slice(2).join(' '))); }
      case 'ai-undo': { const { undoAiEdit } = await import('../app/lib/ai.js'); return out(undoAiEdit(pos[0], pos[1])); }
      case 'ingest-html': { const { ingestHtml } = await import('../app/lib/ingest.js'); return out(await ingestHtml(pos[0], ingestOpts(opt))); }
      case 'repair-images': { const { repairPptxImages } = await import('../app/lib/ingest.js'); return out(await repairPptxImages(pos[0], pos[1])); }
      case 'import-pptx': { const { importPptx } = await import('../app/lib/ingest.js'); return out(await importPptx(pos[0], ingestOpts(opt))); }
      case 'render-thumbs': {
        const { renderThumbs } = await import('../app/lib/ingest.js');
        const ids = pos.length ? pos : fs.readdirSync(SLIDES);
        await renderThumbs(ids); return out({ rendered: ids.length });
      }
      case 'delete': {
        const del = await import('../app/lib/delete.js');
        if (!opt.yes) return out({ preview: del.deletePlan(pos), next: '确认无误后加 --yes 执行删除' });
        return out(del.deleteSlides(pos, { reason: opt.reason || '' }));
      }
      case 'untagged': return out(lib.listSlides().filter((s) => !s.tagged).map((s) => ({ id: s.id, title: s.title, deck: s.deck_title, customer: s.customer, text: s.text })));
      case 'taxonomy': return out(lib.loadTaxonomy());
      case 'tag': {
        const { commitAndPush } = await import('../app/lib/git.js');
        const { appendEvent } = await import('../app/lib/events.js');
        const { rel, LIB } = await import('../app/lib/paths.js');
        const patches = opt.file ? JSON.parse(fs.readFileSync(opt.file, 'utf8')) : { [pos[0]]: JSON.parse(opt.json) };
        const missing = Object.keys(patches).filter((id) => !fs.existsSync(path.join(lib.slideDir(id), 'meta.json')));
        if (missing.length) throw new Error(`找不到这些页面，未做任何修改：${missing.join(', ')}`);
        const done = Object.entries(patches).map(([id, p]) => lib.applyTags(id, p));
        const { file } = appendEvent('tag_edit', { slide_ids: done.map((d) => d.id), by: 'agent' });
        const git = commitAndPush([rel(LIB), rel(file)], `[打标] ${done.length} 页`);
        return out({ tagged: done.map((d) => ({ id: d.id, title: d.title, tags: d.tags, customer: d.customer, scope: d.scope })), git });
      }
      case 'search': {
        const ix = buildIndex();
        const res = filterSlides(ix, { q: pos.join(' '), filters: opt.filter ? JSON.parse(opt.filter) : {} }).slice(0, Number(opt.limit) || 20);
        return out(res.map((s) => ({ id: s.id, title: s.title, deck: s.deck_title, customer: s.customer, scope: s.scope, origin: s.origin, tags: s.tags, used: s.usage.exports, snippet: s.text.slice(0, 160) })));
      }
      case 'show': {
        const ix = buildIndex();
        const s = ix.byId[pos[0]] || (() => { throw new Error(`找不到页面：${pos[0]}`); })();
        return out({ ...s, html_file: path.join(lib.slideDir(s.id), 'slide.html'), history: history(ix, s.id) });
      }
      case 'history': return out(history(buildIndex(), pos[0]));
      case 'stats': { const ix = buildIndex(); return out({ counts: ix.counts, ranking: usageRanking(ix, { limit: Number(opt.limit) || 30 }), customers: ix.customers }); }
      case 'reindex': { const ix = buildIndex({ write: true }); return out({ ...ix.counts, file: '.cache/index.json' }); }
      case 'sync': { const g = await import('../app/lib/git.js'); return out({ pull: g.pull(), push: g.pushPending() }); }
      case 'export': { const { exportDraft } = await import('../app/lib/export.js'); return out(await exportDraft(pos[0], opt.formats ? list(opt.formats) : ['zip', 'pptx'])); }
      case 'promote': { const { promoteDraft } = await import('../app/lib/promote.js'); return out(await promoteDraft(pos[0], { keys: opt.keys ? list(opt.keys) : undefined, note: opt.note || '' })); }
      case 'draft': {
        const dr = await import('../app/lib/drafts.js');
        const [sub, id, key] = pos;
        if (sub === 'create') return out(dr.createDraft({ name: opt.name, customer: opt.customer || '', theme: opt.theme || 'dark', slide_ids: list(opt.slides) }));
        if (sub === 'list') return out(dr.listDrafts());
        if (sub === 'show') return out(dr.getDraft(id));
        if (sub === 'path') {
          const d = dr.getDraft(id);
          return out({ draft_dir: path.dirname(dr.draftSlideDir(id, 'x')), slides: d.slides.map((s, i) => ({ pos: i + 1, key: s.key, title: s.title, source_id: s.source_id, modified: s.modified, html_file: path.join(dr.draftSlideDir(id, s.key), 'slide.html') })) });
        }
        if (sub === 'insert') { const e = dr.insertSlide(id, { source_id: opt.source, layout: opt.layout, pos: opt.pos !== undefined ? Number(opt.pos) : undefined }); return out({ ...e, html_file: path.join(dr.draftSlideDir(id, e.key), 'slide.html') }); }
        if (sub === 'remove') { dr.removeSlide(id, key); return out(dr.getDraft(id)); }
        if (sub === 'order') return out(dr.updateDraft(id, { order: list(key) }));
        if (sub === 'set') return out(dr.updateDraft(id, { name: opt.name, customer: opt.customer, theme: opt.theme }));
        if (sub === 'checkpoint') { const { checkpoint } = await import('../app/lib/ai.js'); return out(checkpoint(id, key)); }
        if (sub === 'log-edit') { const { logAgentEdit } = await import('../app/lib/ai.js'); return out(logAgentEdit(id, key, opt.instruction, opt.by || 'agent')); }
        throw new Error('未知的 draft 子命令');
      }
      default: console.log(HELP); process.exitCode = 1;
    }
  } finally {
    await closeBrowser();
  }
}

main().catch((e) => { out({ error: e.message }); process.exitCode = 1; });
