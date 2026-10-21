import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 代码目录（app/、bin/、node_modules/、skill） */
export const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** 数据目录：一个 presales-library 仓库的 clone。本地模式就是代码目录本身；服务器模式可用 PSL_DATA_DIR 指定 */
export const ROOT = path.resolve(process.env.PSL_DATA_DIR || CODE_ROOT);

export const LIB = path.join(ROOT, 'library');
export const SLIDES = path.join(LIB, 'slides');
export const DECKS = path.join(LIB, 'decks');
export const THEMES = path.join(LIB, 'themes');
export const TEMPLATES = path.join(LIB, 'templates');
export const TAXONOMY = path.join(LIB, 'taxonomy.yaml');
export const EVENTS = path.join(ROOT, 'events');
export const DRAFTS = path.join(ROOT, 'drafts');
export const EXPORTS = path.join(ROOT, 'exports');
export const CACHE = path.join(ROOT, '.cache');
export const UPLOADS = path.join(CACHE, 'uploads');
/** 服务器私有数据（账号、会话密钥），不进仓库 */
export const PRIVATE = path.resolve(process.env.PSL_PRIVATE_DIR || path.join(ROOT, '.private'));
export const PUBLIC = path.join(CODE_ROOT, 'app', 'public');
export const SKILL_DIR = path.join(CODE_ROOT, '.devin', 'skills', 'presales-library');
export const NODE_MODULES = path.join(CODE_ROOT, 'node_modules');

export const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
