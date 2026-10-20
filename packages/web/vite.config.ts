import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { LIGHT_GROUND } from './brand/Brand.ts'
import { scopeLightSplashLinks } from './brand/SplashLinks.ts'
import { CONTENT_SECURITY_POLICY } from './src/csp/ContentSecurityPolicy.ts'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'ServiceWorker.ts',
      injectRegister: false,
      useCredentials: true,
      manifest: {
        name: 'crook',
        short_name: 'crook',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        background_color: LIGHT_GROUND,
        theme_color: LIGHT_GROUND,
      },
      pwaAssets: { config: true, overrideManifestIcons: true, injectThemeColor: false },
      injectManifest: {
        rollupFormat: 'iife',
        injectionPoint: 'self.precacheManifest',
        globPatterns: [
          '**/*.{html,js,css}',
          '**/*-latin-wght-normal-*.woff2',
          '**/*-latin-ext-wght-normal-*.woff2',
        ],
      },
    }),
    {
      name: 'crook:scope-light-splash-links',
      enforce: 'post',
      transformIndexHtml: { order: 'post', handler: scopeLightSplashLinks },
    },
  ],
  resolve: { tsconfigPaths: true },
  preview: { headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY } },
})
