import 'dotenv/config'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.API_PROXY_TARGET ?? `http://${process.env.API_PROXY_HOST ?? 'localhost'}:${process.env.API_PUBLIC_PORT ?? process.env.PORT ?? '3000'}`
const publicSiteUrl = (process.env.PUBLIC_SITE_URL?.trim() || process.env.WEB_URL?.trim() || `http://${process.env.PUBLIC_WEB_HOST ?? 'localhost'}:${process.env.WEB_PORT ?? '5173'}`).replace(/\/$/, '')

export default defineConfig({
  plugins: [react(), {
    name: 'public-site-url-metadata',
    transformIndexHtml(html: string) { return html.replace(/__PUBLIC_SITE_URL__/g, publicSiteUrl) },
  }],
  server: {
    host: process.env.WEB_BIND_HOST ?? 'localhost',
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': apiProxyTarget,
      '/uploads': apiProxyTarget,
      '/mockup-assets': apiProxyTarget,
    },
  },
})
