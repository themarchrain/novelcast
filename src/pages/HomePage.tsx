import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Checkbox, Empty, Form, Input, Popconfirm, Progress, Segmented, Select, Space, Typography, Upload, message } from 'antd';
import { DeleteOutlined, DownloadOutlined, InboxOutlined, InfoCircleOutlined, LinkOutlined, PlayCircleOutlined, AudioOutlined } from '@ant-design/icons';
import { api, fmtDuration, fmtSize } from '../api';
import type { ChapterListItem, Job, PodcastMeta, SourceInfo, VoiceOption } from '../types';

export default function HomePage() {
  const nav = useNavigate();
  const [form] = Form.useForm();
  const [mode, setMode] = useState<'solo' | 'duo'>('duo');
  const [soloGender, setSoloGender] = useState<'female' | 'male'>('female');
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [provider, setProvider] = useState<string>('edge');
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceId, setSourceId] = useState<string>('');
  // TXT 批量通道状态
  const [channel, setChannel] = useState<'url' | 'txt'>('url');
  const [txtSourceId, setTxtSourceId] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [fileInfo, setFileInfo] = useState<{ path: string; name: string } | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [batchJobIds, setBatchJobIds] = useState<string[]>([]);
  const [batchJobs, setBatchJobs] = useState<Job[]>([]);
  const [queueWaiting, setQueueWaiting] = useState(0);
  const batchDoneRef = useRef(0);
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

  // 通道划分：声明了 file 类输入的源用于 TXT 批量通道，其余用于 URL 通道
  const hasFileInput = (s: SourceInfo) => s.inputs.some((f) => f.type === 'file');
  const txtSources = sources.filter(hasFileInput);
  const urlSources = sources.filter((s) => !hasFileInput(s));
  const hasTxtChannel = txtSources.length > 0;
  const txtSource = txtSources.find((s) => s.id === txtSourceId) || txtSources[0];

  // 当前手动选中的源（'' = 自动识别）
  const activeSource = urlSources.find((s) => s.id === sourceId);
  const urlField = activeSource?.inputs.find((f) => f.key === 'url');
  const extraInputs = activeSource?.inputs.filter((f) => f.key !== 'url') ?? [];

  // 批量进度派生
  const batchDone = batchJobs.filter((j) => j.status === 'done').length;
  const batchFailed = batchJobs.filter((j) => j.status === 'failed').length;
  const batchAllDone =
    batchJobIds.length > 0 && batchJobs.length === batchJobIds.length && batchJobs.every((j) => j.status !== 'running');
  const currentBatchJob = batchJobs.find((j) => j.status === 'running');

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

  // TXT 源默认选中第一个可用源
  useEffect(() => {
    if (txtSources.length > 0 && !txtSources.some((s) => s.id === txtSourceId)) {
      setTxtSourceId(txtSources[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  // 批量任务轮询：进度面板 + 每完成一期刷新节目单
  useEffect(() => {
    if (batchJobIds.length === 0) return;
    const timer = setInterval(async () => {
      try {
        const { jobs, queue } = await api.jobsStatus(batchJobIds);
        setBatchJobs(jobs);
        setQueueWaiting(queue.waiting);
        const done = jobs.filter((j) => j.status === 'done').length;
        if (done > batchDoneRef.current) {
          batchDoneRef.current = done;
          void refreshList();
        }
        if (jobs.length === batchJobIds.length && jobs.every((j) => j.status !== 'running')) {
          clearInterval(timer);
          const failed = jobs.filter((j) => j.status === 'failed').length;
          if (failed > 0) message.warning(`批量生成结束：成功 ${jobs.length - failed} 期，失败 ${failed} 期`);
          else message.success(`批量生成完成：共 ${jobs.length} 期`);
        }
      } catch {
        // 轮询失败忽略，等下一轮
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [batchJobIds, refreshList]);

  // 切换 TXT 数据源（分章策略可能不同）时，用已上传的文件重新解析
  useEffect(() => {
    if (!fileInfo || !txtSource) return;
    void parseChapters(txtSource, fileInfo.path)
      .then((list) => message.info(`已按「${txtSource.label}」重新解析：共 ${list.length} 章`))
      .catch((e) => message.error(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txtSourceId]);

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

  const fileKeyOf = (s: SourceInfo) => s.inputs.find((f) => f.type === 'file')?.key || 'file';

  /** 解析章节（上传后 / 切换 TXT 数据源时复用） */
  const parseChapters = async (src: SourceInfo, filePath: string) => {
    const { chapters: list } = await api.listChapters(src.id, { [fileKeyOf(src)]: filePath });
    setChapters(list);
    setSelectedRefs([]);
    return list;
  };

  const onPickTxt = async (file: File) => {
    if (!txtSource) return;
    setUploading(true);
    try {
      if (file.size > 60 * 1024 * 1024) throw new Error('文件超过 60MB，请拆分后再试');
      const up = await api.uploadFile(file);
      const list = await parseChapters(txtSource, up.path);
      if (list.length === 0) {
        throw new Error('未能从文件中解析出任何章节（可在源目录的 patterns.json 中调整分章策略）');
      }
      setFileInfo({ path: up.path, name: file.name });
      message.success(`解析完成：共 ${list.length} 章`);
    } catch (e) {
      setFileInfo(null);
      setChapters([]);
      setSelectedRefs([]);
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const toggleRef = (ref: string, checked: boolean) => {
    setSelectedRefs((prev) => (checked ? [...prev, ref] : prev.filter((r) => r !== ref)));
  };

  const submitTxt = async () => {
    if (!txtSource) {
      message.warning('没有可用的 TXT 数据源');
      return;
    }
    if (!fileInfo) {
      message.warning('请先上传 TXT 文件');
      return;
    }
    if (selectedRefs.length === 0) {
      message.warning('请至少选择一章');
      return;
    }
    setCreating(true);
    try {
      const maleVoice = form.getFieldValue('maleVoice') || defaultVoice(maleVoices) || '';
      const femaleVoice = form.getFieldValue('femaleVoice') || defaultVoice(femaleVoices) || '';
      const inputs = { [fileKeyOf(txtSource)]: fileInfo.path };
      const body =
        mode === 'solo'
          ? { sourceId: txtSource.id, inputs, refs: selectedRefs, mode, ...(soloGender === 'male' ? { maleVoice } : { femaleVoice }) }
          : { sourceId: txtSource.id, inputs, refs: selectedRefs, mode, maleVoice, femaleVoice };
      const { jobIds } = await api.createPodcast(body);
      batchDoneRef.current = 0;
      setBatchJobs([]);
      setJob(null);
      setBatchJobIds(jobIds);
      message.success(`已入队 ${jobIds.length} 个任务，按顺序依次生成`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const onSubmit = async () => {
    if (channel === 'txt') {
      await submitTxt();
      return;
    }
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
        <p className="hero-sub">贴入章节页地址，或上传整本 TXT 挑章节批量开播。</p>
      </section>

      <Card
        className="panel reveal d2"
        style={{ marginBottom: 22 }}
        title={<span className="h-title">🎙️ 新建一期</span>}
      >
        <Form form={form} layout="vertical">
          {hasTxtChannel && (
            <Form.Item label="输入通道">
              <Segmented
                value={channel}
                onChange={(v) => setChannel(v as 'url' | 'txt')}
                options={[
                  { label: 'URL 单章', value: 'url' },
                  { label: 'TXT 整本书批量', value: 'txt' },
                ]}
                style={{ padding: 3 }}
              />
            </Form.Item>
          )}

          {channel === 'url' && (
            <>
              {urlSources.length > 0 && (
                <Form.Item
                  label="数据源"
                  extra="「自动识别」按注册顺序匹配第一个命中的源；把源放入 extensions-local/sources/ 后重启即可注册"
                >
                  <Select
                    value={sourceId}
                    onChange={(v) => setSourceId(v as string)}
                    options={[
                      { value: '', label: '自动识别（按 URL 匹配）' },
                      ...urlSources.map((s) => ({ value: s.id, label: `${s.label}（${s.id}）` })),
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
                  urlSources.length === 0
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
            </>
          )}

          {channel === 'txt' && (
            <>
              {txtSources.length > 1 && (
                <Form.Item label="数据源">
                  <Select
                    value={txtSource?.id}
                    onChange={(v) => setTxtSourceId(v as string)}
                    options={txtSources.map((s) => ({ value: s.id, label: `${s.label}（${s.id}）` }))}
                  />
                </Form.Item>
              )}

              <Form.Item
                label="小说 TXT 文件"
                extra="UTF-8 编码；上传后按数据源的分章策略解析章节（策略可在源目录的 patterns.json 中自定义）"
              >
                <Upload.Dragger
                  accept=".txt,text/plain"
                  showUploadList={false}
                  disabled={uploading}
                  beforeUpload={(f) => {
                    void onPickTxt(f);
                    return false;
                  }}
                >
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-text">{uploading ? '上传并解析中…' : '点击或拖拽 TXT 文件到此处'}</p>
                  <p className="ant-upload-hint">整本书会被切分成章节，你可以只挑其中几章生成播客</p>
                </Upload.Dragger>
              </Form.Item>

              {fileInfo && chapters.length > 0 && (
                <Form.Item
                  label={`选择章节（已选 ${selectedRefs.length}/${chapters.length}）`}
                  extra="每章一期播客，按选择顺序依次生成；单章失败不影响其余章节"
                >
                  <div className="chapter-toolbar">
                    <Button size="small" onClick={() => setSelectedRefs(chapters.map((c) => c.ref))}>
                      全选
                    </Button>
                    <Button size="small" onClick={() => setSelectedRefs([])}>
                      清空
                    </Button>
                    <span className="chapter-file">📄 {fileInfo.name}</span>
                  </div>
                  <div className="chapter-list">
                    {chapters.map((c) => (
                      <Checkbox
                        key={c.ref}
                        checked={selectedRefs.includes(c.ref)}
                        onChange={(e) => toggleRef(c.ref, e.target.checked)}
                      >
                        <span className="chapter-title">{c.chapterTitle}</span>
                        {typeof c.chars === 'number' && (
                          <span className="chapter-chars">{c.chars.toLocaleString()} 字</span>
                        )}
                      </Checkbox>
                    ))}
                  </div>
                </Form.Item>
              )}
            </>
          )}

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
                loading={creating || (channel === 'url' && job?.status === 'running')}
                onClick={onSubmit}
                size="large"
              >
                {channel === 'txt'
                  ? `开始批量生成${selectedRefs.length ? `（已选 ${selectedRefs.length} 章）` : ''}`
                  : '开播'}
              </Button>
            </Form.Item>
          </Space>
        </Form>

        {channel === 'url' && job && (
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

        {channel === 'txt' && batchJobIds.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Progress
              percent={Math.round((batchDone / batchJobIds.length) * 100)}
              status={batchFailed > 0 ? 'exception' : batchAllDone ? 'success' : 'active'}
              showInfo={false}
            />
            <Typography.Text style={{ color: 'var(--slate)', fontSize: 13 }}>
              批量生成：完成 {batchDone}/{batchJobIds.length}
              {batchFailed > 0 ? `，失败 ${batchFailed}` : ''}
              {queueWaiting > 0 ? ` · 队列等待 ${queueWaiting}` : ''}
              {currentBatchJob ? `　【${currentBatchJob.step}】${currentBatchJob.message}` : ''}
            </Typography.Text>
            {batchJobs.filter((j) => j.status === 'failed').length > 0 && (
              <pre className="log-box" style={{ marginTop: 8 }}>
                {batchJobs
                  .filter((j) => j.status === 'failed')
                  .map((j) => `✗ ${j.error || j.message}`)
                  .join('\n')}
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
