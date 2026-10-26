import { buildIndex, filterSlides } from './indexer.js';
import { chat, extractJson } from './llm.js';
import { llmEnabled } from './config.js';
import { fail } from './util.js';

const PER_SECTION = 14;
const brief1 = (s) => `${s.id} | ${s.title.slice(0, 50)} | ${s.deck_title || ''} | ${Object.values(s.tags || {}).flat().join('、')}${s.customer ? ` | 客户:${s.customer}` : ''} | 用过${s.usage?.exports || 0}次 | ${(s.text || '').replace(/\s+/g, ' ').slice(0, 110)}`;

/** 每章的候选页：各关键词分别检索 + 合并检索，按命中次数和得分排序 */
function candidates(index, keywords, used) {
  const score = new Map();
  const add = (list, w) => list.slice(0, 10).forEach((s, i) => score.set(s.id, (score.get(s.id) || 0) + w * (10 - i)));
  add(filterSlides(index, { q: keywords.join(' ') }), 2);
  for (const k of keywords) add(filterSlides(index, { q: k }), 1);
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => index.byId[id]).filter((s) => s && !used.has(s.id)).slice(0, PER_SECTION);
}

/** 没有配置模型时：每行/每句当作一章，按关键词检索取前几页 */
function fallback(index, brief, pages) {
  const parts = brief.split(/[\n。；;，,]+/).map((x) => x.trim().replace(/^(首先|先|再|然后|接着|之后|最后|其次|并且|同时)?\s*(讲|介绍|说明|分享|展示|聊)?/, '').trim()).filter((x) => x.length > 1).slice(0, 12);
  const per = Math.max(1, Math.round((pages || parts.length * 2) / Math.max(1, parts.length)));
  const used = new Set();
  const sections = parts.map((p) => {
    // 中文长词再切成两字词，便于子串检索（"客群分层经营" → 客群 / 分层 / 经营）
    const kw = p.split(/[\s、：:（）()和与及的给讲]+/).filter((w) => w.length >= 2)
      .flatMap((w) => w.length >= 4 && /^[\u4e00-\u9fa5]+$/.test(w) ? w.match(/../g) : [w]);
    const c = candidates(index, kw.length ? kw : [p], used);
    const picks = c.slice(0, per);
    picks.forEach((s) => used.add(s.id));
    return { title: p.slice(0, 30), goal: p, picks: picks.map((s) => ({ id: s.id, reason: '关键词匹配' })), alternatives: c.slice(per, per + 4).map((s) => s.id), gap: picks.length ? '' : '库里没有匹配的页面，建议新做' };
  });
  return { title: '', sections, by: 'keyword', note: '未配置 AI 模型，按关键词匹配给出初稿；配置模型后可按 storyline 智能拆解' };
}

/**
 * 按 storyline / 需求推荐页面组合。
 * 1) AI 把需求拆成章节，每章给检索关键词；2) 每章在库里检索候选；3) AI 从候选里按叙事挑页并给理由，找不到的标为缺口。
 */
export async function suggestDeck({ brief, customer = '', pages = 0, index } = {}) {
  brief = String(brief || '').trim();
  if (brief.length < 4) fail('请输入 storyline 或需求描述');
  index ||= buildIndex();
  if (!index.slides.length) fail('素材库还是空的');
  if (!llmEnabled()) return fallback(index, brief, pages);

  const vocab = index.taxonomy.dimensions.map((d) => `- ${d.key}：${d.values.join('、')}`).join('\n');
  const { content: c1 } = await chat([
    { role: 'system', content: `你是银行数智化售前顾问，负责为客户汇报设计 deck 的 storyline。素材库标签体系：\n${vocab}\n
把用户的需求拆成按讲述顺序排列的章节（通常 4–8 章）。每章给出：标题、要讲清楚的要点、2–5 个检索关键词（中文短词，优先用上面的标签词和需求里的业务词）、建议页数（1–3）。
${pages ? `整个 deck 目标约 ${pages} 页。` : ''}只输出 JSON：{"title":"deck 标题","sections":[{"title":"","goal":"","keywords":[""],"pages":1}]}` },
    { role: 'user', content: `${customer ? `客户：${customer}\n` : ''}需求 / storyline：\n${brief}` },
  ], { temperature: 0.3 });
  const outline = extractJson(c1);
  const secs = (outline.sections || []).filter((s) => s?.title).slice(0, 12);
  if (!secs.length) fail('AI 没有拆出章节，请把需求写得更具体一些');

  const used = new Set();
  const cand = secs.map((s) => candidates(index, [...(s.keywords || []), s.title].filter(Boolean), new Set()));
  const catalog = secs.map((s, i) => `## 第${i + 1}章 ${s.title}（${s.goal || ''}；建议 ${s.pages || 1} 页）\n${cand[i].map(brief1).join('\n') || '（没有候选）'}`).join('\n\n');

  const { content: c2, model } = await chat([
    { role: 'system', content: `你是银行数智化售前顾问。下面是 deck 各章节以及从素材库检索到的候选页（格式：页面id | 标题 | 来源deck | 标签 | 客户 | 使用次数 | 摘要）。
为每章按讲述顺序挑选最合适的页面（数量参考建议页数），并用一句话说明为什么选它、在这一章里起什么作用。
规则：只能用候选里出现的页面 id；同一页不要在多章重复使用；内容几乎重复的页只选一页（优先用过次数多、更新的）；${customer ? `其他客户的专属页面（客户字段不是「${customer}」）尽量不用，确需借用时在理由里提醒"需改客户名/数据"；` : ''}没有合适页面时 picks 留空，并在 gap 里写建议新做什么页。
只输出 JSON：{"sections":[{"picks":[{"id":"","reason":""}],"gap":""}]}，sections 与章节一一对应。` },
    { role: 'user', content: `${customer ? `客户：${customer}\n` : ''}需求：${brief}\n\n${catalog}` },
  ], { temperature: 0.2 });
  const picked = extractJson(c2).sections || [];

  const sections = secs.map((s, i) => {
    const allowed = new Set(cand[i].map((x) => x.id));
    const picks = (picked[i]?.picks || []).filter((p) => p?.id && allowed.has(p.id) && !used.has(p.id));
    picks.forEach((p) => used.add(p.id));
    return {
      title: s.title, goal: s.goal || '', keywords: s.keywords || [],
      picks: picks.map((p) => ({ id: p.id, reason: String(p.reason || '') })),
      alternatives: cand[i].map((x) => x.id).filter((id) => !used.has(id)).slice(0, 6),
      gap: picked[i]?.gap || (picks.length ? '' : '库里没有合适的页面，建议新做'),
    };
  });
  return { title: outline.title || '', sections, by: 'ai', model, total: sections.reduce((n, s) => n + s.picks.length, 0) };
}
