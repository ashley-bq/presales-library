import { execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ROOT } from './paths.js';
import { fail } from './util.js';

/** 服务器模式下，每个请求在这里放入登录用户 {name, email} */
export const requestUser = new AsyncLocalStorage();

const cfg = (key) => {
  try { return execFileSync('git', ['config', key], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; }
};

export function makeIdentity(name, email) {
  const slug = (email.split('@')[0] || name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
  return { name, email, slug, display: name ? `${name} <${email}>` : '' };
}

let cached;
export function identity({ required = true } = {}) {
  const u = requestUser.getStore();
  if (u) return makeIdentity(u.name, u.email);
  cached ||= makeIdentity(cfg('user.name'), cfg('user.email'));
  if (required && (!cached.name || !cached.email)) {
    fail('未设置 Git 身份。请先执行：git config --global user.name "你的名字" && git config --global user.email "你的邮箱"');
  }
  return cached;
}
