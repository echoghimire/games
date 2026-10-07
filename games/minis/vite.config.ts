import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Four small games, each its own page, served by the arena Worker at /play/<game>/.
export default defineConfig({
  root: here('.'),
  base: '/play/',
  build: {
    target: 'es2022',
    outDir: here('../../apps/arena/public/play'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        smash: here('smash/index.html'),
        flyer: here('flyer/index.html'),
        pong: here('pong/index.html'),
        paint: here('paint/index.html'),
      },
    },
  },
});
