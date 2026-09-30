/** 与服务端 server/tts/edge.ts、server/config.ts 保持一致的音色表 */

export interface EdgeVoice {
  id: string;
  label: string;
  gender: 'male' | 'female';
}

export const EDGE_VOICES: EdgeVoice[] = [
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男声，自然（免费保底）', gender: 'male' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男声，阳光浑厚', gender: 'male' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男声，专业播音', gender: 'male' },
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声，温暖（免费保底）', gender: 'female' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声，活泼甜亮', gender: 'female' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '小贝 · 女声，东北口音', gender: 'female' },
];

const SF_MODEL = 'FunAudioLLM/CosyVoice2-0.5B';

export const SILICONFLOW_VOICES: EdgeVoice[] = [
  { id: `${SF_MODEL}:alex`, label: 'Alex · 男声，沉稳', gender: 'male' },
  { id: `${SF_MODEL}:benjamin`, label: 'Benjamin · 男声，低沉', gender: 'male' },
  { id: `${SF_MODEL}:charles`, label: 'Charles · 男声，磁性（推荐主播）', gender: 'male' },
  { id: `${SF_MODEL}:david`, label: 'David · 男声，欢快', gender: 'male' },
  { id: `${SF_MODEL}:anna`, label: 'Anna · 女声，沉稳', gender: 'female' },
  { id: `${SF_MODEL}:bella`, label: 'Bella · 女声，激情', gender: 'female' },
  { id: `${SF_MODEL}:claire`, label: 'Claire · 女声，温柔', gender: 'female' },
  { id: `${SF_MODEL}:diana`, label: 'Diana · 女声，欢快（推荐主播）', gender: 'female' },
];

export const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';
export const SILICONFLOW_MODEL = SF_MODEL;
