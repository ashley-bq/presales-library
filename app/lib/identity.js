import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
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

/** 素材库管理员（可删除页面）：服务器模式看登录账号 role=admin 或 library/admins.yaml 的 users；本地模式看 Git 邮箱是否在 emails 中 */
export function isAdmin() {
  let conf = {};
  try { conf = YAML.parse(fs.readFileSync(path.join(LIB, 'admins.yaml'), 'utf8')) || {}; } catch {}
  const u = requestUser.getStore();
  if (u) return u.role === 'admin' || (conf.users || []).includes(u.username);
  const email = identity({ required: false }).email?.toLowerCase();
  return !!email && (conf.emails || []).some((e) => String(e).toLowerCase() === email);
}
