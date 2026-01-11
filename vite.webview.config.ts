import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist/webview',
    rollupOptions: {
      input: {
        statistics: resolve(__dirname, 'src/webview/statistics/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name].[ext]'
      }
    },
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true
  },
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});
