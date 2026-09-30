/**
 * OpenAI 兼容 TTS：POST {baseURL}/audio/speech
 * 请求体 {model, input, voice, response_format:"mp3"}，返回音频二进制。
 */

export interface OpenaiTtsConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  /**
   * SiliconFlow CosyVoice 系模型的情感/语气指令格式：
   * "指令<|endofprompt|>台词"。仅对支持该语法的端点开启。
   */
  styleInstruction?: string;
}

export function buildSpeechUrl(baseURL: string): string {
  let base = baseURL.trim().replace(/\/+$/, '');
  if (base.endsWith('#')) return base.slice(0, -1);
  if (/\/audio\/speech$/.test(base)) return base;
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  let path = '';
  try {
    path = new URL(base).pathname.replace(/\/+$/, '');
  } catch {
    throw new Error(`TTS BaseURL 格式不正确：${baseURL}`);
  }
  // 只有域名时按 OpenAI 惯例补 /v1
  if (path === '') return base + '/v1/audio/speech';
  return base + '/audio/speech';
}

export async function openaiTts(
  cfg: OpenaiTtsConfig,
  text: string,
  voice: string,
  opts: { timeoutMs?: number } = {},
): Promise<Buffer> {
  if (!cfg.baseURL) throw new Error('尚未配置 TTS 接口地址，请到"设置"页配置');
  if (!cfg.model) throw new Error('尚未配置 TTS 模型名称，请到"设置"页配置');
  if (!cfg.apiKey) throw new Error('尚未配置 TTS 接口密钥，请到"设置"页配置');
  if (!voice) throw new Error('尚未配置音色，请到"设置"页配置');

  const url = buildSpeechUrl(cfg.baseURL);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        // SiliconFlow 情感指令：语气描述在前，<|endofprompt|> 分隔，台词在后
        input: cfg.styleInstruction ? `${cfg.styleInstruction}<|endofprompt|>${text}` : text,
        voice,
        response_format: 'mp3',
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(/aborted|timeout/i.test(msg)
      ? 'TTS 请求超时，请检查接口地址或稍后重试'
      : `无法连接 TTS 接口：${msg}`);
  }
  if (!resp.ok) {
    const t = (await resp.text().catch(() => '')).slice(0, 400);
    throw new Error(`TTS 接口返回 HTTP ${resp.status}：${t || '(无响应体)'}`);
  }
  const ab = await resp.arrayBuffer();
  if (ab.byteLength < 200) throw new Error('TTS 接口返回的音频过短，请检查模型与音色配置');
  return Buffer.from(ab);
}
