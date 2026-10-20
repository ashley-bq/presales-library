import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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
export const PUBLIC = path.join(ROOT, 'app', 'public');
export const SKILL_DIR = path.join(ROOT, '.devin', 'skills', 'presales-library');

export const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
