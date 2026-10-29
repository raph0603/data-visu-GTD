import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base: the build can be served from any sub-path (GitHub Pages, Moodle upload, file server).
  base: './',
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
