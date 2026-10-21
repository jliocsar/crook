import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { HookInbox } from '@crook/agent/HookInbox'
import { PaneScreens } from '@crook/agent/PaneScreens'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { pendingEdit } from '@crook/claude/AskDerivation'
import {
  type HookLedger,
  emptyHookLedger,
  pendingPermissions,
  recordHook,
} from '@crook/claude/HookLedger'
import { PermissionRequestPayload, PreToolUsePayload } from '@crook/claude/HookPayload'
import { LastTurn } from '@crook/claude/LastTurn'
import { dialogFingerprint, parseDialog } from '@crook/claude/ScreenDialog'
import { TranscriptLocator } from '@crook/claude/TranscriptLocator'
import { type Ask, AskOption, EditFile, PermissionAsk, RunCommand } from '@crook/domain/Ask'
import { AskId, ClaudeSessionId } from '@crook/domain/Ids'
import { PatchHunk } from '@crook/domain/TranscriptMessage'
import { HerdrConnectionClosed } from '@crook/herdr/HerdrClient'

import { agentInfo, spikeScreenPath } from './Fixtures'

const SESSION = ClaudeSessionId.make('84f3659c-7fcf-4280-8580-b82ae5fd8f91')
const SESSION_OPTION = Option.some(SESSION)
const COMMAND = 'echo probe-bash-native > bash-native.txt'
const BLOCKED = agentInfo({ agent_status: 'blocked', state_change_seq: 4 })

const bashCall = (toolUseId: string) => [
  new PreToolUsePayload({
    hook_event_name: 'PreToolUse',
    session_id: SESSION,
    tool_name: 'Bash',
    tool_input: { command: COMMAND },
    tool_use_id: toolUseId,
  }),
  new PermissionRequestPayload({
    hook_event_name: 'PermissionRequest',
    session_id: SESSION,
    tool_name: 'Bash',
    tool_input: { command: COMMAND },
  }),
]

const editCall = (filePath: string) => [
  new PermissionRequestPayload({
    hook_event_name: 'PermissionRequest',
    session_id: SESSION,
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: 'hello', new_string: 'goodbye' },
  }),
]

const ledgerOf = (payloads: readonly (PreToolUsePayload | PermissionRequestPayload)[]) =>
  payloads.reduce<HookLedger>(recordHook, emptyHookLedger)

const scriptedScreens = Effect.fn('scriptedScreens')(function* (
  screens: readonly Option.Option<string>[],
) {
  const remaining = yield* Ref.make(screens)
  const reads = yield* Ref.make(0)

  const read = (_pane: string) =>
    Ref.modify(remaining, (current) => [
      current[0] ?? Option.none<string>(),
      current.length > 1 ? current.slice(1) : current,
    ]).pipe(
      Effect.tap(() => Ref.update(reads, (count) => count + 1)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new HerdrConnectionClosed({ method: 'pane.read' })),
          onSome: (screen) => Effect.succeed({ screen, dialog: parseDialog(screen) }),
        }),
      ),
    )

  return { read, reads: Ref.get(reads) }
})

const startAsks = Effect.fn('startAsks')(function* (
  payloads: readonly (PreToolUsePayload | PermissionRequestPayload)[],
  screens: readonly Option.Option<string>[],
) {
  const ledger = yield* SubscriptionRef.make(ledgerOf(payloads))
  const { read, reads } = yield* scriptedScreens(screens)
  const context = yield* Layer.build(
    Layer.provide(PendingAsks.layerFromServices, [
      HookInbox.layerTest(ledger),
      Layer.mock(PaneScreens, { read }),
      Layer.mock(TranscriptLocator, { locate: () => Effect.succeedNone }),
      Layer.mock(LastTurn, { read: () => Effect.succeed([]) }),
    ]),
  )

  return { asks: Context.get(context, PendingAsks), ledger, reads }
})

const screenText = Effect.fn('screenText')(function* (name: string) {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.readFileString(spikeScreenPath(name))
})

