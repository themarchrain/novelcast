import { defineConfig } from 'vitest/config';

/** 本地源专属测试（extensions-local/ 不入仓库，npm test 不扫） */
export default defineConfig({
  test: { include: ['extensions-local/**/*.test.ts'] },
});
