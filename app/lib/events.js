import fs from 'node:fs';
import path from 'node:path';
import { EVENTS } from './paths.js';
import { identity } from './identity.js';
import { nowIso } from './util.js';

export function appendEvent(type, data) {
  const me = identity();
  const ts = nowIso();
  const file = path.join(EVENTS, me.slug, `${ts.slice(0, 7)}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const event = { type, ts, user: me.display, user_slug: me.slug, ...data };
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
  return { event, file };
}

export function readEvents() {
  if (!fs.existsSync(EVENTS)) return [];
  const out = [];
  for (const user of fs.readdirSync(EVENTS)) {
    const dir = path.join(EVENTS, user);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch {}
      }
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}
