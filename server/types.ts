export type Speaker = 'male' | 'female';
export type PodcastMode = 'solo' | 'duo';
export type TtsProvider = 'edge' | 'openai' | 'voxcpm';

export interface ScriptSegment {
  speaker: Speaker;
  text: string;
}

export interface PodcastScript {
  title: string;
  segments: ScriptSegment[];
}

/** 带时间信息的台词段，用于前端文稿跟随/点击跳转 */
export interface AudioSegmentTiming extends ScriptSegment {
  startMs: number;
  durationMs: number;
}

export interface PodcastMeta {
  id: string;
  title: string;
  mode: PodcastMode;
  provider: TtsProvider;
  maleVoice?: string;
  femaleVoice?: string;
  createdAt: string;
  /** 章节引用（URL 源即章节页地址） */
  sourceUrl: string;
  /** 产出本期的数据源 id（extensions-local 本地源） */
  sourceId?: string;
  bookTitle?: string;
  author?: string;
  chapterTitle?: string;
  /** 原文字符数 */
  chapterChars: number;
  audioBytes: number;
  durationMs: number;
  llmModel?: string;
  error?: string;
}

export interface PodcastData {
  meta: PodcastMeta;
  segments: AudioSegmentTiming[];
  script: PodcastScript;
}

export interface AppConfig {
  llm: {
    baseURL: string;
    apiKey: string;
    model: string;
    /** 兼容端点不支持 response_format 时可关闭 */
    jsonMode: boolean;
    temperature: number;
  };
  tts: {
    provider: TtsProvider;
    edge: { maleVoice: string; femaleVoice: string };
    openai: {
      baseURL: string;
      apiKey: string;
      model: string;
      maleVoice: string;
      femaleVoice: string;
      /** SiliconFlow CosyVoice 语气指令（<|endofprompt|> 格式），留空关闭 */
      styleInstruction: string;
    };
    voxcpm: {
      /** 本地 VoxCPM 服务地址，默认 http://127.0.0.1:18511 */
      baseURL: string;
      /** 男主播音色描述（Voice Design，仅首次生成参考样本时使用） */
      maleControl: string;
      /** 女主播音色描述 */
      femaleControl: string;
      /** 推理步数 4~30：越小越快、音质略降 */
      timesteps: number;
    };
  };
}

export interface Job {
  id: string;
  /** interrupted：服务重启导致的中断（记录保留，可重试） */
  status: 'running' | 'done' | 'failed' | 'interrupted';
  step: string;
  progress: number;
  message: string;
  /** 人类可读的任务标签（如「蛊真人 · 第一章 初入江湖」），取到章节后填充 */
  label?: string;
  log: string[];
  podcastId?: string;
  error?: string;
  createdAt: string;
}
