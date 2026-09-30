import WebSocket from 'ws';
import { sha256Upper, sleep } from '../util.js';

/**
 * 微软 Edge 朗读（edge-tts）协议的自实现，免费、中文神经网络音色、语气自然。
 * 协议要点：
 *  - wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1
 *  - 需带 Sec-MS-GEC 时间窗签名（SHA256(5分钟取整的Windows纪元ticks + 受信token)）
 *  - 先发 speech.config，再发 SSML；音频在二进制帧（前2字节为头长）中
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
// 服务端拒绝过旧的版本号（130 返回 403），取较新的 Edge 版本
const CHROMIUM_FULL_VERSION = '140.0.3485.54';
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const BASE_WSS =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

export interface EdgeVoice {
  id: string;
  label: string;
  gender: 'male' | 'female';
}

/** 精选中文音色（已验证可用的神经网络音色） */
export const EDGE_VOICES: EdgeVoice[] = [
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男声，活泼自然（推荐）', gender: 'male' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男声，阳光浑厚', gender: 'male' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男声，专业播音', gender: 'male' },
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声，温暖自然（推荐）', gender: 'female' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声，活泼甜亮', gender: 'female' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '小贝 · 女声，东北口音', gender: 'female' },
];

/** Sec-MS-GEC 签名：Windows 纪元秒数向下取整到 5 分钟窗口 × 1e7，与 token 拼接后 SHA256 */
export function computeSecMsGec(nowMs = Date.now()): string {
  let ticks = Math.floor(nowMs / 1000) + 11644473600;
  ticks -= ticks % 300;
  ticks *= 10_000_000;
  return sha256Upper(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
}

function edgeUa(): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.').slice(0, 3).join('.')} Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`;
}

function dateHeader(): string {
  return (
    new Date().toUTCString().replace(/GMT$/, 'GMT+0000 (Coordinated Universal Time)')
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // 去掉 XML 非法控制字符
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/**
 * 注意：免费 readaloud 端点只接受纯文本 SSML —— 实测 <break>、
 * mstts:express-as 等都会被拒（"SSML is invalid"），高级韵律控制是
 * Azure 付费功能。语气表现交给台词文本本身（标点/语气词）。
 */
function buildSsml(text: string, voice: string): string {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name="${escapeXml(voice)}">${escapeXml(text)}</voice></speak>`
  );
}

/** 在句子边界处把文本切成 ≤ maxChars 的块（单条 SSML 不宜过长） */
function splitForSsml(text: string, maxChars = 800): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let cur = '';
  for (const sentence of text.split(/(?<=[。！？；!?;\n])/)) {
    if ((cur + sentence).length > maxChars) {
      if (cur) pieces.push(cur);
      cur = sentence;
    } else {
      cur += sentence;
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

/** 合成一段文本（可含多句），返回 MP3 Buffer */
export async function edgeTts(
  text: string,
  voice: string,
  opts: { timeoutMs?: number } = {},
): Promise<Buffer> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const chunks = splitForSsml(text.trim());
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    buffers.push(await synthOne(chunk, voice, timeoutMs));
  }
  return Buffer.concat(buffers);
}

function synthOne(text: string, voice: string, timeoutMs: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const connectionId = crypto.randomUUID().replace(/-/g, '');
    const url =
      `${BASE_WSS}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${computeSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
      `&ConnectionId=${connectionId}`;

    const ws = new WebSocket(url, {
      headers: {
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': edgeUa(),
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      handshakeTimeout: timeoutMs,
    });

    const audio: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => fail(new Error('语音合成超时')), timeoutMs);

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      reject(err);
    };
    const done = (buf: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(buf);
    };

    ws.on('error', (err: Error) => fail(new Error(`Edge TTS 连接失败：${err.message}`)));

    ws.on('open', () => {
      const config =
        `X-Timestamp:${dateHeader()}\r\n` +
        'Content-Type:application/json; charset=utf-8\r\n' +
        'Path:speech.config\r\n\r\n' +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        });
      ws.send(config, () => {
        const ssml =
          `X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${dateHeader()}Z\r\n` +
          'Path:ssml\r\n\r\n' +
          buildSsml(text, voice);
        ws.send(ssml);
      });
    });

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        const buf = Buffer.from(data as ArrayBuffer);
        if (buf.length < 2) return;
        const headerLen = buf.readUInt16BE(0);
        const header = buf.subarray(2, 2 + headerLen).toString('ascii');
        if (header.includes('Path:audio')) {
          audio.push(buf.subarray(2 + headerLen));
        }
        return;
      }
      const msg = (data as Buffer).toString('utf8');
      if (msg.includes('Path:turn.end')) {
        if (audio.length === 0) return fail(new Error('Edge TTS 未返回音频数据'));
        done(Buffer.concat(audio));
      }
    });
  });
}

/** 合成文本，失败自动重试（换一次时间窗签名） */
export async function edgeTtsWithRetry(
  text: string,
  voice: string,
  attempts = 3,
): Promise<Buffer> {
  let lastErr: Error = new Error('未执行');
  for (let i = 0; i < attempts; i++) {
    try {
      return await edgeTts(text, voice);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      await sleep(800 * (i + 1));
    }
  }
  throw new Error(`Edge TTS 合成失败：${lastErr.message}`);
}
