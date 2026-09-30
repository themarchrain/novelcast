import type { AppConfig, ChapterListItem, Job, PodcastData, PodcastMeta, SourceInfo, VoiceOption } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg = (data && (data as { error?: string }).error) || `请求失败（HTTP ${res.status}）`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  createPodcast: (body: {
    sourceId?: string;
    inputs: Record<string, string>;
    /** 批量模式：选定的章节引用列表（每章一个任务） */
    refs?: string[];
    mode: string;
    maleVoice?: string;
    femaleVoice?: string;
  }) => request<{ jobId: string; jobIds: string[] }>('/api/podcasts', { method: 'POST', body: JSON.stringify(body) }),

  getSources: () => request<SourceInfo[]>('/api/sources'),

  /** 列出某源对给定输入解析出的章节 */
  listChapters: (sourceId: string, inputs: Record<string, string>) =>
    request<{ chapters: ChapterListItem[] }>(
      `/api/sources/${encodeURIComponent(sourceId)}/chapters`,
      { method: 'POST', body: JSON.stringify({ inputs }) },
    ),

  /** 上传文件（原始字节），返回落盘路径（作为 file 类源输入传回） */
  uploadFile: async (file: File): Promise<{ id: string; path: string; name: string; bytes: number }> => {
    const res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: await file.arrayBuffer(),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(data?.error || `上传失败（HTTP ${res.status}）`);
    return data as { id: string; path: string; name: string; bytes: number };
  },

  /** 批量任务状态（含队列概况） */
  jobsStatus: (ids: string[]) =>
    request<{ jobs: Job[]; queue: { waiting: number; running: boolean } }>(
      `/api/jobs?ids=${ids.map(encodeURIComponent).join(',')}`,
    ),

  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),

  listPodcasts: () => request<PodcastMeta[]>('/api/podcasts'),

  getPodcast: (id: string) => request<PodcastData>(`/api/podcasts/${id}`),

  deletePodcast: (id: string) => request<{ ok: boolean }>(`/api/podcasts/${id}`, { method: 'DELETE' }),

  extract: (body: { sourceId?: string; inputs: Record<string, string> }) =>
    request<{
      source: string;
      bookTitle?: string;
      author?: string;
      chapterTitle?: string;
      chars: number;
      preview: string;
    }>('/api/extract', { method: 'POST', body: JSON.stringify(body) }),

  getSettings: () => request<AppConfig>('/api/settings'),

  saveSettings: (cfg: AppConfig) =>
    request<AppConfig>('/api/settings', { method: 'PUT', body: JSON.stringify(cfg) }),

  testLlm: (llm: Partial<AppConfig['llm']>) =>
    request<{ ok: boolean; reply: string }>('/api/settings/test-llm', {
      method: 'POST',
      body: JSON.stringify(llm),
    }),

  testTtsUrl: (provider: string, speaker: string, cfg?: Partial<AppConfig['tts']>) => {
    const qs = new URLSearchParams({ speaker });
    return `/api/settings/test-tts?${qs.toString()}`;
  },

  testTts: async (
    tts: Partial<AppConfig['tts']>,
    speaker: 'male' | 'female',
  ): Promise<{ url: string }> => {
    const res = await fetch(`/api/settings/test-tts?speaker=${speaker}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tts),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error((data && data.error) || `试听失败（HTTP ${res.status}）`);
    }
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob) };
  },

  getVoices: () => request<{ provider: string; voices: VoiceOption[] }>('/api/voices'),
};

export function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
