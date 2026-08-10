import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

function rendererCsp(): Plugin {
  let development = false
  return {
    name: 'kizami-renderer-csp',
    configResolved(config) {
      development = config.command === 'serve'
    },
    transformIndexHtml(html) {
      const connectSource = development ? "connect-src 'self' ws:" : "connect-src 'none'"
      return html.replace('__KIZAMI_CONNECT_SRC__', connectSource)
    }
  }
}

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [react(), rendererCsp()]
  }
})
