import { chat, extractJson } from './llm.js';
import { llmEnabled } from './config.js';

/** 上传旧材料时默认不入库的页面类型 */
export const SKIP_KINDS = { cover: '封面', toc: '目录', back: '封底', people: '人员介绍' };

// 注意：\b 对中文不起作用，这里用 (?![a-z]) 防止 "contents" 误配 "contentsxx" 之类
const TOC = /^\s*(目\s*录|contents?|agenda|议\s*程|大\s*纲|提\s*纲|汇报提纲|目次)(?![a-z])/i;
const BACK = /(谢谢|感谢(聆听|观看|您的)|thank\s*you|thanks|联系我们|contact\s*us|boilerplate|q\s*&\s*a|敬请指正|欢迎交流|^\s*end\s*$)/i;
const PEOPLE_TITLE = /(参会人员|与会人员|出席人员|团队介绍|项目团队|团队成员|核心团队|服务团队|人员介绍|专家介绍|顾问介绍|讲师介绍|嘉宾介绍|个人简介|汇报人|主讲人|联系人)/;
const JOB = /(经理|总监|合伙人|顾问|总经理|副总裁|首席|主任|董事|专家|分析师)/g;
const CONTACT = /(1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}|\+86|[\w.-]+@[\w-]+\.[\w.]+)/;

/** 规则判定：pages [{title, text}] → [kind|null]；strongOnly 时只保留几乎不会误判的规则 */
export function ruleClassify(pages, { strongOnly = false } = {}) {
  const n = pages.length;
  return pages.map((p, i) => {
    const title = (p.title || '').trim();
    const text = (p.text || '').slice(0, 600);
    if (TOC.test(title) || (!title && TOC.test(text))) return 'toc';
    if (i >= n - 3 && (BACK.test(title) || (text.length < 80 && BACK.test(text)))) return 'back';
    if (/boilerplate/i.test(title)) return 'back';
    if (strongOnly) return null;
    if (PEOPLE_TITLE.test(title)) return 'people';
    if (text.length < 500 && (text.match(JOB) || []).length >= 2 && CONTACT.test(text)) return 'people';
    if (i === 0 && n > 2 && text.length < 200) return 'cover';
    return null;
  });
}

/**
 * 判定每页是否为封面/封底/目录/人员介绍页。配置了模型时用 AI（并叠加强规则），否则用规则。
 * 返回 { kinds: [kind|null], by: 'ai'|'rule', error? }
 */
export async function classifyPages(pages) {
  if (pages.length <= 1) return { kinds: pages.map(() => null), by: 'rule' };
  if (!llmEnabled()) return { kinds: ruleClassify(pages), by: 'rule' };
  try {
    const list = pages.map((p, i) => `[${i + 1}] ${(p.title || '（无标题）').slice(0, 60)} | ${(p.text || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
    const { content } = await chat([
      { role: 'system', content: `你在整理银行售前 PPT，要从素材库里剔除没有复用价值的页面。逐页判断是否属于以下四类：
- cover：封面（deck 标题、客户名、日期、公司 logo 的首页）
- toc：目录 / 议程 / 汇报提纲
- back：封底（谢谢、Q&A、联系我们、公司简介 boilerplate、免责声明）
- people：人员介绍（参会人员、团队成员、讲师/专家简介、联系人名片）
只判这四类，宁可漏判也不要误判：章节过渡页、方法论、案例、数据、产品介绍、讨论问题页都不属于这四类。
只输出 JSON：{"skip":[{"page":页码,"kind":"cover|toc|back|people"}]}` },
      { role: 'user', content: list },
    ], { temperature: 0, timeoutMs: 90000 });
    const kinds = pages.map(() => null);
    for (const x of extractJson(content).skip || []) {
      const i = Number(x.page) - 1;
      if (kinds[i] === null && SKIP_KINDS[x.kind]) kinds[i] = x.kind;
    }
    ruleClassify(pages, { strongOnly: true }).forEach((k, i) => { if (k && !kinds[i]) kinds[i] = k; });
    return { kinds, by: 'ai' };
  } catch (e) {
    return { kinds: ruleClassify(pages), by: 'rule', error: e.message };
  }
}

/** 过滤页面：返回 { keep, skipped: [{page, kind, label, title}] }；全被判掉时一页不删 */
export async function dropBoilerplate(pages, job) {
  job?.step('识别封面 / 封底 / 目录 / 人员介绍页');
  const { kinds, by, error } = await classifyPages(pages);
  const skipped = [];
  const keep = pages.filter((p, i) => {
    if (!kinds[i]) return true;
    skipped.push({ page: p.page ?? i + 1, kind: kinds[i], label: SKIP_KINDS[kinds[i]], title: p.title || '' });
    return false;
  });
  if (!keep.length) return { keep: pages, skipped: [], by, error };
  return { keep, skipped, by, error };
}
