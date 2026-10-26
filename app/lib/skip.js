/** 上传 PPT/PDF 时默认跳过的页：封面、封底、目录、人物信息介绍。规则只看文字，无文字的纯图页一律保留。 */

export const SKIP_LABELS = { cover: '封面', back: '封底', toc: '目录', person: '人物介绍' };

const BACK_RE = /(boilerplate|about ey|建设更美好的商业世界|联系我们|contact us)/i;
const THANKS_RE = /(谢\s*谢|感谢(您的)?(聆听|观看|关注|支持)|thank\s*you|thanks|Q\s*&\s*A)/i;
const TOC_LINE_RE = /^(目\s*录|contents?|agenda|议\s*程|提\s*纲|outline)$/i;
const PERSON_RE = /(参会人员|个人简介|人物介绍|讲师(介绍|简介)|专家(介绍|简介)|嘉宾(介绍|简介)|主讲人|演讲人|讲者介绍|作者简介|个人履历|顾问简介|[女先]士是|手机号码|电子邮箱)/;
const CONTACT_RE = /([\w.+-]+@[\w-]+\.[\w.]+|(\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4})/;

const compact = (s) => (s || '').replace(/\s+/g, '');
const tokens = (s) => new Set((s || '').replace(/\d+(\/\d+)*/g, ' ').split(/[\s|｜]+/).filter((t) => t.length >= 2));

function jaccard(a, b) {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / (a.size + b.size - n || 1);
}

/** pages: [{title, text}] → 每页的跳过原因（cover/back/toc/person）或 null */
export function skipReasons(pages) {
  const n = pages.length;
  const info = pages.map((p) => {
    const text = [p.title, p.text].filter(Boolean).join('\n');
    return { text, len: compact(text).length, lines: text.split(/\n+/).map((l) => l.trim()).filter(Boolean), toks: tokens(text) };
  });
  return info.map((x, i) => {
    if (!x.len) return null;
    if (i === 0 && x.len <= 250) return 'cover';
    if (PERSON_RE.test(x.text) || (CONTACT_RE.test(x.text) && x.len <= 1200)) return BACK_RE.test(x.text) && i >= n / 2 ? 'back' : 'person';
    if (BACK_RE.test(x.text) && i >= n / 2) return 'back';
    if (THANKS_RE.test(x.text) && x.len <= 60 && i >= n / 2) return 'back';
    if (x.len <= 400 && x.lines.some((l) => TOC_LINE_RE.test(l) || TOC_LINE_RE.test(l.split(/\s+/)[0]))) return 'toc';
    // 章节过渡页：同一份目录在 deck 里反复出现（只换高亮项/页码）
    if (x.len <= 400 && x.toks.size >= 5 && info.some((y, j) => j !== i && y.len <= 400 && y.toks.size >= 5 && jaccard(x.toks, y.toks) >= 0.7)) return 'toc';
    return null;
  });
}

/** 按规则拆分：{ keep:[page 带 page 序号], skipped:[{page,title,reason,label}] } */
export function splitPages(pages) {
  const reasons = skipReasons(pages);
  const keep = [], skipped = [];
  pages.forEach((p, i) => {
    const pg = { ...p, page: p.page ?? i + 1 };
    if (reasons[i]) skipped.push({ page: pg.page, title: p.title || '', reason: reasons[i], label: SKIP_LABELS[reasons[i]] });
    else keep.push(pg);
  });
  return { keep, skipped };
}
