/** 最小 WAV（RIFF/PCM16）解析：取出 PCM 采样与采样率，供 MP3 编码使用。 */
export interface WavData {
  pcm16: Int16Array;
  sampleRate: number;
  channels: number;
}

export function parseWav(buf: Buffer): WavData {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('返回的不是 WAV 音频');
  }
  let pos = 12;
  let format = 1;
  let channels = 1;
  let sampleRate = 48000;
  let bits = 16;
  let data: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      format = buf.readUInt16LE(pos + 8);
      channels = buf.readUInt16LE(pos + 10);
      sampleRate = buf.readUInt32LE(pos + 12);
      bits = buf.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      data = buf.subarray(pos + 8, pos + 8 + size);
    }
    pos += 8 + size + (size % 2);
  }
  if (!data) throw new Error('WAV 缺少 data 块');
  if (format !== 1 || bits !== 16) throw new Error(`暂只支持 PCM16 WAV（收到 format=${format} bits=${bits}）`);

  const pcm16 = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2));
  return { pcm16, sampleRate, channels };
}