layer(BunFileSystem.layer, { excludeTestServices: true })('PendingAsks', (it) => {
  it.effect("reads a blocked agent's ask from its hook, with the options its dialog shows", () =>
    Effect.gen(function* () {
      const screen = yield* screenText('12-native-bash-t20')
      const { asks } = yield* startAsks(bashCall('toolu_01XXC3'), [Option.some(screen)])
      const ask = yield* asks.askOf(BLOCKED, SESSION_OPTION, yield* asks.mark)

      expect(ask).toEqual(
        Option.some(
          new PermissionAsk({
            id: AskId.make('toolu_01XXC3'),
            source: 'hook',
            tool: 'Bash',
            plugin: Option.none(),
            action: new RunCommand({ command: COMMAND }),
            options: [
              new AskOption({ number: 1, label: 'Yes', choice: 'yes' }),
              new AskOption({
                number: 2,
                label:
                  'Yes, and always allow access to /home/jliocsar/Projects/crook/tmp/spikes/scratch-80/sandbox from this project',
                choice: 'always',
              }),
              new AskOption({
                number: 3,
                label: 'Yes, and switch to auto mode · auto mode handles these prompts for you',
                choice: 'other',
              }),
              new AskOption({ number: 4, label: 'No', choice: 'no' }),
            ],
            dialog: Option.map(parseDialog(screen), dialogFingerprint),
          }),
        ),
      )
    }),
  )

  it.effect('reads the screen on every refresh, and keeps the ask while the dialog stays', () =>
    Effect.gen(function* () {
      const screen = yield* screenText('12-native-bash-t20')
      const { asks, reads } = yield* startAsks(bashCall('toolu_01XXC3'), [Option.some(screen)])
      const first = yield* asks.askOf(BLOCKED, SESSION_OPTION, 0)
      const again = yield* asks.askOf(BLOCKED, SESSION_OPTION, 0)

      expect(again).toEqual(first)
      expect(yield* reads).toBe(2)
    }),
  )

  it.effect('follows a dialog that changes while herdr reports the same blocked episode', () =>
    Effect.gen(function* () {
      const first = yield* screenText('40-parallel-blocked-1')
      const second = yield* screenText('42-parallel-blocked-2')
      const { asks } = yield* startAsks([], [Option.some(first), Option.some(second)])
      const before = yield* asks.askOf(BLOCKED, Option.none(), 0)
      const after = yield* asks.askOf(BLOCKED, Option.none(), 0)

      expect(Option.map(before, (ask) => ask.id)).not.toEqual(Option.map(after, (ask) => ask.id))
    }),
  )

  it.effect('reads the screen again after a failed read instead of keeping what it lacked', () =>
    Effect.gen(function* () {
      const screen = yield* screenText('12-native-bash-t20')
      const { asks } = yield* startAsks(bashCall('toolu_01XXC3'), [
        Option.none(),
        Option.some(screen),
      ])
      const optionsOf = (ask: Option.Option<Ask>) =>
        Option.flatMap(ask, (found) =>
          Match.value(found).pipe(
            Match.tag('PermissionAsk', (permission) => Option.some(permission.options.length)),
            Match.orElse(() => Option.none()),
          ),
        )
      const blind = yield* asks.askOf(BLOCKED, SESSION_OPTION, 0)
      const sighted = yield* asks.askOf(BLOCKED, SESSION_OPTION, 0)

      expect([optionsOf(blind), optionsOf(sighted)]).toEqual([Option.some(0), Option.some(4)])
    }),
  )

  it.effect('forgets a declined permission once the agent is idle, but not while it works', () =>
    Effect.gen(function* () {
      const screen = yield* screenText('12-native-bash-t20')
      const { asks } = yield* startAsks(bashCall('toolu_01XXC3'), [Option.some(screen)])
      const mark = yield* asks.mark

      yield* asks.askOf(agentInfo({ agent_status: 'working' }), SESSION_OPTION, mark)
      const stillPending = yield* asks.askOf(BLOCKED, SESSION_OPTION, mark)
      yield* asks.askOf(agentInfo({ agent_status: 'idle' }), SESSION_OPTION, mark)
      const afterIdle = yield* asks.askOf(BLOCKED, SESSION_OPTION, mark)

      expect(Option.map(stillPending, (ask) => ask.id)).toEqual(Option.some('toolu_01XXC3'))
      expect(Option.map(afterIdle, (ask) => ask.id.startsWith('screen-'))).toEqual(
        Option.some(true),
      )
    }),
  )

  it.effect('drops the hook records of a session no herd agent runs', () =>
    Effect.gen(function* () {
      const { asks, ledger } = yield* startAsks(bashCall('toolu_01XXC3'), [Option.some('')])
      const mark = yield* asks.mark

      yield* asks.retain([SESSION], mark)
      const kept = pendingPermissions(yield* SubscriptionRef.get(ledger), SESSION)
      yield* asks.retain([], mark)
      const dropped = pendingPermissions(yield* SubscriptionRef.get(ledger), SESSION)

      expect([kept.length, dropped.length]).toEqual([1, 0])
    }),
  )

  it.effect('works out the diff of an Edit from the file as it is on disk', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped()
      const filePath = `${directory}/greeting.txt`

      yield* fileSystem.writeFileString(filePath, 'hello\n')
      const { asks } = yield* startAsks(editCall(filePath), [Option.some('')])
      const ask = yield* asks.askOf(BLOCKED, SESSION_OPTION, 0)

      expect(Option.map(Option.flatMap(ask, pendingEdit), (pending) => pending.edit)).toEqual(
        Option.some(
          new EditFile({
            filePath,
            oldString: 'hello',
            newString: 'goodbye',
            replaceAll: false,
            patch: Option.some([
              new PatchHunk({
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                lines: ['-hello', '+goodbye'],
              }),
            ]),
          }),
        ),
      )
    }).pipe(Effect.scoped),
  )

  it.effect('has no ask for an agent that is not blocked', () =>
    Effect.gen(function* () {
      const screen = yield* screenText('12-native-bash-t20')
      const { asks, reads } = yield* startAsks(bashCall('toolu_01XXC3'), [Option.some(screen)])

      expect(yield* asks.askOf(agentInfo(), SESSION_OPTION, 0)).toEqual(Option.none())
      expect(yield* reads).toBe(0)
    }),
  )
})
