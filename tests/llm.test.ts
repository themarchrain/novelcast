import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chat, buildChatUrl, extractJsonObject, LlmError } from '../server/llm';

let server: Server;
let baseUrl = '';

const canned = {
  id: 'chatcmpl-test',
  object: 'chat.completion',
  choices: [
    { index: 0, message: { role: 'assistant', content: '```json\n{"title":"T","segments":[{"speaker":"male","text":"你好"}]}\n```' } },
  ],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString('utf8')));
      req.on('end', () => {
        const parsed = JSON.parse(body) as { model?: string; messages?: unknown[] };
        if (!parsed.model) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'model required' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(canned));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('OpenAI 兼容客户端', () => {
  const cfg = {
    baseURL: '',
    apiKey: 'sk-test',
    model: 'test-model',
    jsonMode: false,
    temperature: 0.5,
  };

  it('正常请求并解析内容', async () => {
    const out = await chat({ ...cfg, baseURL: baseUrl }, [
      { role: 'user', content: 'hi' },
    ]);
    expect(out).toContain('"title"');
    const obj = extractJsonObject(out);
    expect(obj.segments).toBeTruthy();
  });

  it('非 2xx 报中文错误', async () => {
    await expect(
      chat({ ...cfg, baseURL: baseUrl, model: '' }, [{ role: 'user', content: 'x' }]),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it('未配置时给中文提示', async () => {
    await expect(chat({ ...cfg, baseURL: '' }, [])).rejects.toThrow(/尚未配置 AI 接口地址/);
  });
});

describe('LLM BaseURL 拼接', () => {
  it('域名自动补 /v1/chat/completions', () => {
    expect(buildChatUrl('https://api.example.com')).toBe('https://api.example.com/v1/chat/completions');
  });
  it('/v1 结尾补 /chat/completions', () => {
    expect(buildChatUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions');
  });
  it('自定义路径直接补端点', () => {
    expect(buildChatUrl('https://proxy.example.com/api')).toBe('https://proxy.example.com/api/chat/completions');
  });
  it('完整端点原样使用', () => {
    expect(buildChatUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });
  it('# 结尾表示完整地址', () => {
    expect(buildChatUrl('https://x.example.com/llm#')).toBe('https://x.example.com/llm');
  });
});
