import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Empty, Spin, Typography, message } from 'antd';
import { ArrowLeftOutlined, DownloadOutlined, PauseOutlined, CaretRightOutlined } from '@ant-design/icons';
import { api, fmtDuration, fmtSize } from '../api';
import type { AudioSegmentTiming, PodcastData } from '../types';

export default function DetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<PodcastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.getPodcast(id));
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const segments: AudioSegmentTiming[] = data?.segments || [];
  const total = durationMs || data?.meta.durationMs || 0;

  // 当前播放到的台词下标
  const activeIndex = segments.findIndex(
    (s) => currentMs >= s.startMs && currentMs < s.startMs + s.durationMs,
  );

  // 跟随滚动
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const seekTo = (ms: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = ms / 1000;
    setCurrentMs(ms);
    void a.play();
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!data) {
    return <Empty description="播客不存在或已被删除" style={{ padding: 80 }} />;
  }

  const { meta } = data;
  const fill = total > 0 ? Math.min(100, (currentMs / total) * 100) : 0;
  const providerLabel =
    meta.provider === 'voxcpm' ? 'VoxCPM 本地语音' : meta.provider === 'edge' ? 'Edge 神经语音' : 'OpenAI 兼容 TTS';

  return (
    <div className="page">
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav('/')} style={{ marginBottom: 14 }}>
        返回节目单
      </Button>

      <section className="hero reveal d1" style={{ marginBottom: 20 }}>
        <h1 className="hero-title" style={{ fontSize: 28, letterSpacing: '-0.5px', marginBottom: 10 }}>
          {meta.title}
        </h1>
        <div className="meta-strip">
          <span className="hl">{meta.mode === 'duo' ? '双人讲解' : '单人讲解'}</span>
          <span className="sep">/</span>
          <span>{providerLabel}</span>
          <span className="sep">/</span>
          <span>{fmtDuration(meta.durationMs)}</span>
          {meta.bookTitle && (
            <>
              <span className="sep">/</span>
              <span>
                原文 {meta.bookTitle} {meta.chapterTitle}（{meta.chapterChars} 字）
              </span>
            </>
          )}
          <span className="sep">/</span>
          <span>{fmtSize(meta.audioBytes)}</span>
          <span className="sep">/</span>
          <span>{new Date(meta.createdAt).toLocaleString('zh-CN')}</span>
        </div>
      </section>

      <div className="deck reveal d2" style={{ marginBottom: 24 }}>
        <audio
          ref={audioRef}
          src={`/api/podcasts/${meta.id}/audio`}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => setDurationMs(Math.round(e.currentTarget.duration * 1000))}
          onTimeUpdate={(e) => setCurrentMs(Math.round(e.currentTarget.currentTime * 1000))}
          onEnded={() => setPlaying(false)}
        />
        <div className="deck-main">
          <button className="play-btn" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
            {playing ? <PauseOutlined /> : <CaretRightOutlined />}
          </button>
          <div className={`vu ${playing ? '' : 'off'}`}>
            <span /><span /><span /><span /><span />
          </div>
          <span className="deck-time">
            <b>{fmtDuration(currentMs)}</b> / {fmtDuration(total)}
          </span>
          <input
            type="range"
            className="deck-slider"
            min={0}
            max={total}
            value={Math.min(currentMs, total)}
            style={{ ['--fill' as string]: `${fill}%` }}
            onChange={(e) => {
              const a = audioRef.current;
              if (!a) return;
              a.currentTime = Number(e.target.value) / 1000;
              setCurrentMs(Number(e.target.value));
            }}
          />
          <Button icon={<DownloadOutlined />} href={`/api/podcasts/${meta.id}/download`}>
            下载 MP3
          </Button>
        </div>
        <div className="deck-meta">
          <span className={`onair ${playing ? 'live' : ''}`}>
            <i />{playing ? 'ON AIR · 正在播放' : 'STANDBY'}
          </span>
          <span className="deck-hint">SCRIPT · 点击任意台词跳转播放</span>
        </div>
      </div>

      <Card className="panel reveal d3" title={<span className="h-title">📜 播客文稿</span>}>
        {segments.length === 0 ? (
          <Empty description="没有文稿" />
        ) : (
          <div className="script" ref={listRef}>
            {segments.map((s, i) => {
              const active = i === activeIndex;
              const isMale = s.speaker === 'male';
              return (
                <div
                  key={i}
                  data-idx={i}
                  className={`script-line ${active ? 'active' : ''}`}
                  onClick={() => seekTo(s.startMs)}
                >
                  <span className="script-who">
                    <span className={`chip ${isMale ? 'blue' : 'coral'}`}>
                      {isMale ? '男主播' : '女主播'}
                    </span>
                  </span>
                  <span className="script-text">{s.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
