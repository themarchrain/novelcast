import { describe, expect, it } from 'vitest';
import { durationsForRanges, mp3DurationMs, parseFrames } from '../server/mp3';

/** 构造 MPEG2 Layer3 24kHz 64kbps 的合成帧（192 字节/帧，576 采样/帧） */
function makeFrame(payloadByte = 0x55): Buffer {
  const frame = Buffer.alloc(192);
  frame[0] = 0xff;
  // sync(111) ver(10=MPEG2) layer(01=L3) prot(1)
  frame[1] = 0b11110011;
  // bitrate idx 8 = 64kbps(V2L3), samplerate idx 1 = 24000, padding 0
  frame[2] = 0b10000100;
  frame[3] = 0b11000000; // mono
  frame.fill(payloadByte, 4);
  return frame;
}

describe('MP3 帧解析', () => {
  it('解析帧数与总时长', () => {
    const buf = Buffer.concat(Array.from({ length: 10 }, () => makeFrame()));
    const frames = parseFrames(buf);
    expect(frames.length).toBe(10);
    // 每帧 576/24000 = 24ms，10 帧 = 240ms
    expect(mp3DurationMs(buf)).toBe(240);
  });

  it('跳过 ID3v2 头', () => {
    const id3 = Buffer.alloc(100);
    id3.write('ID3', 0, 'ascii');
    id3[6] = 0x00; id3[7] = 0x00; id3[8] = 0x00; id3[9] = 90; // size=90 → 共 100 字节
    const buf = Buffer.concat([id3, makeFrame(0x11), makeFrame(0x22)]);
    expect(parseFrames(buf).length).toBe(2);
    expect(mp3DurationMs(buf)).toBe(48);
  });

  it('按字节范围分段计时', () => {
    const f1 = makeFrame(1);
    const f2 = makeFrame(2);
    const f3 = makeFrame(3);
    const buf = Buffer.concat([f1, f2, f3]);
    const d = durationsForRanges(buf, [
      { start: 0, end: 192 },
      { start: 192, end: 384 },
      { start: 384, end: 576 },
    ]);
    expect(d).toEqual([24, 24, 24]);
  });

  it('垃圾数据返回空帧列表', () => {
    const junk = Buffer.alloc(500, 0x33);
    expect(parseFrames(junk).length).toBe(0);
    expect(mp3DurationMs(junk)).toBeNull();
  });
});
