import { describe, expect, it } from '@effect/vitest'

import { compileArguments } from '@crook/release/Build'

const WORKSPACE = { root: '/work/crook', output: '/work/crook/dist' }

describe('Build.compileArguments', () => {
  it('embeds the web build in the hub, and nothing in the agent', () => {
    expect(compileArguments({ app: 'hub', target: 'linux-x64' }, WORKSPACE)).toEqual([
      'build',
      '--compile',
      '--no-compile-autoload-dotenv',
      '--no-compile-autoload-bunfig',
      '--target=bun-linux-x64',
      '--outfile=/work/crook/dist/crook-hub-linux-x64',
      '--asset=/work/crook/packages/web/dist',
      '/work/crook/packages/hub/src/main.ts',
    ])
    expect(compileArguments({ app: 'agent', target: 'darwin-arm64' }, WORKSPACE)).toEqual([
      'build',
      '--compile',
      '--no-compile-autoload-dotenv',
      '--no-compile-autoload-bunfig',
      '--target=bun-darwin-arm64',
      '--outfile=/work/crook/dist/crook-agent-darwin-arm64',
      '/work/crook/packages/agent/src/main.ts',
    ])
  })
})
