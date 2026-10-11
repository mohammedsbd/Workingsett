import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** Unit tests for frontend logic (formatting, savings, auth helpers). */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
