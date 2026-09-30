import { Router } from 'express';
import { maskKey, isMaskedKey } from './config.js';
import { loadConfig, saveConfig } from './store.js';
import { listSources, selectSource } from './sources/registry.js';
import { createPodcastJob, getJob } from './jobs.js';
import {
  deletePodcast,
  getPodcast,
  getPodcastAudio,
  listPodcasts,
  podcastAudioPath,
} from './store.js';
import { chat } from './llm.js';
import { listVoices, previewVoice } from './tts/index.js';
import type { AppConfig, PodcastMode } from './types.js';

export const api = Router();

function bad(res: import('express').Response, err: unknown, status = 400): void {
  const msg = err instanceof Error ? err.message : String(err);
  res.status(status).json({ error: msg });
}

function mask(cfg: AppConfig): AppConfig {
  return {
    llm: { ...cfg.llm, apiKey: maskKey(cfg.llm.apiKey) },
    tts: {
      ...cfg.tts,
      openai: { ...cfg.tts.openai, apiKey: maskKey(cfg.tts.openai.apiKey) },
    },
  };
}

// ---------- 数据源 ----------

/** 已注册源的能力清单（供前端渲染下拉与动态表单） */
api.get('/sources', (_req, res) => {
  res.json(listSources());
});

// ---------- 播客 ----------

api.post('/podcasts', async (req, res) => {
  try {
    const { sourceId, inputs, mode, maleVoice, femaleVoice } = req.body as {
      sourceId?: string;
      inputs?: Record<string, unknown>;
      mode?: PodcastMode;
      maleVoice?: string;
      femaleVoice?: string;
    };
    if (!inputs || typeof inputs !== 'object') throw new Error('请填写源表单输入（inputs）');
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(inputs)) normalized[k] = String(v ?? '').trim();
    if (!normalized.url) throw new Error('请填写小说章节页 URL');
    if (mode !== 'solo' && mode !== 'duo') throw new Error('请选择讲解形式（单人/双人）');
    const soloSpeaker = mode === 'solo' ? (femaleVoice ? 'female' : 'male') : undefined;
    const jobId = createPodcastJob({
      sourceId: sourceId?.trim() || undefined,
      inputs: normalized,
      mode,
      soloSpeaker,
      maleVoice,
      femaleVoice,
    });
    res.json({ jobId });
  } catch (err) {
    bad(res, err);
  }
});

api.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return bad(res, new Error('任务不存在'), 404);
  res.json(job);
});

api.get('/podcasts', async (_req, res) => {
  res.json(await listPodcasts());
});

api.get('/podcasts/:id', async (req, res) => {
  const data = await getPodcast(req.params.id);
  if (!data) return bad(res, new Error('播客不存在'), 404);
  res.json(data);
});

api.get('/podcasts/:id/audio', async (req, res) => {
  const p = await podcastAudioPath(req.params.id);
  if (!p) return bad(res, new Error('音频不存在'), 404);
  res.sendFile(p, { acceptRanges: true, cacheControl: false }, (err) => {
    if (err && !res.headersSent) bad(res, new Error('音频发送失败'), 500);
  });
});

api.get('/podcasts/:id/download', async (req, res) => {
  const data = await getPodcast(req.params.id);
  if (!data) return bad(res, new Error('播客不存在'), 404);
  const p = await podcastAudioPath(req.params.id);
  if (!p) return bad(res, new Error('音频不存在'), 404);
  // 直接传原始文件名：Express 会生成 RFC 5987 的 filename*=UTF-8''… 参数，
  // 浏览器据此还原中文名；若在此处手动 encodeURIComponent，会被当成普通
  // ASCII 写进旧式 filename= 参数，下载下来就变成一串百分号编码。
  const filename = `${data.meta.title.replace(/[\\/:*?"<>|]/g, '_')}.mp3`;
  res.download(p, filename, (err) => {
    if (err && !res.headersSent) bad(res, new Error('下载失败'), 500);
  });
});

api.delete('/podcasts/:id', async (req, res) => {
  const ok = await deletePodcast(req.params.id);
  if (!ok) return bad(res, new Error('删除失败'), 500);
  res.json({ ok: true });
});

