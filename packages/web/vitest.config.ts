import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'dom',
          include: ['test/**/*.test.tsx'],
          environment: 'happy-dom',
          css: { include: [/index\.css/u] },
          setupFiles: ['./test/DomSetup.ts'],
        },
      },
      {
        extends: true,
        test: { name: 'node', include: ['test/**/*.test.ts'], environment: 'node' },
      },
    ],
  },
})
