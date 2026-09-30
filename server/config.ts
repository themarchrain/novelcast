import type { AppConfig } from './types.js';

export function defaultConfig(): AppConfig {
  return {
    llm: {
      baseURL: '',
      apiKey: '',
      model: '',
      jsonMode: false,
      temperature: 0.8,
    },
    tts: {
      provider: 'edge',
      edge: {
        maleVoice: 'zh-CN-YunxiNeural',
        femaleVoice: 'zh-CN-XiaoxiaoNeural',
      },
      openai: {
        baseURL: '',
        apiKey: '',
        model: '',
        maleVoice: '',
        femaleVoice: '',
        styleInstruction: '请用轻松自然的聊天语气说',
      },
      voxcpm: {
        baseURL: 'http://127.0.0.1:18511',
        maleControl: '年轻男声主播，声音温暖有活力，吐字清晰，语气自然放松，像和朋友聊天',
        femaleControl: '年轻女声主播，声音清亮甜美，节奏明快，语气生动有感染力',
        timesteps: 10,
      },
    },
  };
}

/** key 脱敏：只保留末 4 位 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return '••••••••' + key.slice(-4);
}

/** PUT 回写时，脱敏占位符不覆盖真实 key */
export function isMaskedKey(v: string): boolean {
  return !v || v === '••••••••' || /^••••••••/.test(v);
}

/** SiliconFlow 预设（CosyVoice2，8 个预置音色，计费按输入 UTF-8 字节） */
export const SILICONFLOW_PRESET = {
  baseURL: 'https://api.siliconflow.cn/v1',
  model: 'FunAudioLLM/CosyVoice2-0.5B',
  maleVoice: 'FunAudioLLM/CosyVoice2-0.5B:charles',
  femaleVoice: 'FunAudioLLM/CosyVoice2-0.5B:diana',
};

export const SILICONFLOW_VOICES = [
  { id: `${SILICONFLOW_PRESET.model}:alex`, label: 'Alex · 男声，沉稳', gender: 'male' as const },
  { id: `${SILICONFLOW_PRESET.model}:benjamin`, label: 'Benjamin · 男声，低沉', gender: 'male' as const },
  { id: `${SILICONFLOW_PRESET.model}:charles`, label: 'Charles · 男声，磁性（推荐主播）', gender: 'male' as const },
  { id: `${SILICONFLOW_PRESET.model}:david`, label: 'David · 男声，欢快', gender: 'male' as const },
  { id: `${SILICONFLOW_PRESET.model}:anna`, label: 'Anna · 女声，沉稳', gender: 'female' as const },
  { id: `${SILICONFLOW_PRESET.model}:bella`, label: 'Bella · 女声，激情', gender: 'female' as const },
  { id: `${SILICONFLOW_PRESET.model}:claire`, label: 'Claire · 女声，温柔', gender: 'female' as const },
  { id: `${SILICONFLOW_PRESET.model}:diana`, label: 'Diana · 女声，欢快（推荐主播）', gender: 'female' as const },
];
