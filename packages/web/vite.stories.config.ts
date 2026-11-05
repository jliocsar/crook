import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const CATALOG_PATH = '/stories/'

export default defineConfig({
  appType: 'mpa',
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    {
      name: 'crook:stories-at-root',
      configureServer: (server) => {
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
  resolve: { tsconfigPaths: true },
})
