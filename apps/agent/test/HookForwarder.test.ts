import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunPath from '@effect/platform-bun/BunPath'
import { describe, expect, it, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Schedule from 'effect/Schedule'

import { hookSocketPath, isBareHookCall } from '@crook/agent/HookForwarder'
import { CrookHookSocketPath, HookInbox } from '@crook/agent/HookInbox'
import { ClaudeSessionId } from '@crook/domain/Ids'

const SESSION = ClaudeSessionId.make('84f3659c-7fcf-4280-8580-b82ae5fd8f91')
const ENTRY_MODULE = new URL('../src/main.ts', import.meta.url).pathname
const FORWARDER_MODULE = new URL('../src/HookForwarder.ts', import.meta.url).pathname
const LARGE_OUTPUT_LENGTH = 4 * 1024 * 1024
const OVERLONG_SOCKET_PATH_LENGTH = 200

const preToolUse = (output: string) =>
  JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: SESSION,
    tool_name: 'Bash',
    tool_input: { command: output },
    tool_use_id: 'toolu_01XXC3',
  })

const ENVIRONMENTS: readonly Readonly<Record<string, string>>[] = [
  { CROOK_HOOK_SOCKET_PATH: '/run/hook.sock', XDG_STATE_HOME: '/state', HOME: '/home/jc' },
  { XDG_STATE_HOME: '/state', HOME: '/home/jc' },
  { XDG_STATE_HOME: 'relative/state', HOME: '/home/jc' },
  { HOME: '/home/jc' },
  { CROOK_HOOK_SOCKET_PATH: '', XDG_STATE_HOME: '/state', HOME: '/home/jc' },
  { XDG_STATE_HOME: '', HOME: '/home/jc' },
]

const runHookCommand = Effect.fn('runHookCommand')(function* (
  environment: Readonly<Record<string, string>>,
  payload: string,
) {
  const child = Bun.spawn(['bun', ENTRY_MODULE, 'hook'], {
    env: { ...environment, PATH: Bun.env.PATH },
    stdin: new TextEncoder().encode(payload),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return yield* Effect.promise(() =>
    Promise.all([child.exited, child.stdout.text(), child.stderr.text()]),
  )
})

const staticImportsOf = (source: string) =>
  pipe(
    new Bun.Transpiler({ loader: 'ts' }).scanImports(source),
    Arr.filter((found) => found.kind === 'import-statement'),
    Arr.map((found) => found.path),
  )

describe('The hook command', () => {
  it.effect('names the socket the agent listens on, whatever the environment', () =>
    Effect.gen(function* () {
      const expected = yield* Effect.forEach(ENVIRONMENTS, (environment) =>
        CrookHookSocketPath.parse(ConfigProvider.fromUnknown(environment)),
      )

      expect(Arr.map(ENVIRONMENTS, hookSocketPath)).toEqual(expected)
      expect(hookSocketPath({ HOME: '' })).toBeUndefined()
    }),
  )

  it('takes the fast way only when hook is the whole command line', () => {
    expect(isBareHookCall(['bun', '/main.ts', 'hook'])).toBe(true)
    expect(isBareHookCall(['bun', '/main.ts', 'hook', '--help'])).toBe(false)
    expect(isBareHookCall(['bun', '/main.ts', 'hook-settings'])).toBe(false)
    expect(isBareHookCall(['bun', '/main.ts'])).toBe(false)
  })
})

layer(Layer.mergeAll(BunFileSystem.layer, BunPath.layer), { excludeTestServices: true })(
  'Over a real socket',
  (real) => {
    const inboxAt = Effect.fn('inboxAt')(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped()
      const socket = path.join(directory, 'hook.sock')
      const context = yield* Layer.build(
        Layer.provide(
          HookInbox.layer,
          ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_HOOK_SOCKET_PATH: socket })),
        ),
      )

      return { socket, inbox: Context.get(context, HookInbox) }
    })

    real.effect('loads nothing else before it has forwarded, Effect included', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const importsOf = (module: string) =>
          Effect.map(fileSystem.readFileString(module), staticImportsOf)
        const reached = [
          ...(yield* importsOf(ENTRY_MODULE)),
          ...(yield* importsOf(FORWARDER_MODULE)),
        ]

        expect(reached).toEqual(['@crook/agent/HookForwarder'])
      }),
    )

    real.effect('carries a payload to the agent, printing nothing and exiting 0', () =>
      Effect.gen(function* () {
        const { socket, inbox } = yield* inboxAt()
        const outcome = yield* runHookCommand(
          { CROOK_HOOK_SOCKET_PATH: socket },
          preToolUse('echo hi'),
        )

        expect(outcome).toEqual([0, '', ''])
        expect(
          yield* inbox.position.pipe(
            Effect.repeat({
              until: (reached) => reached >= 1,
              schedule: Schedule.spaced('1 millis'),
            }),
          ),
        ).toBe(1)
      }).pipe(Effect.scoped),
    )

    real.effect('stays silent and exits 0 on a socket path no socket can have', () =>
      Effect.gen(function* () {
        const result = yield* runHookCommand(
          { CROOK_HOOK_SOCKET_PATH: `/${'x'.repeat(OVERLONG_SOCKET_PATH_LENGTH)}` },
          '{}',
        )

        expect(result).toEqual([0, '', ''])
      }),
    )

    real.effect('carries a payload far larger than one write of the socket', () =>
      Effect.gen(function* () {
        const { socket, inbox } = yield* inboxAt()
        const outcome = yield* runHookCommand(
          { CROOK_HOOK_SOCKET_PATH: socket },
          preToolUse('x'.repeat(LARGE_OUTPUT_LENGTH)),
        )

        expect(outcome).toEqual([0, '', ''])
        expect(
          yield* inbox.position.pipe(
            Effect.repeat({
              until: (reached) => reached >= 1,
              schedule: Schedule.spaced('1 millis'),
            }),
          ),
        ).toBe(1)
      }).pipe(Effect.scoped),
    )

    real.effect('prints nothing and exits 0 when no agent listens', () =>
      Effect.gen(function* () {
        const { socket } = yield* inboxAt()

        yield* FileSystem.FileSystem.use((fileSystem) => fileSystem.remove(socket))

        expect(
          yield* runHookCommand({ CROOK_HOOK_SOCKET_PATH: socket }, preToolUse('echo hi')),
        ).toEqual([0, '', ''])
      }).pipe(Effect.scoped),
    )
  },
)
