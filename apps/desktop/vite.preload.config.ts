import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Sandboxed preload build: one CommonJS bundle. Electron sandboxed preload
 * scripts run in a limited CommonJS environment and cannot load ESM.
 */
export default defineConfig({
  build: {
    outDir: fileURLToPath(new URL('./lib', import.meta.url)),
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/preload.ts', import.meta.url)),
      formats: ['cjs'],
      fileName: (format) => (format === 'cjs' ? 'preload.cjs' : 'preload.js'),
    },
    rollupOptions: {
      external: ['electron'],
      output: {
        format: 'cjs',
      },
    },
    sourcemap: false,
    minify: false,
  },
})
