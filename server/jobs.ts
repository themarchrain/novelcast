import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './store.js';
import { selectSource } from './sources/registry.js';
import type { ChapterRef } from './sources/types.js';
import { generatePodcastScript } from './script.js';
import { synthesize } from './tts/index.js';
import { durationsForRanges } from './mp3.js';
import { savePodcast, savePodcastAudio } from './store.js';
import type { AudioSegmentTiming, Job, PodcastMeta, PodcastMode, Speaker } from './types.js';
import { newId } from './util.js';

/**
 * 串行任务队列 + 任务记录持久化（data/jobs.json）。
 *
 * 可靠性约定：
 * - 任务与浏览器无关：刷新/多标签页都从 `GET /api/jobs` 读取真实状态；
 * - 进程内的排队与进度实时落盘；进程启动时恢复——
 *   未开始的（仍在排队）自动重新排队，已开始的标记为 interrupted 可重试；
 * - 产物（播客）本就落盘在 data/podcasts/，与任务记录相互独立。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOBS_FILE = path.join(ROOT, 'data', 'jobs.json');
/** 历史记录保留上限（终态任务，超出按创建时间淘汰最旧的） */
const KEEP_TERMINAL = 200;

const jobs = new Map<string, Job>();
const paramsById = new Map<string, CreatePodcastParams>();
const queue: string[] = [];
let running = false;

export interface CreatePodcastParams {
  /** 显式指定数据源 id；缺省时按 URL 自动匹配 */
  sourceId?: string;
  /** 源表单输入（URL 源即 {url: "章节页地址"}；file 类源为上传文件的绝对路径） */
  inputs: Record<string, string>;
  /** 批量模式：已选定的章节引用（核心不解释其内容，直接交给源） */
  ref?: string;
  mode: PodcastMode;
  /** 单播时的主说话人（男声/女声） */
  soloSpeaker?: Speaker;
  maleVoice?: string;
  femaleVoice?: string;
}

interface JobRecord {
  job: Job;
  params: CreatePodcastParams;
}

// ---------- 持久化 ----------

let persistTimer: NodeJS.Timeout | null = null;
let writeChain: Promise<void> = Promise.resolve();

function snapshot(): JobRecord[] {
  const records: JobRecord[] = [];
  for (const job of jobs.values()) {
    const params = paramsById.get(job.id);
    if (params) records.push({ job, params });
  }
  return pruneRecords(records);
}

