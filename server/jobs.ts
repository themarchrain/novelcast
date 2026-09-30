import { loadConfig } from './store.js';
import { selectSource } from './sources/registry.js';
import type { ChapterRef } from './sources/types.js';
import { generatePodcastScript } from './script.js';
import { synthesize } from './tts/index.js';
import { durationsForRanges } from './mp3.js';
import { savePodcast, savePodcastAudio } from './store.js';
import type { AudioSegmentTiming, Job, PodcastMeta, PodcastMode, Speaker } from './types.js';
import { newId } from './util.js';

const jobs = new Map<string, Job>();
const paramsById = new Map<string, CreatePodcastParams>();
const queue: string[] = [];
let running = false;

export interface CreatePodcastParams {
  /** 显式指定数据源 id；缺省时按 URL 自动匹配 */
  sourceId?: string;
  /** 源表单输入（URL 源即 {url: "章节页地址"}） */
  inputs: Record<string, string>;
  mode: PodcastMode;
  /** 单播时的主说话人（男声/女声） */
  soloSpeaker?: Speaker;
  maleVoice?: string;
  femaleVoice?: string;
}

export function getJob(id: string): Job | null {
  return jobs.get(id) || null;
}

function update(id: string, patch: Partial<Job>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
}

function log(id: string, line: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.log.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${line}`);
  if (job.log.length > 60) job.log.splice(0, job.log.length - 60);
}

export function createPodcastJob(params: CreatePodcastParams): string {
  const id = newId();
  const job: Job = {
    id,
    status: 'running',
    step: '排队中',
    progress: 0,
    message: '任务已创建，等待执行',
    log: [],
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  paramsById.set(id, params);
  queue.push(id);
  void drain();
  return id;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      await runJob(id);
    }
  } finally {
    running = false;
  }
}

async function runJob(id: string): Promise<void> {
  const params = paramsById.get(id);
  if (!params) return;
  try {
    await pipeline(id, params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    update(id, { status: 'failed', step: '失败', message: msg, error: msg });
    log(id, `任务失败：${msg}`);
  }
}

async function pipeline(jobId: string, params: CreatePodcastParams): Promise<void> {
  const cfg = await loadConfig();
  const podcastId = newId();

  // 1. 取章：选源 → 源内部完成抓取/解密/清洗，交回一章全量文本
  const url = (params.inputs.url || '').trim();
  if (!url) throw new Error('请填写小说章节页 URL');
  const source = selectSource(url, params.sourceId);
  update(jobId, { step: '抓取正文', progress: 3, message: `正在通过数据源「${source.label}」获取正文…` });
  log(jobId, `数据源：${source.label}（${source.id}）`);
  log(jobId, `章节引用：${url}`);
  const refs: ChapterRef[] = await source.listChapters({ url });
  // 当前为单章输出，取第一个章节引用；多章批量产出待扩展
  if (refs.length === 0) throw new Error(`数据源「${source.id}」未返回任何章节`);
  const chapter = await source.fetchChapter(refs[0]);
  const charCount = chapter.text.replace(/\s/g, '').length;
  log(
    jobId,
    `提取成功（源：${source.id}）：${chapter.bookTitle || ''} ${chapter.chapterTitle || ''}，正文 ${charCount} 字`,
  );
  update(jobId, { progress: 10, message: `正文提取完成，共 ${charCount} 字` });

  // 2. AI 写稿
  update(jobId, { step: 'AI 写稿', progress: 12, message: '正在让 AI 改写播客脚本…' });
  const script = await generatePodcastScript(cfg.llm, chapter, params.mode, {
    soloSpeaker: params.soloSpeaker ?? 'female',
    onProgress: (ratio, msg) => {
      update(jobId, { progress: 12 + Math.round(ratio * 28), message: msg });
    },
  });
  log(jobId, `脚本完成：${script.segments.length} 条台词，标题「${script.title}」`);
  update(jobId, { progress: 42, message: `脚本完成，共 ${script.segments.length} 条台词` });

  // 3. 逐段语音合成
  const buffers: Buffer[] = [];
  const total = script.segments.length;
  for (let i = 0; i < total; i++) {
    const seg = script.segments[i];
    update(jobId, {
      step: '语音合成',
      progress: 45 + Math.round((i / total) * 50),
      message: `语音合成 ${i + 1}/${total}`,
    });
    try {
      buffers.push(await synthesize(cfg, seg.text, seg.speaker));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`第 ${i + 1} 条台词合成失败：${msg}`);
    }
  }
  log(jobId, '语音合成完成');
  update(jobId, { progress: 96, message: '音频拼接中…' });

  // 4. 拼接 + 分段时间轴（供前端文稿跟随/跳转）
  const audio = Buffer.concat(buffers);
  const bounds: { start: number; end: number }[] = [];
  let offset = 0;
  for (const b of buffers) {
    bounds.push({ start: offset, end: offset + b.length });
    offset += b.length;
  }
  const durations = durationsForRanges(audio, bounds);
  let cursor = 0;
  const timings: AudioSegmentTiming[] = script.segments.map((seg, i) => {
    const t: AudioSegmentTiming = {
      ...seg,
      startMs: cursor,
      durationMs: Math.max(durations[i], 200),
    };
    cursor += t.durationMs;
    return t;
  });

  // 5. 落盘
  const meta: PodcastMeta = {
    id: podcastId,
    title: script.title,
    mode: params.mode,
    provider: cfg.tts.provider,
    maleVoice: params.maleVoice,
    femaleVoice: params.femaleVoice,
    createdAt: new Date().toISOString(),
    sourceUrl: refs[0].ref || url,
    sourceId: source.id,
    bookTitle: chapter.bookTitle,
    author: chapter.author,
    chapterTitle: chapter.chapterTitle,
    chapterChars: charCount,
    audioBytes: audio.length,
    durationMs: cursor,
    llmModel: cfg.llm.model,
  };
  await savePodcast(meta, timings);
  await savePodcastAudio(podcastId, audio);

  update(jobId, {
    status: 'done',
    step: '完成',
    progress: 100,
    message: '播客生成完成',
    podcastId,
  });
  log(jobId, `播客已保存（音频 ${(audio.length / 1024 / 1024).toFixed(1)} MB）`);
}