// ---------- 提取预览 ----------

api.post('/extract', async (req, res) => {
  try {
    const { sourceId, inputs } = req.body as {
      sourceId?: string;
      inputs?: Record<string, unknown>;
    };
    const url = String(inputs?.url ?? '').trim();
    if (!url) throw new Error('请填写 URL');
    const source = selectSource(url, sourceId?.trim() || undefined);
    const refs = await source.listChapters({ url });
    if (refs.length === 0) throw new Error(`数据源「${source.id}」未返回任何章节`);
    const chapter = await source.fetchChapter(refs[0]);
    res.json({
      source: source.id,
      bookTitle: chapter.bookTitle,
      author: chapter.author,
      chapterTitle: chapter.chapterTitle,
      chars: chapter.text.replace(/\s/g, '').length,
      preview: chapter.text.slice(0, 600),
    });
  } catch (err) {
    bad(res, err);
  }
});

// ---------- 设置 ----------

api.get('/settings', async (_req, res) => {
  res.json(mask(await loadConfig()));
});

api.put('/settings', async (req, res) => {
  try {
    const incoming = req.body as AppConfig;
    const current = await loadConfig();
    const next: AppConfig = {
      llm: {
        ...current.llm,
        ...(incoming.llm || {}),
        // 前端回传脱敏占位符时保留真实 key
        apiKey: isMaskedKey(incoming.llm?.apiKey ?? '') ? current.llm.apiKey : incoming.llm.apiKey,
      },
      tts: {
        provider: incoming.tts?.provider ?? current.tts.provider,
        edge: { ...current.tts.edge, ...(incoming.tts?.edge || {}) },
        openai: {
          ...current.tts.openai,
          ...(incoming.tts?.openai || {}),
          apiKey: isMaskedKey(incoming.tts?.openai?.apiKey ?? '')
            ? current.tts.openai.apiKey
            : incoming.tts.openai.apiKey,
        },
        voxcpm: { ...current.tts.voxcpm, ...(incoming.tts?.voxcpm || {}) },
      },
    };
    await saveConfig(next);
    res.json(mask(next));
  } catch (err) {
    bad(res, err);
  }
});

api.post('/settings/test-llm', async (req, res) => {
  try {
    // 允许用请求体里的配置测试（保存前测试），否则用已保存配置
    const current = await loadConfig();
    const body = (req.body || {}) as Partial<AppConfig['llm']>;
    const cfg = {
      ...current.llm,
      ...body,
      apiKey: body.apiKey && !isMaskedKey(body.apiKey) ? body.apiKey : current.llm.apiKey,
    };
    const reply = await chat(cfg, [{ role: 'user', content: '请只回复两个字：正常' }], {
      timeoutMs: 60000,
      jsonMode: false,
    });
    res.json({ ok: true, reply: reply.trim().slice(0, 100) });
  } catch (err) {
    bad(res, err, 502);
  }
});

api.post('/settings/test-tts', async (req, res) => {
  try {
    const current = await loadConfig();
    const body = (req.body || {}) as Partial<AppConfig['tts']>;
    const cfg: AppConfig = {
      ...current,
      tts: { ...current.tts, ...body },
    };
    if (cfg.tts.openai?.apiKey && !isMaskedKey(cfg.tts.openai.apiKey)) {
      cfg.tts.openai.apiKey = cfg.tts.openai.apiKey;
    } else if (body.openai) {
      cfg.tts.openai = { ...current.tts.openai, ...body.openai };
      if (isMaskedKey(cfg.tts.openai.apiKey)) cfg.tts.openai.apiKey = current.tts.openai.apiKey;
    }
    const speaker = (req.query.speaker as 'male' | 'female') || 'female';
    const audio = await previewVoice(cfg, speaker);
    res.type('audio/mpeg').send(audio);
  } catch (err) {
    bad(res, err, 502);
  }
});

api.get('/voices', async (_req, res) => {
  const cfg = await loadConfig();
  res.json(listVoices(cfg));
});
