import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { api } from './routes.js';
import { initSources } from './sources/registry.js';
import { initJobs } from './jobs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

async function main(): Promise<void> {
  // 静态扩展：启动时加载本地源（放入即注册，重启生效）
  await initSources();
  // 任务记录恢复：排队中的自动重新排队，执行中的标记为中断可重试
  const recovered = await initJobs();
  if (recovered.loaded > 0) {
    console.log(
      `[任务] 已加载 ${recovered.loaded} 条任务记录（重新排队 ${recovered.requeued}，标记中断 ${recovered.interrupted}）`,
    );
  }

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', api);

  // 生产模式：托管前端构建产物（dist/）
  const hasDist = await fs
    .stat(path.join(DIST, 'index.html'))
    .then(() => true)
    .catch(() => false);
  if (hasDist) {
    app.use(express.static(DIST));
    // SPA 兜底：非 /api 路由返回 index.html
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(DIST, 'index.html'));
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: `接口不存在：${req.method} ${req.path}` });
  });

  // 统一错误兜底
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  });

  app.listen(PORT, HOST, () => {
    console.log(`NovelCast 服务已启动: http://${HOST}:${PORT}`);
    if (!hasDist) {
      console.log('（未发现 dist/，前端请用 Vite dev server: http://localhost:5173）');
    }
  });
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
