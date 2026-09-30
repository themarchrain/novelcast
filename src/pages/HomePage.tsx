import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Empty, Form, Input, Popconfirm, Progress, Segmented, Select, Space, Typography, message } from 'antd';
import { DeleteOutlined, DownloadOutlined, InfoCircleOutlined, LinkOutlined, PlayCircleOutlined, AudioOutlined } from '@ant-design/icons';
import { api, fmtDuration, fmtSize } from '../api';
import type { Job, PodcastMeta, SourceInfo, VoiceOption } from '../types';

export default function HomePage() {
  const nav = useNavigate();
  const [form] = Form.useForm();
  const [mode, setMode] = useState<'solo' | 'duo'>('duo');
  const [soloGender, setSoloGender] = useState<'female' | 'male'>('female');
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [provider, setProvider] = useState<string>('edge');
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceId, setSourceId] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [podcasts, setPodcasts] = useState<PodcastMeta[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshVoices = useCallback(async () => {
    try {
      const v = await api.getVoices();
      setVoices(v.voices);
      setProvider(v.provider);
    } catch {
      /* 未配置时不阻塞首页 */
    }
  }, []);

  const refreshSources = useCallback(async () => {
    try {
      setSources(await api.getSources());
    } catch {
      /* 加载失败不阻塞首页 */
    }
  }, []);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    try {
      setPodcasts(await api.listPodcasts());
    } catch {
      // 静默
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void refreshVoices();
    void refreshList();
    void refreshSources();
    void (async () => {
      try {
        const cfg = await api.getSettings();
        setLlmConfigured(!!cfg.llm.baseURL && !!cfg.llm.model);
      } catch {
        setLlmConfigured(false);
      }
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshVoices, refreshList, refreshSources]);

  const maleVoices = voices.filter((v) => v.gender === 'male');
  const femaleVoices = voices.filter((v) => v.gender === 'female');
  const defaultVoice = (list: VoiceOption[]) => (list.length ? list[0].id : undefined);

  // 当前手动选中的源（'' = 自动识别）
  const activeSource = sources.find((s) => s.id === sourceId);
  const urlField = activeSource?.inputs.find((f) => f.key === 'url');
  const extraInputs = activeSource?.inputs.filter((f) => f.key !== 'url') ?? [];

  // 音色列表异步加载后，补上未选择的默认音色
  useEffect(() => {
    const patch: Record<string, string> = {};
    if (maleVoices.length && !form.getFieldValue('maleVoice')) {
      patch.maleVoice = maleVoices[0].id;
    }
    if (femaleVoices.length && !form.getFieldValue('femaleVoice')) {
      patch.femaleVoice = femaleVoices[0].id;
    }
    if (Object.keys(patch).length > 0) form.setFieldsValue(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices]);

  const startPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const j = await api.getJob(jobId);
        setJob({ ...j });
        if (j.status !== 'running') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (j.status === 'done' && j.podcastId) {
            message.success('播客生成完成！');
            void refreshList();
            nav(`/podcast/${j.podcastId}`);
          }
        }
      } catch {
        // 轮询失败忽略
      }
    }, 1500);
  };

  const onSubmit = async () => {
    const inputsRaw = (form.getFieldValue('inputs') || {}) as Record<string, unknown>;
    const inputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(inputsRaw)) inputs[k] = String(v ?? '').trim();
    if (!inputs.url) {
      message.warning('请先填写小说章节页 URL');
      return;
    }
    setCreating(true);
    try {
      const maleVoice = form.getFieldValue('maleVoice') || defaultVoice(maleVoices) || '';
      const femaleVoice = form.getFieldValue('femaleVoice') || defaultVoice(femaleVoices) || '';
      const body =
        mode === 'solo'
          ? { sourceId: sourceId || undefined, inputs, mode, ...(soloGender === 'male' ? { maleVoice } : { femaleVoice }) }
          : { sourceId: sourceId || undefined, inputs, mode, maleVoice, femaleVoice };
      const { jobId } = await api.createPodcast(body);
      setJob({
        id: jobId,
        status: 'running',
        step: '排队中',
        progress: 0,
        message: '等待执行',
        log: [],
        createdAt: '',
      });
      startPolling(jobId);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await api.deletePodcast(id);
      message.success('已删除');
      void refreshList();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      {llmConfigured === false && (
        <div className="tip-banner reveal d1">
          <InfoCircleOutlined />
          <span>还没有配置 AI 接口，暂无法生成播客；语音合成不受影响，本地 VoxCPM 可免费使用。</span>
          <span className="tip-action">
            <Button size="small" type="primary" onClick={() => nav('/settings')}>
              去设置
            </Button>
          </span>
        </div>
      )}

      <section className="hero reveal d1">
        <div className="hero-kicker">EACH CHAPTER, ON AIR</div>
        <h1 className="hero-title">
          把一章小说，变成一期能<em>听</em>的播客。
        </h1>
        <p className="hero-sub">贴入章节页地址，写稿、配音、拼接一次完成。</p>
      </section>

      <Card
        className="panel reveal d2"
        style={{ marginBottom: 22 }}
        title={<span className="h-title">🎙️ 新建一期</span>}
      >
        <Form form={form} layout="vertical">
          {sources.length > 0 && (
            <Form.Item
              label="数据源"
              extra="「自动识别」按注册顺序匹配第一个命中的源；把源放入 extensions-local/sources/ 后重启即可注册"
            >
              <Select
                value={sourceId}
                onChange={(v) => setSourceId(v as string)}
                options={[
                  { value: '', label: '自动识别（按 URL 匹配）' },
                  ...sources.map((s) => ({ value: s.id, label: `${s.label}（${s.id}）` })),
                ]}
              />
            </Form.Item>
          )}

          <Form.Item
            name={['inputs', 'url']}
            label={urlField?.label || '小说章节页 URL'}
            rules={[
              { required: true, message: '请填写 URL' },
              {
                validator: (_, v) =>
                  !v || /^(https?:\/\/|www\.)/i.test(v.trim())
                    ? Promise.resolve()
                    : Promise.reject(new Error('请输入合法的网址')),
              },
            ]}
            extra={
              sources.length === 0
                ? '尚未注册任何数据源：把你的源放入 extensions-local/sources/（一个源一个子目录，含 index.ts）后重启服务即可注册'
                : activeSource?.description || '自动识别时按注册顺序匹配第一个命中的数据源'
            }
          >
            <Input
              placeholder={urlField?.placeholder || 'https://example.com/book/123/456.html'}
              prefix={<LinkOutlined style={{ color: 'var(--stone)' }} />}
              allowClear
              onPressEnter={onSubmit}
            />
          </Form.Item>

          {extraInputs.map((f) => (
            <Form.Item
              key={f.key}
              name={['inputs', f.key]}
              label={f.label}
              rules={f.required ? [{ required: true, message: `请填写${f.label}` }] : undefined}
              extra={f.type === 'file' ? '文件上传暂不支持' : undefined}
            >
              <Input placeholder={f.placeholder} disabled={f.type === 'file'} allowClear onPressEnter={onSubmit} />
            </Form.Item>
          ))}

          <Form.Item label="讲解形式">
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as 'solo' | 'duo')}
              options={[
                { label: '双人讲解（一男一女）', value: 'duo' },
                { label: '单人讲解', value: 'solo' },
              ]}
              style={{ padding: 3 }}
            />
          </Form.Item>

          {mode === 'solo' && (
            <Form.Item label="声音性别">
              <Segmented
                value={soloGender}
                onChange={(v) => setSoloGender(v as 'female' | 'male')}
                options={[
                  { label: '女生声音', value: 'female' },
                  { label: '男生声音', value: 'male' },
                ]}
              />
            </Form.Item>
          )}

          <Space size="middle" wrap align="end">
            {(mode === 'duo' || (mode === 'solo' && soloGender === 'male')) && (
              <Form.Item
                name="maleVoice"
                label={mode === 'duo' ? '男主播声音' : '主播声音'}
                style={{ minWidth: 280 }}
                initialValue={defaultVoice(maleVoices)}
              >
                <Select
                  options={maleVoices.map((v) => ({ value: v.id, label: v.label }))}
                  placeholder={provider === 'openai' ? '在设置中配置男声音色' : '选择男声'}
                  disabled={maleVoices.length === 0}
                />
              </Form.Item>
            )}
            {(mode === 'duo' || (mode === 'solo' && soloGender === 'female')) && (
              <Form.Item
                name="femaleVoice"
                label={mode === 'duo' ? '女主播声音' : '主播声音'}
                style={{ minWidth: 280 }}
                initialValue={defaultVoice(femaleVoices)}
              >
                <Select
                  options={femaleVoices.map((v) => ({ value: v.id, label: v.label }))}
                  placeholder={provider === 'openai' ? '在设置中配置女声音色' : '选择女声'}
                  disabled={femaleVoices.length === 0}
                />
              </Form.Item>
            )}
            <Form.Item>
              <Button
                type="primary"
                icon={<AudioOutlined />}
                loading={creating || job?.status === 'running'}
                onClick={onSubmit}
                size="large"
              >
                开播
              </Button>
            </Form.Item>
          </Space>
        </Form>

        {job && (
          <div style={{ marginTop: 16 }}>
            <Progress percent={job.progress} status={job.status === 'failed' ? 'exception' : 'active'} showInfo={false} />
            <Typography.Text style={{ color: job.status === 'failed' ? 'var(--error)' : 'var(--slate)', fontSize: 13 }}>
              【{job.step}】{job.message}
            </Typography.Text>
            {job.log.length > 0 && (
              <pre className="log-box" style={{ marginTop: 8 }}>
                {job.log.slice(-8).join('\n')}
              </pre>
            )}
          </div>
        )}
      </Card>

      <Card
        className="panel reveal d3"
        title={
          <span className="h-title">
            📼 节目单<span className="h-count">{podcasts.length} EPISODES</span>
          </span>
        }
      >
        {podcasts.length === 0 && !loadingList ? (
          <Empty description="还没有节目，先用上面的表单开播一期吧" />
        ) : (
          <div className="ep-list">
            {podcasts.map((p, i) => (
              <div className="ep-row" key={p.id}>
                <div className="ep-no">{String(i + 1).padStart(2, '0')}</div>
                <div className="ep-main">
                  <div className="ep-title" onClick={() => nav(`/podcast/${p.id}`)}>
                    {p.title}
                  </div>
                  <div className="ep-meta">
                    <span className={`chip ${p.mode === 'duo' ? 'blue' : 'green'}`}>
                      {p.mode === 'duo' ? '双播' : '单播'}
                    </span>
                    {p.bookTitle && <span>{p.bookTitle}</span>}
                    {p.chapterTitle && <span>{p.chapterTitle}</span>}
                    <span className="mono">{fmtDuration(p.durationMs)}</span>
                    <span className="mono">{fmtSize(p.audioBytes)}</span>
                    <span>{new Date(p.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                </div>
                <div className="ep-actions">
                  <Button
                    type="text"
                    icon={<PlayCircleOutlined />}
                    onClick={() => nav(`/podcast/${p.id}`)}
                  >
                    播放
                  </Button>
                  <Button
                    type="text"
                    icon={<DownloadOutlined />}
                    href={`/api/podcasts/${p.id}/download`}
                  />
                  <Popconfirm
                    title="确定删除这个播客？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => onDelete(p.id)}
                  >
                    <Button type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
