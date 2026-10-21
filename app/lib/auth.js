import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PRIVATE } from './paths.js';
import { readJson, writeJson, fail } from './util.js';

const USERS = path.join(PRIVATE, 'users.json');
const SECRET = path.join(PRIVATE, 'session-secret');
const SESSION_DAYS = 14;

const loadUsers = () => readJson(USERS, { users: [] });
const saveUsers = (u) => { writeJson(USERS, u); try { fs.chmodSync(USERS, 0o600); } catch {} };
const hash = (password, salt) => crypto.scryptSync(password, salt, 32).toString('hex');

function secret() {
  if (!fs.existsSync(SECRET)) {
    fs.mkdirSync(PRIVATE, { recursive: true });
    fs.writeFileSync(SECRET, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(SECRET, 'utf8').trim();
}

const publicUser = ({ username, name, email, role }) => ({ username, name, email, role });

export function listUsers() { return loadUsers().users.map(publicUser); }

export function addUser({ username, name, email, password, role = 'member' }) {
  if (!/^[a-z0-9_-]{2,32}$/i.test(username || '')) fail('用户名只能包含字母、数字、_ -，2–32 位');
  if (!name || !email) fail('需要 --name 和 --email');
  const u = loadUsers();
  if (u.users.some((x) => x.username === username)) fail(`用户已存在：${username}`);
  const pw = password || crypto.randomBytes(6).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  u.users.push({ username, name, email, role, salt, hash: hash(pw, salt), created_at: new Date().toISOString() });
  saveUsers(u);
  return { user: publicUser(u.users.at(-1)), password: password ? '(已按你提供的设置)' : pw };
}

export function setPassword(username, password) {
  const u = loadUsers();
  const x = u.users.find((y) => y.username === username) || fail(`没有这个用户：${username}`);
  const pw = password || crypto.randomBytes(6).toString('base64url');
  x.salt = crypto.randomBytes(16).toString('hex');
  x.hash = hash(pw, x.salt);
  x.token_version = (x.token_version || 0) + 1; // 让旧会话失效
  saveUsers(u);
  return { username, password: password ? '(已按你提供的设置)' : pw };
}

export function removeUser(username) {
  const u = loadUsers();
  const before = u.users.length;
  u.users = u.users.filter((x) => x.username !== username);
  if (u.users.length === before) fail(`没有这个用户：${username}`);
  saveUsers(u);
  return { removed: username };
}

export function login(username, password) {
  const x = loadUsers().users.find((y) => y.username === username);
  const ok = x && crypto.timingSafeEqual(Buffer.from(hash(String(password || ''), x.salt), 'hex'), Buffer.from(x.hash, 'hex'));
  if (!ok) fail('用户名或密码错误');
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${x.username}.${exp}.${x.token_version || 0}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return { token: `${Buffer.from(payload).toString('base64url')}.${sig}`, maxAge: SESSION_DAYS * 86400, user: publicUser(x) };
}

export function verify(token) {
  if (!token) return null;
  const [p64, sig] = token.split('.');
  if (!p64 || !sig) return null;
  const payload = Buffer.from(p64, 'base64url').toString();
  const expect = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  const [username, exp, ver] = payload.split('.');
  if (Number(exp) < Date.now()) return null;
  const x = loadUsers().users.find((y) => y.username === username);
  if (!x || String(x.token_version || 0) !== ver) return null;
  return publicUser(x);
}

export const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
