import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  // Served by the arena Worker at https://arena.<domain>/fighter/.
  base: '/fighter/',
  server: { port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    outDir: fileURLToPath(new URL('../../apps/arena/public/fighter', import.meta.url)),
    emptyOutDir: true,
  },
});
