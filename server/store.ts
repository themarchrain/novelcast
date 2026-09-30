import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig, AudioSegmentTiming, PodcastData, PodcastMeta } from './types.js';
import { defaultConfig } from './config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const PODCASTS_DIR = path.join(DATA_DIR, 'podcasts');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

async function ensureDirs(): Promise<void> {
  await fs.mkdir(PODCASTS_DIR, { recursive: true });
}

// ---------- 配置 ----------

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const saved = JSON.parse(raw) as Partial<AppConfig>;
    const def = defaultConfig();
    return {
      llm: { ...def.llm, ...(saved.llm || {}) },
      tts: {
        ...def.tts,
        ...(saved.tts || {}),
        edge: { ...def.tts.edge, ...(saved.tts?.edge || {}) },
        openai: { ...def.tts.openai, ...(saved.tts?.openai || {}) },
        voxcpm: { ...def.tts.voxcpm, ...(saved.tts?.voxcpm || {}) },
      },
    };
  } catch {
    return defaultConfig();
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  await ensureDirs();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// ---------- 播客 ----------

function podcastDir(id: string): string {
  return path.join(PODCASTS_DIR, id);
}

/** 元数据 + 带时间轴的文稿一起落盘 */
export async function savePodcast(
  meta: PodcastMeta,
  segments: AudioSegmentTiming[],
): Promise<void> {
  const dir = podcastDir(meta.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  await fs.writeFile(
    path.join(dir, 'script.json'),
    JSON.stringify({ title: meta.title, segments }, null, 2),
    'utf8',
  );
}

export async function savePodcastAudio(id: string, audio: Buffer): Promise<void> {
  const dir = podcastDir(id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'audio.mp3'), audio);
}

export async function listPodcasts(): Promise<PodcastMeta[]> {
  await ensureDirs();
  const entries = await fs.readdir(PODCASTS_DIR, { withFileTypes: true });
  const metas: PodcastMeta[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const raw = await fs.readFile(path.join(PODCASTS_DIR, e.name, 'meta.json'), 'utf8');
      metas.push(JSON.parse(raw) as PodcastMeta);
    } catch {
      // 半成品目录忽略
    }
  }
  metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return metas;
}

export async function getPodcast(id: string): Promise<PodcastData | null> {
  const dir = podcastDir(id);
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')) as PodcastMeta;
    let segments: AudioSegmentTiming[] = [];
    let title = meta.title;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, 'script.json'), 'utf8')) as {
        title?: string;
        segments?: AudioSegmentTiming[];
      };
      segments = raw.segments || [];
      if (raw.title) title = raw.title;
    } catch {
      // 尚无文稿
    }
    return { meta, script: { title, segments }, segments };
  } catch {
    return null;
  }
}

export async function getPodcastAudio(id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(podcastDir(id), 'audio.mp3'));
  } catch {
    return null;
  }
}

export async function podcastAudioPath(id: string): Promise<string | null> {
  const p = path.join(podcastDir(id), 'audio.mp3');
  try {
    await fs.access(p);
    return p;
  } catch {
    return null;
  }
}

export async function deletePodcast(id: string): Promise<boolean> {
  try {
    await fs.rm(podcastDir(id), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
