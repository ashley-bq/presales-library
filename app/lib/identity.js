import { execFileSync } from 'node:child_process';
import { ROOT } from './paths.js';
import { fail } from './util.js';

const cfg = (key) => {
  try { return execFileSync('git', ['config', key], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; }
};

let cached;
export function identity({ required = true } = {}) {
  if (!cached) {
    const name = cfg('user.name');
    const email = cfg('user.email');
    const slug = (email.split('@')[0] || name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
    cached = { name, email, slug, display: name ? `${name} <${email}>` : '' };
  }
  if (required && (!cached.name || !cached.email)) {
    fail('未设置 Git 身份。请先执行：git config --global user.name "你的名字" && git config --global user.email "你的邮箱"');
  }
  return cached;
}
