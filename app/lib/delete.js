import fs from 'node:fs';
import path from 'node:path';
import { getSlide, slideDir, listDecks, listSlides, saveDeck } from './library.js';
import { appendEvent } from './events.js';
import { commitAndPush, pull } from './git.js';
import { identity, isAdmin } from './identity.js';
import { fail } from './util.js';
import { rel, SLIDES, DECKS } from './paths.js';

/** 删除前预览：要删的页、受影响的 deck、引用它的微调页 */
export function deletePlan(ids) {
  ids = [...new Set([].concat(ids || []).filter(Boolean))];
  if (!ids.length) fail('请选择要删除的页面');
  const slides = ids.map((id) => getSlide(id));
  const set = new Set(ids);
  const decks = listDecks().filter((d) => d.slides.some((x) => set.has(x)))
    .map((d) => ({ id: d.id, title: d.title, removed: d.slides.filter((x) => set.has(x)).length, left: d.slides.filter((x) => !set.has(x)).length }));
  const children = listSlides().filter((s) => set.has(s.parent_id) && !set.has(s.id)).map((s) => ({ id: s.id, title: s.title, parent_id: s.parent_id }));
  return { slides: slides.map((s) => ({ id: s.id, title: s.title, deck_title: s.deck_title || '' })), decks, children };
}

/** 管理员删除已入库页面：删页面目录、从 deck 中移除（空 deck 一并删除）、记录 slide_delete 事件并同步。微调页保留，parent_id 不变。 */
export function deleteSlides(ids, { reason = '' } = {}) {
  if (!isAdmin()) fail('只有素材库管理员可以删除页面（见 library/admins.yaml）');
  pull();
  const plan = deletePlan(ids);
  const set = new Set(plan.slides.map((s) => s.id));
  for (const id of set) fs.rmSync(slideDir(id), { recursive: true, force: true });
  for (const d of listDecks()) {
    const left = d.slides.filter((x) => !set.has(x));
    if (left.length === d.slides.length) continue;
    if (left.length) saveDeck({ ...d, slides: left });
    else fs.rmSync(path.join(DECKS, `${d.id}.json`), { force: true });
  }
  const { file } = appendEvent('slide_delete', { slides: plan.slides, decks: plan.decks, reason });
  const head = plan.slides[0].title.slice(0, 30);
  const git = commitAndPush([rel(SLIDES), rel(DECKS), rel(file)], `[删除] ${plan.slides.length === 1 ? head : `${head} 等 ${plan.slides.length} 页`} by ${identity().name}`);
  return { deleted: plan.slides, decks: plan.decks, children_kept: plan.children, git };
}
