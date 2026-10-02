import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: { compilerOptions: { paths: {} } },
  clean: true,
  sourcemap: true,
  target: 'node22',
  platform: 'node',
  external: ['typeorm-unit-of-work'],
});
