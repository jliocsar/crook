import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const CATALOG_PATH = '/stories/'
const KITCHEN_FOLDER = new URL('stories/kitchen/', import.meta.url).pathname
const WEB_SOURCE_FOLDER = new URL('src/', import.meta.url).pathname
const CATALOG_STYLESHEET = new URL('stories/stories.css', import.meta.url).pathname

export default defineConfig({
  appType: 'mpa',
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      injectRegister: false,
      manifest: false,
      devOptions: { enabled: false },
      pwaAssets: { config: true, overrideManifestIcons: false, injectThemeColor: false },
    }),
    {
      name: 'crook:stories-at-root',
      configureServer: (server) => {
        server.watcher.on('add', (file) => {
          if (file.startsWith(KITCHEN_FOLDER)) {
            server.watcher.emit('change', CATALOG_STYLESHEET)
          }
        })
        server.middlewares.use((request, response, next) => {
          if (request.url === '/') {
            response.writeHead(302, { Location: CATALOG_PATH })
            response.end()

            return
          }

          next()
        })
      },
    },
  ],
  resolve: {
    tsconfigPaths: true,
    alias: [{ find: /^@crook\/web\//u, replacement: WEB_SOURCE_FOLDER }],
  },
})
