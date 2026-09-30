/**
 * MP3 帧级解析（MPEG1/2/2.5 Layer III）：总时长、按字节范围分段计时。
 * 用于前端文稿跟随高亮与点击跳转；解析失败时上层退化为码率估算。
 */

interface FrameInfo {
  offset: number;
  length: number;
  /** 每帧采样数（MPEG1 L3=1152，MPEG2/2.5 L3=576） */
  samples: number;
  sampleRate: number;
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000, 0], // MPEG1
  2: [22050, 24000, 16000, 0], // MPEG2
  0: [11025, 12000, 8000, 0], // MPEG2.5
};

function skipId3v2(buf: Buffer): number {
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'ID3') {
    const size =
      ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    return 10 + size;
  }
  return 0;
}

/** 解析所有有效 MP3 帧（容错：非法字节逐位重同步） */
export function parseFrames(buf: Buffer): FrameInfo[] {
  const frames: FrameInfo[] = [];
  let o = skipId3v2(buf);
  while (o + 4 <= buf.length) {
    if (buf[o] !== 0xff || (buf[o + 1] & 0xe0) !== 0xe0) {
      o++;
      continue;
    }
    const versionBits = (buf[o + 1] >> 3) & 0x03; // 0=2.5, 1=reserved, 2=MPEG2, 3=MPEG1
    const layerBits = (buf[o + 1] >> 1) & 0x03; // 1=Layer3
    if (versionBits === 1 || layerBits !== 1) {
      o++;
      continue;
    }
    const bitrateIdx = (buf[o + 2] >> 4) & 0x0f;
    const srIdx = (buf[o + 2] >> 2) & 0x03;
    const padding = (buf[o + 2] >> 1) & 0x01;
    const sampleRate = (SAMPLE_RATES[versionBits] || [0])[srIdx];
    const kbps = (versionBits === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIdx];
    if (!sampleRate || !kbps) {
      o++;
      continue;
    }
    const samples = versionBits === 3 ? 1152 : 576;
    const coeff = versionBits === 3 ? 144 : 72;
    const frameLen = Math.floor((coeff * kbps * 1000) / sampleRate) + padding;
    if (frameLen < 24) {
      o++;
      continue;
    }
    // 帧头后若紧跟下一帧头（或接近文件尾）则认为有效
    const next = o + frameLen;
    if (next + 1 < buf.length && buf[next] === 0xff && (buf[next + 1] & 0xe0) !== 0xe0) {
      // 下一帧头校验失败，视为假同步
      o++;
      continue;
    }
    frames.push({ offset: o, length: frameLen, samples, sampleRate });
    o = next;
  }
  return frames;
}

/** 整个音频的时长（毫秒）。无有效帧时返回 null。 */
export function mp3DurationMs(buf: Buffer): number | null {
  const frames = parseFrames(buf);
  if (frames.length === 0) return null;
  let ms = 0;
  for (const f of frames) ms += (f.samples / f.sampleRate) * 1000;
  return Math.round(ms);
}

export interface ByteRange {
  start: number;
  end: number; // 不含
}

/** 每个字节范围的时长（毫秒），用于按段计时 */
export function durationsForRanges(buf: Buffer, ranges: ByteRange[]): number[] {
  const frames = parseFrames(buf);
  const result = ranges.map(() => 0);
  for (const f of frames) {
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (f.offset >= r.start && f.offset < r.end) {
        result[i] += (f.samples / f.sampleRate) * 1000;
        break;
      }
    }
  }
  return result.map(Math.round);
}
