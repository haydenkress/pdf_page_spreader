import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { rollupOptions: { output: { manualChunks: {
    'pdf-renderer': ['pdfjs-dist'],
    'pdf-export': ['pdf-lib'],
  } } } },
});
