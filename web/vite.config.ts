import { defineConfig } from 'vite';

// Shared art and sound live in shared/assets and are served as the public dir, so the web and
// Godot clients use the very same files.
export default defineConfig({
  publicDir: '../shared/assets',
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
