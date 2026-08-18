import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Renderer build: the desktop shell (title bar + web UI mount) compiled from
 * src/renderer into dist/renderer with relative asset paths so Electron can
 * load it over file://.
 */
export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  resolve: {
    alias: [
      { find: /^node:module$/, replacement: fileURLToPath(new URL('./src/renderer/node-module-stub.ts', import.meta.url)) },
      { find: /^@deepseek-ai\/dsh-client-web$/, replacement: fileURLToPath(new URL('../../packages/client/web/src/boot.tsx', import.meta.url)) },
      { find: /^@deepseek-ai\/dsh-client-web-react$/, replacement: fileURLToPath(new URL('../../packages/client/web-react/src/index.ts', import.meta.url)) },
      { find: /^@deepseek-ai\/dsh-client-ui-slots$/, replacement: fileURLToPath(new URL('../../packages/client/ui-slots/src/index.ts', import.meta.url)) },
      { find: /^@deepseek-ai\/dsh-client-ui-primitives$/, replacement: fileURLToPath(new URL('../../packages/client/ui-primitives/src/index.ts', import.meta.url)) },
      { find: /^@deepseek-ai\/dsh-client-ui-attachment$/, replacement: fileURLToPath(new URL('../../packages/client/ui-attachment/src/index.ts', import.meta.url)) },
      { find: /^@deepseek-ai\/dsh-client-schema-form$/, replacement: fileURLToPath(new URL('../../packages/client/schema-form/src/index.ts', import.meta.url)) },
      { find: /^@deepseek-ai\/dsh-client-modules\/client$/, replacement: fileURLToPath(new URL('../../packages/client/modules/src/client/index.ts', import.meta.url)) },
      { find: /^@deepseek-ai\/dsh-client-ui-theme\//, replacement: fileURLToPath(new URL('../../packages/client/ui-theme/src/', import.meta.url)) },
    ],
  },
  define: {
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
  },
})
