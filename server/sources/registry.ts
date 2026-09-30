/**
 * 源注册表：启动时从 extensions-local/sources/ 静态加载本地源。
 *
 * 静态扩展原则：放入即注册、重启生效；运行时永不加载新代码。
 * 每个源一个子目录，入口为 index.ts（tsx 运行，开发/生产均可）或 index.js；
 * 下划线开头的目录视为共享库，不作为源加载。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { NovelSource, SourceInfo } from './types.js';

/** 仓库根目录（本文件位于 server/sources/） */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCES_DIR = path.join(ROOT, 'extensions-local', 'sources');

let sources: NovelSource[] = [];

/** 形状校验：返回错误描述，null 表示合法 */
export function validateSource(mod: unknown): string | null {
  const s = mod as Partial<NovelSource> | null | undefined;
  if (!s || typeof s !== 'object') return '默认导出不是对象';
  if (typeof s.id !== 'string' || !s.id.trim()) return '缺少 id';
  if (typeof s.label !== 'string' || !s.label.trim()) return '缺少 label';
  if (!Array.isArray(s.inputs)) return '缺少 inputs 数组';
  for (const f of s.inputs) {
    if (!f || typeof f.key !== 'string' || !f.key.trim()) return 'inputs 存在缺少 key 的字段项';
    if (!['url', 'text', 'file'].includes(f.type)) return `inputs.${f.key}.type 非法`;
    if (typeof f.required !== 'boolean') return `inputs.${f.key}.required 必须为布尔值`;
  }
  if (typeof s.listChapters !== 'function') return '缺少 listChapters()';
  if (typeof s.fetchChapter !== 'function') return '缺少 fetchChapter()';
  return null;
}

/** 启动加载：扫描目录 → 动态 import → 校验 → 注册（失败跳过并告警，不阻断启动） */
export async function initSources(): Promise<void> {
  sources = [];
  let dirs: string[];
  try {
    const entries = await fs.readdir(SOURCES_DIR, { withFileTypes: true });
    dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
      .map((e) => e.name)
      .sort();
  } catch {
    console.log('[源] 未发现 extensions-local/sources/ —— 当前没有已注册的数据源');
    return;
  }

  for (const dir of dirs) {
    let entry: string | null = null;
    for (const f of ['index.ts', 'index.js']) {
      const p = path.join(SOURCES_DIR, dir, f);
      if (await fs.stat(p).then(() => true).catch(() => false)) {
        entry = p;
        break;
      }
    }
    if (!entry) {
      console.warn(`[源] 跳过 ${dir}/：缺少 index.ts 或 index.js 入口`);
      continue;
    }
    try {
      const mod = (await import(pathToFileURL(entry).href)) as { default?: unknown };
      const problem = validateSource(mod?.default);
      if (problem) {
        console.warn(`[源] 跳过 ${dir}/：${problem}`);
        continue;
      }
      const s = mod.default as NovelSource;
      if (sources.some((x) => x.id === s.id)) {
        console.warn(`[源] 跳过 ${dir}/：id「${s.id}」已注册（按目录序先到先得）`);
        continue;
      }
      sources.push(s);
    } catch (err) {
      console.warn(`[源] 加载 ${dir}/ 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 能力清单：既是启动日志，也是本机已装源的文档
  if (sources.length === 0) {
    console.log('[源] 没有加载到任何可用数据源');
    return;
  }
  console.log(`[源] 已注册 ${sources.length} 个数据源（注册顺序 = 自动匹配优先级）：`);
  for (const s of sources) {
    const mode = s.matchUrl ? 'URL 自动匹配' : '仅手动选择';
    console.log(`  - ${s.id.padEnd(22)} ${s.label}（${mode}）`);
  }
}

/** 能力清单（GET /api/sources） */
export function listSources(): SourceInfo[] {
  return sources.map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    inputs: s.inputs,
  }));
}

export function getSource(id: string): NovelSource | null {
  return sources.find((s) => s.id === id) || null;
}

/** URL → 源选择（纯函数，便于测试）：显式指定永远优先；自动模式按注册顺序首个 matchUrl 命中者胜 */
export function pickSource(available: NovelSource[], url: string, preferredId?: string): NovelSource {
  if (preferredId) {
    const s = available.find((x) => x.id === preferredId);
    if (!s) {
      throw new Error(
        `未找到数据源「${preferredId}」。已注册：${available.map((x) => x.id).join('、') || '（无）'}`,
      );
    }
    return s;
  }
  if (available.length === 0) {
    throw new Error(
      '当前没有任何已注册的数据源。本仓库刻意不内置任何站点爬取逻辑——请把你的源放入 extensions-local/sources/（一个源一个子目录，含 index.ts）后重启服务生效。',
    );
  }
  const hit = available.find((s) => s.matchUrl?.(url));
  if (!hit) {
    throw new Error(
      `没有数据源能识别这个地址：${url}。已注册源：${available.map((s) => s.label).join('、')}。可手动指定数据源，或编写匹配该站点的源放入 extensions-local/sources/。`,
    );
  }
  return hit;
}

/** 从已加载源中选择（任务管线用） */
export function selectSource(url: string, preferredId?: string): NovelSource {
  return pickSource(sources, url, preferredId);
}
