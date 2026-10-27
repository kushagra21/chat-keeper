import { defineConfig } from 'vite';

// Builds the read-only viewer that goes inside every exported archive.
// The main app imports the result as a string (build-archive/viewer.js?raw).
export default defineConfig({
  build: {
    outDir: 'build-archive',
    emptyOutDir: true,
    lib: {
      entry: 'src/archive-entry.ts',
      formats: ['iife'],
      name: 'ChatKeeperArchive',
      fileName: () => 'viewer.js',
    },
  },
});
