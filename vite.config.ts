import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:7749' },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
});
