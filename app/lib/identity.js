import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ROOT, LIB } from './paths.js';
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

/** 素材库管理员（可删除页面）：library/admins.json 里的邮箱，或服务器模式下 role=admin 的账号 */
export function adminEmails() {
  try { return JSON.parse(fs.readFileSync(path.join(LIB, 'admins.json'), 'utf8')).admins.map((e) => e.toLowerCase()); } catch { return []; }
}
const withAdmin = (id, role) => ({ ...id, admin: role === 'admin' || (!!id.email && adminEmails().includes(id.email.toLowerCase())) });

let cached;
export function identity({ required = true } = {}) {
  const u = requestUser.getStore();
  if (u) return withAdmin(makeIdentity(u.name, u.email), u.role);
  cached ||= makeIdentity(cfg('user.name'), cfg('user.email'));
  if (required && (!cached.name || !cached.email)) {
    fail('未设置 Git 身份。请先执行：git config --global user.name "你的名字" && git config --global user.email "你的邮箱"');
  }
  return withAdmin(cached);
}

export function requireAdmin() {
  const me = identity();
  if (!me.admin) fail(`只有素材库管理员可以执行此操作（管理员名单见 library/admins.json，当前：${me.name}）`);
  return me;
}
