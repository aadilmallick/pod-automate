import 'dotenv/config'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.API_PROXY_TARGET ?? `http://${process.env.API_PROXY_HOST ?? 'localhost'}:${process.env.API_PUBLIC_PORT ?? process.env.PORT ?? '3000'}`

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.WEB_BIND_HOST ?? 'localhost',
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': apiProxyTarget,
      '/uploads': apiProxyTarget,
    },
  },
})
