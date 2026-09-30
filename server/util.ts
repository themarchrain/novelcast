import { createHash, randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 20);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 带重试的异步调用，每次失败后短暂等待 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  attempts: number,
  onFail?: (err: Error, attempt: number) => void,
): Promise<T> {
  let lastErr: Error = new Error('未执行');
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      onFail?.(lastErr, i);
      if (i < attempts) await sleep(600 * i);
    }
  }
  throw lastErr;
}

/** sha256 大写十六进制 */
export function sha256Upper(input: string): string {
  return createHash('sha256').update(input, 'ascii').digest('hex').toUpperCase();
}

/** 按段落切分长文本，每块约 maxChars 字（不切断句子/段落） */
export function chunkByParagraph(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (paragraphs.length === 0) return text.trim() ? [text.trim()] : [];
  const chunks: string[] = [];
  let cur = '';
  for (const p of paragraphs) {
    // 单段超长的兜底：按句号硬切
    if (p.length > maxChars * 1.5) {
      if (cur) chunks.push(cur);
      cur = '';
      for (const sentence of p.split(/(?<=[。！？!?])/)) {
        if ((cur + sentence).length > maxChars) {
          if (cur) chunks.push(cur);
          cur = sentence;
        } else {
          cur += sentence;
        }
      }
      continue;
    }
    if ((cur + '\n' + p).length > maxChars) {
      if (cur) chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + '\n' + p : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
