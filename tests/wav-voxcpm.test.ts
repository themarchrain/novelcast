import { describe, expect, it } from 'vitest';
import { parseWav } from '../server/tts/wav';
import { wavToMp3 } from '../server/tts/voxcpm';
import { mp3DurationMs, parseFrames } from '../server/mp3';

/** 构造单声道 PCM16 WAV */
function makeWav(samples: Int16Array, sampleRate = 48000): Buffer {
  const header = Buffer.alloc(44);
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe('WAV 解析与 MP3 编码', () => {
  it('解析 PCM16 WAV 头', () => {
    const samples = new Int16Array(48000); // 1 秒静音
    const wav = makeWav(samples);
    const { pcm16, sampleRate, channels } = parseWav(wav);
    expect(sampleRate).toBe(48000);
    expect(channels).toBe(1);
    expect(pcm16.length).toBe(48000);
  });

  it('拒绝非 WAV 数据', () => {
    expect(() => parseWav(Buffer.alloc(100, 0x33))).toThrow(/不是 WAV/);
  });

  it('WAV 转 MP3 后可被帧解析并计算时长', () => {
    const sr = 48000;
    const samples = new Int16Array(sr); // 1 秒
    for (let i = 0; i < samples.length; i++) {
      // 440Hz 正弦波（避免全静音被极端压缩）
      samples[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 8000);
    }
    const mp3 = wavToMp3(makeWav(samples, sr));
    const frames = parseFrames(mp3);
    expect(frames.length).toBeGreaterThan(30);
    const dur = mp3DurationMs(mp3);
    expect(dur).not.toBeNull();
    expect(Math.abs((dur as number) - 1000)).toBeLessThan(120);
  });
});
