import fs from 'node:fs';
import path from 'node:path';
import { chat, extractJson } from './llm.js';
import { loadDraft, saveDraft, draftSlideDir, slideState } from './drafts.js';
import { loadTaxonomy, applyTags, getSlide } from './library.js';
import { appendEvent } from './events.js';
import { commitAndPush } from './git.js';
import { identity } from './identity.js';
import { htmlTitle, htmlToText, nowIso, fail, sha } from './util.js';
import { SKILL_DIR, rel, LIB } from './paths.js';

const SPEC = () => fs.readFileSync(path.join(SKILL_DIR, 'references', 'slide-spec.md'), 'utf8');

const SYSTEM_REWRITE = () => `你是银行数智化售前材料的资深顾问兼前端设计师，负责按要求改写一页 HTML 幻灯片。
严格遵守以下规范：
${SPEC()}

输出要求：
- 只输出改写后的完整 <section class="slide ...">…</section>，不要任何解释、不要 Markdown 代码块。
- 保留根元素的 class 与 data-layout（除非要求明确更换版式），保留 data-editable / data-replaceable 标记。
- 保留原有图片的 src（assets/...），不要编造新的图片路径；不要写 <script>、不要引用外部资源、不要写死颜色。
- 内容要专业、简洁、符合银行客户语境；没有给出的数据不要编造具体数字，可用"XX"占位。`;

function lineDiff(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  const sa = new Set(a), sb = new Set(b);
  return { removed: a.filter((l) => !sb.has(l)).slice(0, 20), added: b.filter((l) => !sa.has(l)).slice(0, 20) };
}

const histDir = (id, key) => path.join(draftSlideDir(id, key), '..', '..', 'history', key);

