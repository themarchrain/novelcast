import { chat, extractJsonObject, type ChatMessage, type LlmConfig } from './llm.js';
import { chunkByParagraph } from './util.js';
import type { ChapterContent } from './sources/types.js';
import type { PodcastMode, PodcastScript, ScriptSegment, Speaker } from './types.js';

const MAX_CHUNK_CHARS = 4000;
const MAX_SEGMENTS = 400;

function systemPrompt(mode: PodcastMode): string {
  const common = `你是一位经验丰富的中文播客主播兼小说解说撰稿人。任务：把用户提供的小说章节原文，改编成播客讲解脚本，用于后续语音合成朗读。

硬性要求：
1. 只输出一个 JSON 对象，禁止输出任何解释文字、注释或 markdown 围栏。
2. JSON 格式：{"title":"本期播客标题","segments":[{"speaker":"male","text":"台词"},{"speaker":"female","text":"台词"}]}
3. speaker 只能是 "male" 或 "female"。
4. 台词必须口语化、可直接朗读：多用自然的语气词与反应（"诶，""哈哈，""嗯……""啊？这"），让朗读像真人聊天；禁止舞台指示（如"（笑）""旁白："）、markdown、序号、emoji。
5. 每条台词 15~80 字；短句节奏，禁止大段独白。
6. 忠于原文情节，不虚构原著没有的设定；专有名词以原文为准。
7. 内容结构：先概述本章剧情脉络，再挑 2~4 个看点深入聊（人物动机、冲突、伏笔、情绪、文笔等），可少量引用原文金句，结尾简短收尾。`;

  if (mode === 'duo') {
    return (
      common +
      `\n8. 一男一女两位主播对谈：male 是男主播，female 是女主播，两人交替发言、有来有回，都要充分参与；开头互相打招呼引入本章，结尾两人道别。`
    );
  }
  return (
    common +
    `\n8. 单人主播独播：所有台词的 speaker 用同一个值（主播的性别），自问自答、像和听众聊天；开头问好引入本章，结尾道别。`
  );
}

function userPrompt(
  chapter: ChapterContent,
  chunk: string,
  index: number,
  total: number,
  recentLines: string[],
): string {
  const parts: string[] = [];
  parts.push(`小说：${chapter.bookTitle || '未知作品'}`);
  if (chapter.chapterTitle) parts.push(`章节：${chapter.chapterTitle}`);
  parts.push(
    total > 1
      ? `原文（第 ${index + 1}/${total} 部分，与前文连续）：\n"""\n${chunk}\n"""`
      : `原文：\n"""\n${chunk}\n"""`,
  );
  if (recentLines.length > 0) {
    parts.push(
      `这是接续部分。脚本上一段结尾两句是：「${recentLines.join('」「')}」，请自然衔接，不要重复已讲过的内容。`,
    );
  }
  parts.push(
    index === 0
      ? '请按系统要求输出 JSON 脚本（title 生成一个吸引人的本期标题）。'
      : '请按系统要求输出 JSON 脚本（这是接续部分，title 留空字符串，只输出 segments）。全文第一人称继续，不要重打招呼。',
  );
  return parts.join('\n\n');
}

function normalizeSpeaker(v: unknown): Speaker | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (/^(male|m|男|男主播|host_male)$/.test(s)) return 'male';
  if (/^(female|f|女|女主播|host_female)$/.test(s)) return 'female';
  // A/B、主播1/2 之类兜底：按出现顺序无法判断，交给上层按前文交替
  if (/^(a|1)$/.test(s)) return 'male';
  if (/^(b|2)$/.test(s)) return 'female';
  return null;
}

export function normalizeSegments(
  raw: unknown,
  mode: PodcastMode,
  soloSpeaker: Speaker,
): ScriptSegment[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { segments?: unknown })?.segments)
      ? ((raw as { segments: unknown[] }).segments as unknown[])
      : null;
  if (!list) return [];
  const out: ScriptSegment[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const text = String(o.text ?? o.content ?? o.line ?? '').trim();
    if (!text) continue;
    let sp = normalizeSpeaker(o.speaker ?? o.role ?? o.voice);
    if (mode === 'solo') {
      sp = soloSpeaker;
    } else if (!sp) {
      // 双播中无法识别的 speaker，按交替兜底
      sp = out.length > 0 && out[out.length - 1].speaker === 'male' ? 'female' : 'male';
    }
    out.push({ speaker: sp, text });
  }
  return out;
}

/** 生成播客脚本。长章节自动分块，块间带衔接上下文。 */
export async function generatePodcastScript(
  cfg: LlmConfig,
  chapter: ChapterContent,
  mode: PodcastMode,
  opts: { soloSpeaker?: Speaker; onProgress?: (ratio: number, message: string) => void } = {},
): Promise<PodcastScript> {
  const { onProgress } = opts;
  const soloSpeaker: Speaker = opts.soloSpeaker ?? 'female';
  const chunks = chunkByParagraph(chapter.text, MAX_CHUNK_CHARS);
  const segments: ScriptSegment[] = [];
  let title = '';

  for (let i = 0; i < chunks.length; i++) {
    const recent = segments.slice(-2).map((s) => s.text.slice(0, 30));
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(mode) },
      { role: 'user', content: userPrompt(chapter, chunks[i], i, chunks.length, recent) },
    ];
    const content = await chat(cfg, messages, { timeoutMs: 240000 });
    const obj = extractJsonObject(content);
    if (i === 0 && typeof obj.title === 'string' && obj.title.trim()) {
      title = obj.title.trim();
    }
    const segs = normalizeSegments(
      obj.segments ?? obj.script ?? obj.dialogue ?? obj,
      mode,
      soloSpeaker,
    );
    if (segs.length === 0) {
      throw new Error(`AI 返回的脚本没有有效台词（第 ${i + 1} 部分）`);
    }
    segments.push(...segs);
    onProgress?.((i + 1) / chunks.length, `AI 写稿 ${i + 1}/${chunks.length} 段`);
  }

  if (segments.length === 0) throw new Error('AI 生成的脚本为空');
  if (segments.length > MAX_SEGMENTS) segments.length = MAX_SEGMENTS;

  if (!title) {
    title = `${chapter.bookTitle || '小说'}·${chapter.chapterTitle || '本篇'}讲解`;
  }
  return { title, segments };
}
