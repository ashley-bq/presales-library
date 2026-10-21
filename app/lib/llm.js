import { loadConfig, llmEnabled } from './config.js';
import { fail } from './util.js';

/** 调用 OpenAI 兼容的 /chat/completions 接口（DeepSeek、通义、豆包、OpenAI 等） */
export async function chat(messages, { temperature = 0.4, timeoutMs = 120000 } = {}) {
  if (!llmEnabled()) fail('尚未配置 AI 模型：请运行 psl config llm --base-url <接口地址> --api-key <Key> --model <模型名>，或设置环境变量 PSL_LLM_BASE_URL / PSL_LLM_API_KEY / PSL_LLM_MODEL');
  const { llm } = loadConfig();
  const url = llm.base_url.replace(/\/+$/, '') + (/\/chat\/completions$/.test(llm.base_url) ? '' : '/chat/completions');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${llm.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: llm.model, messages, temperature }),
    });
    const text = await r.text();
    if (!r.ok) fail(`AI 接口返回 ${r.status}：${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    const content = j.choices?.[0]?.message?.content;
    if (!content) fail(`AI 接口没有返回内容：${text.slice(0, 300)}`);
    return { content, model: j.model || llm.model };
  } catch (e) {
    if (e.name === 'AbortError') fail('AI 接口超时，请稍后重试');
    throw e;
  } finally { clearTimeout(timer); }
}

/** 从模型输出里提取 JSON 对象 */
export function extractJson(s) {
  const body = (s.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1] || s;
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end < start) fail('AI 返回的不是 JSON');
  return JSON.parse(body.slice(start, end + 1));
}
