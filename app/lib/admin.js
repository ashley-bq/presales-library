import fs from 'node:fs';
import path from 'node:path';
import { getSlide, slideDir, listDecks, listSlides, saveDeck } from './library.js';
import { appendEvent } from './events.js';
import { commitAndPush, pull } from './git.js';
import { identity, requireAdmin } from './identity.js';
import { fail } from './util.js';
import { rel, SLIDES, DECKS } from './paths.js';

/**
 * 管理员删除素材页：从 library/slides 移除、从所属 deck 中摘掉（deck 空了就删掉），记一条 delete 事件。
 * 删除可通过 git 历史找回；被删页的微调版本保留（parent_id 指向已删页）。
 */
export function deleteSlides(ids, { reason = '' } = {}) {
  requireAdmin();
  ids = [...new Set(ids)];
  if (!ids.length) fail('请选择要删除的页面');
  for (const id of ids) if (!/^[\w-][\w.-]*$/.test(id) || id.includes('..')) fail(`页面 id 不合法：${id}`);
  pull();
  const metas = ids.map((id) => getSlide(id) || fail(`没有这一页：${id}`));
  const removed = new Set(ids);
  const decksTouched = [];
  for (const d of listDecks()) {
    if (!d.slides.some((id) => removed.has(id))) continue;
    d.slides = d.slides.filter((id) => !removed.has(id));
    if (d.slides.length) saveDeck(d); else fs.rmSync(path.join(DECKS, `${d.id}.json`), { force: true });
    decksTouched.push({ id: d.id, title: d.title, remaining: d.slides.length });
  }
  const children = listSlides().filter((s) => removed.has(s.parent_id) && !removed.has(s.id)).map((s) => s.id);
  for (const id of ids) fs.rmSync(slideDir(id), { recursive: true, force: true });
  const { file } = appendEvent('delete', {
    slide_ids: ids, reason,
    slides: metas.map((m) => ({ id: m.id, title: m.title, deck_title: m.deck_title || '', origin: m.origin, source: m.source })),
  });
  const title = metas.length === 1 ? `「${metas[0].title.slice(0, 30)}」` : `${metas.length} 页`;
  const git = commitAndPush([rel(SLIDES), rel(DECKS), rel(file)], `[删除] ${title}${reason ? `：${reason.slice(0, 40)}` : ''} by ${identity().name}`);
  return { deleted: metas.map((m) => ({ id: m.id, title: m.title })), decks: decksTouched, orphaned_children: children, git };
}
