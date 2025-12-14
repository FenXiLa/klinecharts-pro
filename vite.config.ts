/// <reference types="vite/client" />

import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin()],
  build: {
    cssTarget: 'chrome61',
    sourcemap: true,
    rollupOptions: {
      external: [
        'klinecharts',
        // CCXT 相关的 Node.js 模块（浏览器环境不支持）
        'ccxt',
        'node:http',
        'node:https',
        'node:url',
        'node:crypto',
        'node:stream',
        'node:util',
        'node:buffer',
        'node:events',
        'http-proxy-agent',
        'https-proxy-agent',
        'ws'
      ],
      output: {
        assetFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'style.css') {
            return 'klinecharts-pro.css'
          }
        },
        globals: {
          klinecharts: 'klinecharts',
          ccxt: 'ccxt'
        },
      },
    },
    lib: {
      entry: './src/index.ts',
      name: 'klinechartspro',
      fileName: (format) => {
        if (format === 'es') {
          return 'klinecharts-pro.js'
        }
        if (format === 'umd') {
          return 'klinecharts-pro.umd.js'
        }
      }
    }
  }
})
