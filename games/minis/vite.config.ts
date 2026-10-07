import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Small games, each its own page, served by the arena Worker at /play/<game>/.
// Adopted open-source games that need no build live in public/ (coil, maze, wpilot).
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
        siege: here('siege/index.html'),
        drakonas: here('drakonas/index.html'),
      },
    },
  },
});
