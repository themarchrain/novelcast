import { describe, expect, it } from 'vitest';
import { planRecovery, pruneRecords } from '../server/jobs';
import type { Job } from '../server/types';

type Record_ = { job: Job; params: { inputs: Record<string, string>; mode: 'duo' } };

const params = { inputs: { url: 'https://example.com/' }, mode: 'duo' as const };

function rec(id: string, status: Job['status'], step: string, createdAt: string): Record_ {
  return {
    job: {
      id,
      status,
      step,
      progress: status === 'running' ? 0 : 100,
      message: '',
      log: [],
      createdAt,
    },
    params,
  };
}

describe('任务恢复规划', () => {
  it('运行中且仍在排队 → 重新排队', () => {
    const { requeue, interrupted } = planRecovery([
      rec('a', 'running', '排队中', '2026-01-01T00:00:00.000Z'),
    ]);
    expect(requeue).toEqual(['a']);
    expect(interrupted).toEqual([]);
  });

  it('运行中且已开始 → 标记中断', () => {
    const { requeue, interrupted } = planRecovery([
      rec('b', 'running', '语音合成', '2026-01-01T00:00:01.000Z'),
    ]);
    expect(requeue).toEqual([]);
    expect(interrupted).toEqual(['b']);
  });

  it('终态任务（完成/失败/中断）不动', () => {
    const { requeue, interrupted } = planRecovery([
      rec('c', 'done', '完成', '2026-01-01T00:00:02.000Z'),
      rec('d', 'failed', '失败', '2026-01-01T00:00:03.000Z'),
      rec('e', 'interrupted', '已中断', '2026-01-01T00:00:04.000Z'),
    ]);
    expect(requeue).toEqual([]);
    expect(interrupted).toEqual([]);
  });

  it('混合场景：排队与执行中并存', () => {
    const { requeue, interrupted } = planRecovery([
      rec('a', 'running', 'AI 写稿', '2026-01-01T00:00:00.000Z'),
      rec('b', 'running', '排队中', '2026-01-01T00:00:01.000Z'),
      rec('c', 'done', '完成', '2026-01-01T00:00:02.000Z'),
    ]);
    expect(requeue).toEqual(['b']);
    expect(interrupted).toEqual(['a']);
  });
});

describe('任务记录淘汰', () => {
  it('保留全部活动任务 + 最新 N 条终态任务', () => {
    const records = [
      rec('active', 'running', '语音合成', '2026-01-01T00:00:00.000Z'),
      rec('t1', 'done', '完成', '2026-01-01T00:00:01.000Z'),
      rec('t2', 'done', '完成', '2026-01-01T00:00:02.000Z'),
      rec('t3', 'failed', '失败', '2026-01-01T00:00:03.000Z'),
      rec('t4', 'done', '完成', '2026-01-01T00:00:04.000Z'),
    ];
    const kept = pruneRecords(records, 2).map((r) => r.job.id);
    expect(kept).toContain('active');
    expect(kept).toContain('t4');
    expect(kept).toContain('t3');
    expect(kept).not.toContain('t1');
    expect(kept).not.toContain('t2');
  });

  it('返回结果按创建时间升序', () => {
    const kept = pruneRecords(
      [
        rec('x', 'done', '完成', '2026-01-01T00:00:05.000Z'),
        rec('y', 'done', '完成', '2026-01-01T00:00:01.000Z'),
      ],
      5,
    );
    expect(kept.map((r) => r.job.id)).toEqual(['y', 'x']);
  });
});
