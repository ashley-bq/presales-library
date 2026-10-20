import fs from 'node:fs';
import path from 'node:path';
import { getDraft, draftSlideDir, markDraft } from './drafts.js';
import { createSlide, newSlideId, getSlide, emptyTags, saveDeck, saveMeta, slideDir } from './library.js';
import { renderThumbs } from './ingest.js';
import { appendEvent } from './events.js';
import { commitAndPush, pull } from './git.js';
import { identity } from './identity.js';
import { listFiles, asciiSlug, shortId, today, nowIso, contentHash } from './util.js';
import { rel, SLIDES, DECKS } from './paths.js';

/**
 * 讲完效果好，再入库：草稿中改过的页 → 新的"微调"页（parent_id 指向来源页）；新建的页 → 原创页。
 * 未修改的页只在 deck 记录中引用原页。keys 可只挑部分页。
 */
export async function promoteDraft(id, { keys, note = '' } = {}) {
  pull();
  const d = getDraft(id);
  const me = identity();
  const picked = d.slides.filter((s) => s.modified && (!keys || keys.includes(s.key)));
  const deckId = `${today()}-${asciiSlug(d.name, 'deck')}-${shortId()}`;
  const created = [];
  const mapping = {};
  for (const [i, s] of picked.entries()) {
    const dir = draftSlideDir(id, s.key);
    const parent = s.source_id ? getSlide(s.source_id) : null;
    const prefix = parent ? parent.id.replace(/-\d{2}-[0-9a-f]{4}$/, '') : asciiSlug(d.name, 'deck');
    const html = fs.readFileSync(path.join(dir, 'slide.html'), 'utf8');
    const files = listFiles(dir).filter((f) => f !== 'slide.html').map((f) => ({ name: f, src: path.join(dir, f) }));
    const meta = createSlide({
      id: newSlideId(prefix, parent?.source?.page || i + 1), html, files,
      meta: {
        tags: parent ? structuredClone(parent.tags) : emptyTags(),
        customer: d.customer || parent?.customer || '',
        scope: d.customer ? 'customer-specific' : (parent?.scope || 'universal'),
        origin: parent ? 'derived' : 'original',
        parent_id: parent?.id || null,
        root_id: parent?.root_id || null,
        theme: d.theme,
        tagged: !!parent,
        source: { format: parent?.source?.format === 'pptx' ? 'pptx' : 'html', deck_id: deckId, draft_id: id, page: d.slides.indexOf(d.slides.find((x) => x.key === s.key)) + 1 },
        deck_title: d.name,
        modification: parent ? { diff: s.diff, note } : null,
        ...(parent?.source?.format === 'pptx' ? { text: parent.text } : {}),
      },
    });
    if (!meta.root_id) { meta.root_id = meta.id; }
    meta.content_hash = contentHash(slideDir(meta.id));
    saveMeta(meta);
    created.push(meta);
    mapping[s.key] = meta.id;
  }
  if (!created.length) return { created: [], message: '没有修改过的页，无需入库' };
  await renderThumbs(created.map((m) => m.id));
  saveDeck({
    id: deckId, title: d.name, customer: d.customer, format: 'draft', draft_id: id,
    slides: d.slides.map((s) => mapping[s.key] || s.source_id).filter(Boolean),
    author: me.display, created_at: nowIso(), note,
  });
  const { file } = appendEvent('promote', {
    draft_id: id, deck_id: deckId, deck_name: d.name, customer: d.customer, note,
    slides: created.map((m) => ({ id: m.id, parent_id: m.parent_id, origin: m.origin })),
  });
  const git = commitAndPush([rel(SLIDES), rel(DECKS), rel(file)], `[再入库] ${d.name}：${created.length} 页（微调 ${created.filter((m) => m.origin === 'derived').length}）by ${me.name}`);
  markDraft(id, { promoted_at: nowIso() });
  return {
    deck_id: deckId, git,
    created: created.map((m) => ({ id: m.id, title: m.title, origin: m.origin, parent_id: m.parent_id, tagged: m.tagged })),
  };
}
