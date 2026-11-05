import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunPath from '@effect/platform-bun/BunPath'
import { expect, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schedule from 'effect/Schedule'

import { deliverPayload } from '@crook/agent/HookForwarder'
import { HookInbox } from '@crook/agent/HookInbox'
import { ClaudeSessionId } from '@crook/domain/Ids'

const SESSION = ClaudeSessionId.make('84f3659c-7fcf-4280-8580-b82ae5fd8f91')

const encoder = new TextEncoder()

const preToolUse = JSON.stringify({
  hook_event_name: 'PreToolUse',
  session_id: SESSION,
  tool_name: 'Bash',
  tool_input: { command: 'echo single-flush > single.txt', description: 'Write a file' },
  tool_use_id: 'toolu_01XXC3',
})

const permissionRequest = JSON.stringify({
  hook_event_name: 'PermissionRequest',
  session_id: SESSION,
  tool_name: 'Bash',
  tool_input: { command: 'echo single-flush > single.txt', description: 'Write a file' },
})

const socketIn = Effect.fn('socketIn')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped()

  return `${directory}/hook.sock`
})

const configAt = (path: string) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_HOOK_SOCKET_PATH: path }))

const forwardAt = (path: string, text: string) =>
  Effect.callback<void>((resume) => {
    deliverPayload(path, encoder.encode(text), () => {
      resume(Effect.void)
    })
  })

const positionReaches = (inbox: HookInbox['Service'], position: number) =>
  inbox.position.pipe(
    Effect.repeat({
      until: (reached) => reached >= position,
      schedule: Schedule.spaced('1 millis'),
    }),
  )

const inboxAt = Effect.fn('inboxAt')(function* (path: string) {
  const context = yield* Layer.build(Layer.provide(HookInbox.layer, configAt(path)))

  return Context.get(context, HookInbox)
})

layer(Layer.mergeAll(BunFileSystem.layer, BunPath.layer), { excludeTestServices: true })(
  'HookInbox',
  (it) => {
    it.effect('records what the hook command forwards, pairing the permission with its call', () =>
      Effect.gen(function* () {
        const path = yield* socketIn()
        const inbox = yield* inboxAt(path)

        yield* forwardAt(path, preToolUse)
        yield* forwardAt(path, permissionRequest)

        expect(yield* positionReaches(inbox, 2)).toBe(2)
        expect(
          (yield* inbox.pendingFor(SESSION)).map((pending) => [
            pending.toolName,
            pending.toolUseId,
          ]),
        ).toEqual([['Bash', Option.some('toolu_01XXC3')]])
      }).pipe(Effect.scoped),
    )

    it.effect('drops a payload it cannot read and keeps listening', () =>
      Effect.gen(function* () {
        const path = yield* socketIn()
        const inbox = yield* inboxAt(path)

        yield* forwardAt(path, 'not a hook payload')
        yield* forwardAt(path, preToolUse)

        expect(yield* positionReaches(inbox, 1)).toBe(1)
      }).pipe(Effect.scoped),
    )

    it.effect('lets the hook command succeed quietly when no agent listens', () =>
      Effect.gen(function* () {
        const path = yield* socketIn()
        const exit = yield* forwardAt(path, preToolUse).pipe(Effect.exit)

        expect(Exit.isSuccess(exit)).toBe(true)
      }).pipe(Effect.scoped),
    )
  },
)
