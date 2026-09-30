import { describe, expect, it } from 'vitest';
import { pickSource, validateSource } from '../server/sources/registry';
import type { NovelSource } from '../server/sources/types';

function makeSource(id: string, match?: (url: string) => boolean): NovelSource {
  return {
    id,
    label: `源-${id}`,
    inputs: [{ key: 'url', label: 'URL', type: 'url', required: true }],
    ...(match ? { matchUrl: match } : {}),
    listChapters: async () => [],
    fetchChapter: async () => ({ text: '正文' }),
  };
}

describe('源形状校验', () => {
  it('合法源通过', () => {
    expect(validateSource(makeSource('ok'))).toBeNull();
  });

  it('缺少默认导出 / 缺 id / 缺方法均报错', () => {
    expect(validateSource(null)).toMatch(/默认导出/);
    expect(validateSource({ label: 'x', inputs: [], listChapters: () => {}, fetchChapter: () => {} })).toMatch(/id/);
    expect(validateSource({ id: 'x', label: 'x', inputs: [], listChapters: () => {} })).toMatch(/fetchChapter/);
  });

  it('inputs 字段项非法时报错', () => {
    const bad = { ...makeSource('bad'), inputs: [{ key: '', type: 'url', required: true }] };
    expect(validateSource(bad)).toMatch(/inputs/);
    const badType = { ...makeSource('bad'), inputs: [{ key: 'a', type: 'select', required: true }] };
    expect(validateSource(badType)).toMatch(/inputs\.a\.type/);
  });
});

describe('URL → 源选择', () => {
  const sources = [
    makeSource('alpha', (url) => /alpha\.site/.test(url)),
    makeSource('beta', (url) => /beta\.site/.test(url)),
    makeSource('generic', () => true),
  ];

  it('自动模式按注册顺序首个命中者胜', () => {
    expect(pickSource(sources, 'https://beta.site/a.html').id).toBe('beta');
  });

  it('显式指定永远优先（即使 URL 不匹配它）', () => {
    expect(pickSource(sources, 'https://alpha.site/a.html', 'generic').id).toBe('generic');
  });

  it('显式指定不存在的源时报错', () => {
    expect(() => pickSource(sources, 'https://alpha.site/', 'nope')).toThrow(/未找到数据源/);
  });

  it('无命中且无兜底时报错并列出已注册源', () => {
    const strict = [sources[0], sources[1]];
    expect(() => pickSource(strict, 'https://other.site/')).toThrow(/没有数据源能识别/);
  });

  it('零源时给中文引导', () => {
    expect(() => pickSource([], 'https://x.site/')).toThrow(/extensions-local/);
  });

  it('没有 matchUrl 的源不参与自动匹配', () => {
    const manualOnly = [makeSource('manual')];
    expect(() => pickSource(manualOnly, 'https://x.site/')).toThrow(/没有数据源能识别/);
    expect(pickSource(manualOnly, 'https://x.site/', 'manual').id).toBe('manual');
  });
});
