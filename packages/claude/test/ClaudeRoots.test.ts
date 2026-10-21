import { expect, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Path from 'effect/Path'

import { ClaudeRootNotAbsolute, claudeRoots } from '@crook/claude/ClaudeRoots'

const rootsWith = (environment: Record<string, string>) =>
  claudeRoots.pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(environment)),
  )

layer(Path.layer)('claudeRoots', (it) => {
  it.effect('defaults to ~/.claude plus the CLAUDE_CONFIG_DIR crook itself runs with', () =>
    Effect.gen(function* () {
      expect(yield* rootsWith({ HOME: '/home/dev' })).toEqual(['/home/dev/.claude'])
      expect(
        yield* rootsWith({ HOME: '/home/dev', CLAUDE_CONFIG_DIR: '/home/dev/.claude-work' }),
      ).toEqual(['/home/dev/.claude', '/home/dev/.claude-work'])
    }),
  )

  it.effect('takes a comma list from CROOK_CLAUDE_ROOTS instead of the default', () =>
    Effect.gen(function* () {
      expect(
        yield* rootsWith({
          HOME: '/home/dev',
          CROOK_CLAUDE_ROOTS: '/home/dev/.claude, /home/dev/.claude-work,,',
          CLAUDE_CONFIG_DIR: '/home/dev/.claude-work',
        }),
      ).toEqual(['/home/dev/.claude', '/home/dev/.claude-work'])
    }),
  )

  it.effect('refuses a root that is not an absolute path, such as an unexpanded ~', () =>
    Effect.gen(function* () {
      const refused = yield* rootsWith({
        HOME: '/home/dev',
        CROOK_CLAUDE_ROOTS: '/home/dev/.claude,~/.claude-work',
      }).pipe(Effect.flip)

      expect(refused).toEqual(new ClaudeRootNotAbsolute({ root: '~/.claude-work' }))
    }),
  )
})
