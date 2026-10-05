import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'typeorm-unit-of-work-nestjs': fileURLToPath(new URL('../../packages/nestjs/src/index.ts', import.meta.url)),
      'typeorm-unit-of-work': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
