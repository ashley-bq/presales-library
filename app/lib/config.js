import fs from 'node:fs';
import path from 'node:path';
import { PRIVATE } from './paths.js';
import { readJson, writeJson } from './util.js';

const FILE = path.join(PRIVATE, 'config.json');

/** 私有配置（不进仓库）：.private/config.json，环境变量优先 */
export function loadConfig() {
  const c = readJson(FILE, {});
  const llm = c.llm || {};
  return {
    llm: {
      base_url: process.env.PSL_LLM_BASE_URL || llm.base_url || '',
      api_key: process.env.PSL_LLM_API_KEY || llm.api_key || '',
      model: process.env.PSL_LLM_MODEL || llm.model || '',
    },
  };
}

export function saveConfig(patch) {
  const c = readJson(FILE, {});
  for (const [k, v] of Object.entries(patch)) c[k] = { ...(c[k] || {}), ...v };
  writeJson(FILE, c);
  try { fs.chmodSync(FILE, 0o600); } catch {}
  return FILE;
}

export const llmEnabled = () => { const { llm } = loadConfig(); return !!(llm.base_url && llm.api_key && llm.model); };
