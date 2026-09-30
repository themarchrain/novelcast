import lamejs from '@breezystack/lamejs';
import { parseWav } from './wav.js';

/**
 * 本地 VoxCPM 语音服务（scripts/voxcpm_server.py）：
 * POST {baseURL}/tts  body {speaker:'male'|'female', text, timesteps?} -> WAV
 * 这里转码为 MP3 后进入统一管线（拼接/时长解析均基于 MP3）。
 */

export interface VoxcpmConfig {
  baseURL: string;
  /** 单次合成请求超时（本地长台词较慢，默认 10 分钟） */
  timeoutMs?: number;
}

export function normalizeVoxcpmBase(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '');
}

export async function voxcpmTts(
  cfg: VoxcpmConfig,
  text: string,
  speaker: 'male' | 'female',
  timesteps?: number,
): Promise<Buffer> {
  const base = normalizeVoxcpmBase(cfg.baseURL || 'http://127.0.0.1:18511');
  let res: Response;
  try {
    res = await fetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 600000),
      body: JSON.stringify({ speaker, text, ...(timesteps ? { timesteps } : {}) }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      /aborted|timeout/i.test(msg)
        ? '本地 VoxCPM 合成超时，可在设置中调低推理步数或改用云端合成'
        : `无法连接本地 VoxCPM 服务（${base}）：${msg}。请先启动 scripts/voxcpm_server.py（见设置页说明）`,
    );
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`VoxCPM 服务报错（HTTP ${res.status}）：${data?.error || '(无详情)'}`);
  }
  const wav = Buffer.from(await res.arrayBuffer());
  return wavToMp3(wav);
}

/** WAV(PCM16) -> MP3(128kbps CBR)，mono 直编，多声道取左声道 */
export function wavToMp3(wav: Buffer, kbps = 128): Buffer {
  const { pcm16, sampleRate, channels } = parseWav(wav);
  const mono =
    channels === 1
      ? pcm16
      : (() => {
          const m = new Int16Array(Math.floor(pcm16.length / channels));
          for (let i = 0; i < m.length; i++) m[i] = pcm16[i * channels];
          return m;
        })();

  const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
  const blockSize = 1152;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < mono.length; i += blockSize) {
    const chunk = mono.subarray(i, i + blockSize);
    const encoded = encoder.encodeBuffer(chunk);
    if (encoded.length > 0) parts.push(new Uint8Array(encoded));
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(new Uint8Array(tail));
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}
