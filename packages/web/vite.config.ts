import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { LIGHT_GROUND } from './brand/Brand.ts'
import { scopeLightSplashLinks } from './brand/SplashLinks.ts'
import { CONTENT_SECURITY_POLICY } from './src/csp/ContentSecurityPolicy.ts'
import { HUB_CLIENT_PATH } from './src/rpc/HubConnection.ts'
import { HEALTH_PATH } from './src/rpc/SessionCheck.ts'

const DEV_ENV_PREFIX = 'CROOK_'

const devHubProxy = (env: Record<string, string>): Record<string, ProxyOptions> =>
  pipe(
    Option.all({
      target: Option.fromNullishOr(env['CROOK_DEV_HUB_URL']),
      email: Option.fromNullishOr(env['CROOK_OWNER_EMAIL']),
      origin: Option.fromNullishOr(env['CROOK_HUB_ORIGIN']),
    }),
    Option.map(({ target, email, origin }) => {
      const headers = { 'X-ExeDev-Email': email, Origin: origin }

      return {
        [HUB_CLIENT_PATH]: { target, ws: true, headers },
        [HEALTH_PATH]: { target, headers },
      }
    }),
    Option.getOrElse(() => ({})),
  )

export default defineConfig(({ mode }) => ({
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
  server: { proxy: devHubProxy(loadEnv(mode, import.meta.dirname, DEV_ENV_PREFIX)) },
  preview: { headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY } },
}))