/** 网页/Agent 发起的 AI 改写：保存备份、写回草稿、记录 ai_edit 事件并同步 */
export async function rewriteSlide(draftId, key, instruction) {
  if (!instruction?.trim()) fail('请填写改写要求');
  const d = loadDraft(draftId);
  const s = d.slides.find((x) => x.key === key) || fail('草稿中没有这一页');
  const file = path.join(draftSlideDir(draftId, key), 'slide.html');
  const before = fs.readFileSync(file, 'utf8');
  const pos = d.slides.indexOf(s) + 1;
  const { content, model } = await chat([
    { role: 'system', content: SYSTEM_REWRITE() },
    { role: 'user', content: `deck：${d.name}\n客户：${d.customer || '未指定'}\n主题：${d.theme === 'light' ? '白底' : '黑底'}\n这是第 ${pos} 页，当前 HTML：\n${before}\n\n改写要求：${instruction}` },
  ]);
  const html = (content.match(/<section\b[^>]*class=["'][^"']*\bslide\b[\s\S]*<\/section>/i) || [])[0];
  if (!html) fail('AI 没有返回有效的 <section class="slide">，请换个说法再试');
  if (/<script\b/i.test(html)) fail('AI 返回内容包含脚本，已拒绝');
  const backup = writeBackup(draftId, key, before);
  fs.writeFileSync(file, html.trim() + '\n');
  return recordEdit(d, s, { before, after: html, instruction, model, backup });
}

function writeBackup(draftId, key, html) {
  const hd = histDir(draftId, key);
  fs.mkdirSync(hd, { recursive: true });
  const backup = path.join(hd, `${nowIso().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}.html`);
  fs.writeFileSync(backup, html);
  return backup;
}

/** Agent 直接改文件前先打检查点；改完用 logAgentEdit 记录（同样可撤销） */
export function checkpoint(draftId, key) {
  const d = loadDraft(draftId);
  d.slides.find((x) => x.key === key) || fail('草稿中没有这一页');
  const file = path.join(draftSlideDir(draftId, key), 'slide.html');
  const backup = writeBackup(draftId, key, fs.readFileSync(file, 'utf8'));
  const s = d.slides.find((x) => x.key === key);
  s.checkpoint = path.relative(path.join(draftSlideDir(draftId, key), '..', '..'), backup).split(path.sep).join('/');
  saveDraft(d);
  return { html_file: file, checkpoint: s.checkpoint, next: `修改 ${file} 后运行：psl draft log-edit ${draftId} ${key} --instruction "改写要求" --by "<Agent 名称>"` };
}

export function logAgentEdit(draftId, key, instruction, by = 'agent') {
  if (!instruction?.trim()) fail('请用 --instruction 写明这次改写的要求');
  const d = loadDraft(draftId);
  const s = d.slides.find((x) => x.key === key) || fail('草稿中没有这一页');
  if (!s.checkpoint) fail(`没有检查点：请先运行 psl draft checkpoint ${draftId} ${key} 再修改文件`);
  const root = path.join(draftSlideDir(draftId, key), '..', '..');
  const before = fs.readFileSync(path.join(root, s.checkpoint), 'utf8');
  const after = fs.readFileSync(path.join(draftSlideDir(draftId, key), 'slide.html'), 'utf8');
  if (before === after) fail('页面没有变化，无需记录');
  const backup = path.join(root, s.checkpoint);
  delete s.checkpoint;
  return recordEdit(d, s, { before, after, instruction, model: `agent:${by}`, backup });
}

function recordEdit(d, s, { before, after, instruction, model, backup }) {
  const draftId = d.id, key = s.key, html = after;
  const pos = d.slides.indexOf(s) + 1;
  const ts = nowIso();
  const record = {
    ts, user: identity().display, instruction: instruction.trim(), model,
    before_title: htmlTitle(before), after_title: htmlTitle(html),
    before_hash: sha(before).slice(0, 12), after_hash: sha(html).slice(0, 12),
    changes: lineDiff(htmlToText(before), htmlToText(html)),
    backup: path.relative(path.join(draftSlideDir(draftId, key), '..', '..'), backup).split(path.sep).join('/'),
  };
  s.ai_edits = [...(s.ai_edits || []), record];
  saveDraft(d);
  const { file: ev } = appendEvent('ai_edit', {
    draft_id: draftId, deck_name: d.name, customer: d.customer, key, pos, source_id: s.source_id,
    instruction: record.instruction, model, before_title: record.before_title, after_title: record.after_title,
    before_hash: record.before_hash, after_hash: record.after_hash, changes: record.changes,
  });
  const git = commitAndPush([rel(ev)], `[AI改写] ${d.name} 第 ${pos} 页：${record.instruction.slice(0, 40)} by ${identity().name}`);
  return { record, git, slide: { ...s, ...slideState(d, s) } };
}

/** 撤销最近一次 AI 改写 */
export function undoAiEdit(draftId, key) {
  const d = loadDraft(draftId);
  const s = d.slides.find((x) => x.key === key) || fail('草稿中没有这一页');
  const last = s.ai_edits?.at(-1) || fail('这一页没有可撤销的 AI 改写');
  const backup = path.join(draftSlideDir(draftId, key), '..', '..', last.backup);
  fs.copyFileSync(backup, path.join(draftSlideDir(draftId, key), 'slide.html'));
  s.ai_edits = s.ai_edits.slice(0, -1);
  s.ai_undone = [...(s.ai_undone || []), { ...last, undone_at: nowIso() }];
  saveDraft(d);
  const pos = d.slides.indexOf(s) + 1;
  const { file: ev } = appendEvent('ai_undo', { draft_id: draftId, deck_name: d.name, customer: d.customer, key, pos, source_id: s.source_id, instruction: last.instruction });
  const git = commitAndPush([rel(ev)], `[撤销AI改写] ${d.name} 第 ${pos} 页 by ${identity().name}`);
  return { git, slide: { ...s, ...slideState(d, s) } };
}

/** AI 自动打标：每批 8 页；结果标记 tag_source=ai，等待人工确认 */
export async function autoTag(ids) {
  const tax = loadTaxonomy();
  const dims = tax.dimensions.map((d) => `- ${d.key}：${d.values.join('、')}`).join('\n');
  const done = [];
  for (let i = 0; i < ids.length; i += 8) {
    const batch = ids.slice(i, i + 8).map((id) => getSlide(id));
    const { content } = await chat([
      { role: 'system', content: `你是银行数智化售前素材库的管理员，负责给幻灯片打标签。标签维度与可选值：\n${dims}\n
规则：每个维度选 0–3 个最贴切的值，优先使用已有值，确有必要才新增；出现具体客户名称或客户专属数据的页面，customer 填客户名、scope 为 "customer-specific"，否则 customer 为空、scope 为 "universal"。
只输出 JSON：{"<页面id>": {"tags": {"维度": ["值"]}, "customer": "", "scope": "universal"}}` },
      { role: 'user', content: batch.map((s) => `### ${s.id}\n来源：${s.deck_title || ''}\n标题：${s.title}\n全文：${(s.text || '').slice(0, 1200)}`).join('\n\n') },
    ], { temperature: 0.1 });
    const res = extractJson(content);
    for (const s of batch) {
      const p = res[s.id];
      if (!p) continue;
      const tags = Object.fromEntries(Object.entries(p.tags || {}).filter(([k]) => tax.dimensions.some((d) => d.key === k)));
      const meta = applyTags(s.id, { tags, customer: p.customer || '', scope: p.scope === 'customer-specific' ? 'customer-specific' : 'universal', tag_source: 'ai' });
      done.push({ id: meta.id, title: meta.title, tags: meta.tags, customer: meta.customer, scope: meta.scope });
    }
  }
  if (done.length) {
    const { file } = appendEvent('tag_edit', { slide_ids: done.map((x) => x.id), by: 'ai' });
    commitAndPush([rel(LIB), rel(file)], `[AI打标] ${done.length} 页 by ${identity().name}`);
  }
  return done;
}
