/**
 * OpenAI 通用格式（/chat/completions）兼容客户端。
 * baseURL 约定：填到 /v1 这一级即可，自动补全路径；以 # 结尾表示用原样完整地址。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  jsonMode: boolean;
  temperature: number;
}

export class LlmError extends Error {}

export function buildChatUrl(baseURL: string): string {
  let base = baseURL.trim().replace(/\/+$/, '');
  if (base.endsWith('#')) return base.slice(0, -1);
  if (/\/chat\/completions$/.test(base)) return base;
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  let path = '';
  try {
    path = new URL(base).pathname.replace(/\/+$/, '');
  } catch {
    throw new LlmError(`BaseURL 格式不正确：${baseURL}`);
  }
  // 无路径（只有域名）时按 OpenAI 惯例补 /v1；其余情况直接补端点
  if (path === '') return base + '/v1/chat/completions';
  return base + '/chat/completions';
}

interface ChatOpts {
  timeoutMs?: number;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export async function chat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts: ChatOpts = {},
): Promise<string> {
  if (!cfg.baseURL) throw new LlmError('尚未配置 AI 接口地址（BaseURL），请先到"设置"页配置');
  if (!cfg.apiKey) throw new LlmError('尚未配置 AI 接口密钥（API Key），请先到"设置"页配置');
  if (!cfg.model) throw new LlmError('尚未配置模型名称，请先到"设置"页配置');

  const url = buildChatUrl(cfg.baseURL);
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream: false,
    temperature: opts.temperature ?? cfg.temperature ?? 0.8,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  const jsonMode = opts.jsonMode ?? cfg.jsonMode;
  if (jsonMode) body.response_format = { type: 'json_object' };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/aborted|timeout/i.test(msg)) throw new LlmError('AI 接口请求超时，请检查接口地址或稍后重试');
    throw new LlmError(`无法连接 AI 接口：${msg}`);
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 500);
    throw new LlmError(`AI 接口返回 HTTP ${res.status}：${text || '(无响应体)'}`);
  }

  let data: {
    choices?: { message?: { content?: string | null } }[];
    error?: { message?: string };
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new LlmError('AI 接口返回的不是 JSON，请确认地址是 OpenAI 兼容的 /chat/completions 端点');
  }
  if (data.error?.message) throw new LlmError(`AI 接口报错：${data.error.message}`);
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmError('AI 接口返回内容为空');
  }
  return content;
}

/** 从 LLM 返回文本中稳健地抠出 JSON 对象 */
export function extractJsonObject(content: string): Record<string, unknown> {
  let text = content.trim();
  // 去掉 ```json ... ``` 围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // 直接尝试
  const tries: string[] = [text];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) tries.push(text.slice(first, last + 1));
  for (const t of tries) {
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
    } catch {
      // 尝试修复尾逗号
      try {
        const fixed = t.replace(/,\s*([}\]])/g, '$1');
        const obj = JSON.parse(fixed);
        if (obj && typeof obj === 'object') return obj as Record<string, unknown>;
      } catch {
        // 下一个候选
      }
    }
  }
  throw new LlmError('AI 返回的内容无法解析为 JSON 脚本，请更换模型或重试');
}
