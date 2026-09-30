import type { AppConfig, Speaker, TtsProvider } from '../types.js';
import { EDGE_VOICES, edgeTtsWithRetry } from './edge.js';
import { openaiTts } from './openai.js';
import { voxcpmTts } from './voxcpm.js';
import { SILICONFLOW_VOICES } from '../config.js';

export interface TtsVoiceOption {
  id: string;
  label: string;
  gender: Speaker;
}

/** 当前 Provider 可选音色列表 */
export function listVoices(cfg: AppConfig): { provider: TtsProvider; voices: TtsVoiceOption[] } {
  if (cfg.tts.provider === 'edge') {
    return { provider: 'edge', voices: EDGE_VOICES.map((v) => ({ ...v })) };
  }
  if (cfg.tts.provider === 'voxcpm') {
    return {
      provider: 'voxcpm',
      voices: [
        { id: 'male', label: '男主播（VoxCPM 本地音色）', gender: 'male' },
        { id: 'female', label: '女主播（VoxCPM 本地音色）', gender: 'female' },
      ],
    };
  }
  const o = cfg.tts.openai;
  // SiliconFlow 时给出 8 个预置音色；其他兼容端点用配置的自定义音色
  if (o.baseURL.includes('siliconflow')) {
    return { provider: 'openai', voices: SILICONFLOW_VOICES.map((v) => ({ ...v })) };
  }
  const voices: TtsVoiceOption[] = [];
  if (o.maleVoice) voices.push({ id: o.maleVoice, label: `${o.maleVoice}（设置中配置的男声）`, gender: 'male' });
  if (o.femaleVoice) voices.push({ id: o.femaleVoice, label: `${o.femaleVoice}（设置中配置的女声）`, gender: 'female' });
  return { provider: 'openai', voices };
}

function voiceFor(cfg: AppConfig, speaker: Speaker): string {
  if (cfg.tts.provider === 'edge') {
    return speaker === 'male'
      ? cfg.tts.edge.maleVoice || 'zh-CN-YunxiNeural'
      : cfg.tts.edge.femaleVoice || 'zh-CN-XiaoxiaoNeural';
  }
  if (cfg.tts.provider === 'voxcpm') {
    return speaker; // 本地 VoxCPM：male/female 即音色标识
  }
  const o = cfg.tts.openai;
  const v = speaker === 'male' ? o.maleVoice : o.femaleVoice;
  if (!v) throw new Error(`未在设置中配置${speaker === 'male' ? '男' : '女'}声音色`);
  return v;
}

/** 合成一句台词，返回 MP3 Buffer */
export async function synthesize(cfg: AppConfig, text: string, speaker: Speaker): Promise<Buffer> {
  const voice = voiceFor(cfg, speaker);
  if (cfg.tts.provider === 'edge') {
    return edgeTtsWithRetry(text, voice);
  }
  if (cfg.tts.provider === 'voxcpm') {
    const v = cfg.tts.voxcpm;
    return voxcpmTts(
      { baseURL: v.baseURL },
      text,
      speaker === 'male' ? 'male' : 'female',
      v.timesteps,
    );
  }
  const o = cfg.tts.openai;
  return openaiTts(
    {
      baseURL: o.baseURL,
      apiKey: o.apiKey,
      model: o.model,
      // 语气指令按说话人区分（SiliconFlow CosyVoice 语法）
      styleInstruction: o.styleInstruction
        ? speaker === 'male'
          ? `${o.styleInstruction}，男声`
          : `${o.styleInstruction}，女声`
        : undefined,
    },
    text,
    voice,
  );
}

/** 试听一小段 */
export async function previewVoice(cfg: AppConfig, speaker: Speaker): Promise<Buffer> {
  const text =
    speaker === 'male'
      ? '你好呀，我是本期播客的男主播，咱们一起来聊聊这章小说里最有意思的地方。'
      : '哈喽大家好，我是本期播客的女主播，今天这一章的内容特别精彩，一起听听看吧。';
  return synthesize(cfg, text, speaker);
}
