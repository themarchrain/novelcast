export type Speaker = 'male' | 'female';
export type PodcastMode = 'solo' | 'duo';
export type TtsProvider = 'edge' | 'openai' | 'voxcpm';

export interface PodcastMeta {
  id: string;
  title: string;
  mode: PodcastMode;
  provider: TtsProvider;
  maleVoice?: string;
  femaleVoice?: string;
  createdAt: string;
  sourceUrl: string;
  sourceId?: string;
  bookTitle?: string;
  author?: string;
  chapterTitle?: string;
  chapterChars: number;
  audioBytes: number;
  durationMs: number;
  llmModel?: string;
  error?: string;
}

export interface AudioSegmentTiming {
  speaker: Speaker;
  text: string;
  startMs: number;
  durationMs: number;
}

export interface PodcastData {
  meta: PodcastMeta;
  script: { title: string; segments: AudioSegmentTiming[] };
  segments: AudioSegmentTiming[];
}

export interface Job {
  id: string;
  status: 'running' | 'done' | 'failed';
  step: string;
  progress: number;
  message: string;
  log: string[];
  podcastId?: string;
  error?: string;
  createdAt: string;
}

export interface AppConfig {
  llm: { baseURL: string; apiKey: string; model: string; jsonMode: boolean; temperature: number };
  tts: {
    provider: TtsProvider;
    edge: { maleVoice: string; femaleVoice: string };
    openai: {
      baseURL: string;
      apiKey: string;
      model: string;
      maleVoice: string;
      femaleVoice: string;
      styleInstruction: string;
    };
    voxcpm: {
      baseURL: string;
      maleControl: string;
      femaleControl: string;
      timesteps: number;
    };
  };
}

export interface VoiceOption {
  id: string;
  label: string;
  gender: Speaker;
}

// ---------- 数据源（与 server/sources/types.ts 契约对齐） ----------

export interface SourceInputField {
  key: string;
  label: string;
  type: 'url' | 'text' | 'file';
  required: boolean;
  placeholder?: string;
}

export interface SourceInfo {
  id: string;
  label: string;
  description?: string;
  inputs: SourceInputField[];
}

/** 源对给定输入解析出的章节（TXT 源＝分章结果；URL 源＝单章） */
export interface ChapterListItem {
  sourceId: string;
  ref: string;
  bookTitle?: string;
  chapterTitle?: string;
  chars?: number;
}
