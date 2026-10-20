import { execFileSync } from 'node:child_process';
import { ROOT } from './paths.js';

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const errText = (e) => (e.stderr?.toString() || e.message || '').trim();

export const hasRemote = () => { try { return !!git(['remote', 'get-url', 'origin']); } catch { return false; } };
const branch = () => git(['rev-parse', '--abbrev-ref', 'HEAD']);
const hasCommits = () => { try { git(['rev-parse', 'HEAD']); return true; } catch { return false; } };

export const status = { lastPull: null, lastPush: null, error: null };

export function pull() {
  if (!hasRemote() || !hasCommits()) return { ok: true, skipped: true };
  try {
    git(['fetch', '-q', 'origin']);
    const b = branch();
    try { git(['rev-parse', '--verify', '-q', `origin/${b}`]); } catch { return { ok: true, skipped: true }; }
    git(['rebase', '-q', '--autostash', `origin/${b}`]);
    status.lastPull = new Date().toISOString();
    status.error = null;
    return { ok: true };
  } catch (e) {
    try { git(['rebase', '--abort']); } catch {}
    status.error = errText(e);
    return { ok: false, error: status.error };
  }
}

function push() {
  git(['push', '-q', '-u', 'origin', 'HEAD']);
  status.lastPush = new Date().toISOString();
}

export function commitAndPush(paths, message) {
  git(['add', '-A', '--', ...paths]);
  try { git(['diff', '--cached', '--quiet']); return { committed: false, pushed: false }; } catch {}
  git(['commit', '-q', '-m', message]);
  if (!hasRemote()) return { committed: true, pushed: false, note: '未配置远程仓库，仅本地提交' };
  try {
    push();
  } catch {
    const p = pull();
    if (!p.ok) return { committed: true, pushed: false, error: `推送失败：${p.error}` };
    try { push(); } catch (e) { status.error = errText(e); return { committed: true, pushed: false, error: `推送失败：${status.error}` }; }
  }
  status.error = null;
  return { committed: true, pushed: true };
}

export function unpushedCount() {
  if (!hasRemote() || !hasCommits()) return 0;
  try { return Number(git(['rev-list', '--count', '@{u}..HEAD'])) || 0; } catch { return Number(git(['rev-list', '--count', 'HEAD'])) || 0; }
}

export function pushPending() {
  if (!hasRemote() || unpushedCount() === 0) return { ok: true, skipped: true };
  try { push(); return { ok: true }; } catch (e) { status.error = errText(e); return { ok: false, error: status.error }; }
}
