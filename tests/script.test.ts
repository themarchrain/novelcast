import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '../server/llm';
import { chunkByParagraph } from '../server/util';
import { normalizeSegments } from '../server/script';

describe('LLM 输出 JSON 解析', () => {
  it('解析纯 JSON', () => {
    const obj = extractJsonObject('{"title":"A","segments":[{"speaker":"male","text":"嗨"}]}');
    expect(obj.title).toBe('A');
  });

  it('解析 markdown 围栏包裹的 JSON', () => {
    const obj = extractJsonObject('好的，以下是脚本：\n```json\n{"title":"B","segments":[]}\n```');
    expect(obj.title).toBe('B');
  });

  it('容忍前缀文字与尾逗号', () => {
    const obj = extractJsonObject('脚本如下 {"title":"C","segments":[{"speaker":"male","text":"x"},]}');
    expect(obj.title).toBe('C');
  });

  it('无法解析时报错', () => {
    expect(() => extractJsonObject('这不是 JSON')).toThrow(/无法解析为 JSON/);
  });
});

describe('长文分块', () => {
  it('按段落切块且不超过上限太多', () => {
    const paras: string[] = [];
    for (let i = 0; i < 40; i++) paras.push('这是第' + i + '段。'.padEnd(0) + '内容'.repeat(60) + '。');
    const text = paras.join('\n');
    const chunks = chunkByParagraph(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThan(2200);
    expect(chunks.join('\n').replace(/\n/g, '')).toBe(text.replace(/\n/g, ''));
  });
});

describe('脚本段落归一化', () => {
  it('兼容 speaker 的多种写法并过滤空台词', () => {
    const segs = normalizeSegments(
      [
        { speaker: '男', text: '哈喽，欢迎收听！' },
        { speaker: 'female', text: '  嗯，这章确实精彩。 ' },
        { speaker: 'A', text: '' },
        { speaker: 'male', text: '咱们先聊聊剧情。' },
      ],
      'duo',
      'female',
    );
    expect(segs).toEqual([
      { speaker: 'male', text: '哈喽，欢迎收听！' },
      { speaker: 'female', text: '嗯，这章确实精彩。' },
      { speaker: 'male', text: '咱们先聊聊剧情。' },
    ]);
  });

  it('单播强制同一说话人', () => {
    const segs = normalizeSegments(
      [
        { speaker: 'female', text: 'a' },
        { speaker: 'male', text: 'b' },
      ],
      'solo',
      'male',
    );
    expect(segs.every((s) => s.speaker === 'male')).toBe(true);
  });
});