async function writeNow(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(JOBS_FILE), { recursive: true });
    const tmp = `${JOBS_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, jobs: snapshot() }, null, 2), 'utf8');
    await fs.rename(tmp, JOBS_FILE);
  } catch (err) {
    console.warn('[任务] 任务记录落盘失败：', err instanceof Error ? err.message : err);
  }
}

/** 落盘：immediate=true 用于创建/终态等关键节点；否则 500ms 去抖 */
function persist(immediate = false): void {
  if (immediate) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    writeChain = writeChain.then(writeNow);
    return;
  }
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeChain = writeChain.then(writeNow);
  }, 500);
}

// ---------- 恢复规划（纯函数，便于测试） ----------

/** 判定每条运行中记录的恢复动作：未开始（仍排队）→ 重新排队；已开始 → 标记中断 */
export function planRecovery(records: JobRecord[]): { requeue: string[]; interrupted: string[] } {
  const requeue: string[] = [];
  const interrupted: string[] = [];
  for (const r of records) {
    if (r.job.status !== 'running') continue;
    if (r.job.step === '排队中') requeue.push(r.job.id);
    else interrupted.push(r.job.id);
  }
  return { requeue, interrupted };
}

/** 保留全部活动任务 + 最新 KEEP_TERMINAL 条终态任务（按创建时间淘汰最旧） */
export function pruneRecords(records: JobRecord[], keepTerminal = KEEP_TERMINAL): JobRecord[] {
  const active = records.filter((r) => r.job.status === 'running');
  const terminal = records
    .filter((r) => r.job.status !== 'running')
    .sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt));
  return [...active, ...terminal.slice(0, keepTerminal)].sort((a, b) =>
    a.job.createdAt.localeCompare(b.job.createdAt),
  );
}

/** 启动时加载任务记录；返回恢复摘要（供日志） */
export async function initJobs(): Promise<{ loaded: number; requeued: number; interrupted: number }> {
  let records: JobRecord[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(JOBS_FILE, 'utf8')) as { jobs?: JobRecord[] };
    if (Array.isArray(parsed.jobs)) records = parsed.jobs.filter((r) => r && r.job && r.params);
  } catch {
    // 首次运行或文件损坏：从空开始
  }

  for (const r of records) {
    jobs.set(r.job.id, r.job);
    paramsById.set(r.job.id, r.params);
  }

  const { requeue, interrupted } = planRecovery(records);
  for (const id of requeue) {
    const job = jobs.get(id);
    if (!job) continue;
    job.message = '服务重启，已自动重新排队';
    job.log.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 服务重启，自动重新排队`);
    queue.push(id);
  }
  for (const id of interrupted) {
    const job = jobs.get(id);
    if (!job) continue;
    job.status = 'interrupted';
    job.step = '已中断';
    job.error = '服务重启导致任务中断';
    job.message = '任务被服务重启中断，可点击重试';
    job.log.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 服务重启导致中断`);
  }
  queue.sort((a, b) => (jobs.get(a)?.createdAt || '').localeCompare(jobs.get(b)?.createdAt || ''));

  persist(true);
  if (queue.length > 0) void drain();
  return { loaded: records.length, requeued: requeue.length, interrupted: interrupted.length };
}

// ---------- 查询 ----------

export function getJob(id: string): Job | null {
  return jobs.get(id) || null;
}

/** 活动任务（运行中/排队中），按创建时间升序 */
export function activeJobs(): Job[] {
  return [...jobs.values()]
    .filter((j) => j.status === 'running')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 最近终态任务（完成/失败/中断），按创建时间降序 */
export function recentJobs(limit = 10): Job[] {
  return [...jobs.values()]
    .filter((j) => j.status !== 'running')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** 队列状态：等待中的任务数 + 是否正在执行 */
export function queueStats(): { waiting: number; running: boolean } {
  return { waiting: queue.length, running };
}

// ---------- 任务 ----------

function update(id: string, patch: Partial<Job>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  persist(patch.status !== undefined); // 状态变化立即落盘，其余去抖
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
  persist(true);
  void drain();
  return id;
}

/** 重试：重新排队并完整执行（仅限终态任务） */
export function retryJob(id: string): Job {
  const job = jobs.get(id);
  if (!job) throw new Error('任务不存在');
  if (job.status === 'running') throw new Error('任务正在执行中，无需重试');
  if (!paramsById.get(id)) throw new Error('任务参数缺失，无法重试');
  job.status = 'running';
  job.step = '排队中';
  job.progress = 0;
  job.message = '已重新排队，等待执行';
  job.error = undefined;
  job.podcastId = undefined;
  log(id, '重新执行任务');
  queue.push(id);
  persist(true);
  void drain();
  return job;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      persist(true); // 出队即落盘：此时记录仍是“排队中”，重启后会重新排队
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
  if (!params.ref && !url) throw new Error('请填写小说章节页 URL');
  const source = selectSource(url, params.sourceId);
  update(jobId, { step: '抓取正文', progress: 3, message: `正在通过数据源「${source.label}」获取正文…` });
  log(jobId, `数据源：${source.label}（${source.id}）`);
  log(jobId, `章节引用：${params.ref ?? url}`);
  let ref: ChapterRef;
  if (params.ref) {
    // 批量模式：章节引用由用户选定（经 /api/sources/:id/chapters 列出），核心不解释其内容
    ref = { sourceId: source.id, ref: params.ref };
  } else {
    const listed: ChapterRef[] = await source.listChapters({ url });
    if (listed.length === 0) throw new Error(`数据源「${source.id}」未返回任何章节`);
    ref = listed[0];
  }
  const chapter = await source.fetchChapter(ref);
  const charCount = chapter.text.replace(/\s/g, '').length;
  const label = [chapter.bookTitle, chapter.chapterTitle].filter(Boolean).join(' · ') || undefined;
  log(
    jobId,
    `提取成功（源：${source.id}）：${chapter.bookTitle || ''} ${chapter.chapterTitle || ''}，正文 ${charCount} 字`,
  );
  update(jobId, { label, progress: 10, message: `正文提取完成，共 ${charCount} 字` });

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
    sourceUrl: ref.ref || url,
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
