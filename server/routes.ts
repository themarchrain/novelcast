import { Router, raw } from 'express';
import { maskKey, isMaskedKey } from './config.js';
import { loadConfig, saveConfig } from './store.js';
import { getSource, listSources, selectSource } from './sources/registry.js';
import { createPodcastJob, activeJobs, getJob, queueStats, recentJobs, retryJob, type CreatePodcastParams } from './jobs.js';
import {
  deletePodcast,
  getPodcast,
  getPodcastAudio,
  listPodcasts,
  podcastAudioPath,
} from './store.js';
import { saveUpload } from './uploads.js';
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

function normalizeInputs(inputs: Record<string, unknown> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs || {})) normalized[k] = String(v ?? '').trim();
  return normalized;
}

// ---------- 数据源 ----------

/** 已注册源的能力清单（供前端渲染下拉与动态表单） */
api.get('/sources', (_req, res) => {
  res.json(listSources());
});

/** 列出某源对给定输入解析出的章节（TXT 源＝分章结果；URL 源＝单章） */
api.post('/sources/:id/chapters', async (req, res) => {
  try {
    const source = getSource(req.params.id);
    if (!source) throw new Error(`未找到数据源「${req.params.id}」`);
    const inputs = normalizeInputs((req.body as { inputs?: Record<string, unknown> })?.inputs);
    if (Object.keys(inputs).length === 0) throw new Error('请填写源表单输入（inputs）');
    const chapters = await source.listChapters(inputs);
    res.json({ chapters });
  } catch (err) {
    bad(res, err);
  }
});

// ---------- 上传 ----------

/** 上传文件（原始字节），落盘 data/uploads/，返回路径供 file 类源输入使用 */
api.post('/uploads', raw({ type: () => true, limit: '64mb' }), async (req, res) => {
  try {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error('上传内容为空');
    const name = String(req.query.name || 'novel.txt').slice(0, 200);
    // 中文小说 TXT 常见 GBK/ANSI 编码，明确提示而不是静默乱码
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      throw new Error('文件不是 UTF-8 编码（可能是 GBK/ANSI），请另存为 UTF-8 后重试');
    }
    const { id, filePath } = await saveUpload(buf, name);
    res.json({ id, path: filePath, name, bytes: buf.length });
  } catch (err) {
    bad(res, err);
  }
});

// ---------- 播客 ----------

api.post('/podcasts', async (req, res) => {
  try {
    const { sourceId, inputs, refs, mode, maleVoice, femaleVoice } = req.body as {
      sourceId?: string;
      inputs?: Record<string, unknown>;
      refs?: unknown;
      mode?: PodcastMode;
      maleVoice?: string;
      femaleVoice?: string;
    };
    if (!inputs || typeof inputs !== 'object') throw new Error('请填写源表单输入（inputs）');
    const normalized = normalizeInputs(inputs);
    if (mode !== 'solo' && mode !== 'duo') throw new Error('请选择讲解形式（单人/双人）');
    const soloSpeaker = mode === 'solo' ? (femaleVoice ? 'female' : 'male') : undefined;
    const base: Omit<CreatePodcastParams, 'ref'> = {
      sourceId: sourceId?.trim() || undefined,
      inputs: normalized,
      mode,
      soloSpeaker,
      maleVoice,
      femaleVoice,
    };

    // 批量模式：每章一个任务，串行执行；单章失败不影响其余章节
    const refList = Array.isArray(refs)
      ? refs.map((v) => String(v ?? '').trim()).filter(Boolean)
      : [];
    if (refList.length > 0) {
      if (!base.sourceId) throw new Error('批量生成需要指定数据源（sourceId）');
      if (refList.length > 200) throw new Error(`一次最多批量 ${200} 章，当前选了 ${refList.length} 章，请分批`);
      const jobIds = refList.map((ref) => createPodcastJob({ ...base, ref }));
      res.json({ jobId: jobIds[0], jobIds });
      return;
    }

    // 单章模式：沿用 URL 通道行为（源内自动匹配 + 取第一章）
    if (!normalized.url) throw new Error('请填写小说章节页 URL');
    const jobId = createPodcastJob(base);
    res.json({ jobId, jobIds: [jobId] });
  } catch (err) {
    bad(res, err);
  }
});

/**
 * 任务查询：?ids=a,b,c 返回指定任务（兼容旧调用）；
 * 不传 ids 时返回全量视图：活动任务 + 最近终态任务 + 队列概况（任务面板用）
 */
api.get('/jobs', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length > 0) {
    const found = ids.map((id) => getJob(id)).filter((j) => j !== null);
    res.json({ jobs: found, recent: [], queue: queueStats() });
    return;
  }
  res.json({ jobs: activeJobs(), recent: recentJobs(10), queue: queueStats() });
});

/** 重试终态任务（失败/中断） */
api.post('/jobs/:id/retry', (req, res) => {
  try {
    const job = retryJob(req.params.id);
    res.json({ ok: true, job });
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
