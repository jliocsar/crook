import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { HookInbox } from '@crook/agent/HookInbox'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { editToPatch } from '@crook/claude/AskDerivation'
import { type HookLedger, emptyHookLedger, recordHook } from '@crook/claude/HookLedger'
import { PermissionRequestPayload, PreToolUsePayload } from '@crook/claude/HookPayload'
import { LastTurn } from '@crook/claude/LastTurn'
import { TranscriptLocator } from '@crook/claude/TranscriptLocator'
import { AskOption, EditFile, PermissionAsk, RunCommand } from '@crook/domain/Ask'
import { AskId, ClaudeSessionId } from '@crook/domain/Ids'
import { PatchHunk } from '@crook/domain/TranscriptMessage'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type SentRequest,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import { PaneReadMethod } from '@crook/herdr/Methods'

import { agentInfo } from './Fixtures'

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

const startAsks = Effect.fn('startAsks')(function* (
  payloads: readonly (PreToolUsePayload | PermissionRequestPayload)[],
  screen: string,
) {
  const ledger = yield* SubscriptionRef.make(ledgerOf(payloads))
  const sent = yield* Queue.unbounded<SentRequest>()
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const read = scriptedResult(PaneReadMethod, {
    type: 'pane_read',
    read: { pane_id: BLOCKED.pane_id, text: screen, truncated: false },
  })
  const context = yield* Layer.build(
    Layer.provide(PendingAsks.layerFromServices, [
      HookInbox.layerTest(ledger),
      HerdrClient.layerTest({ responses: [read], events, sent }),
      Layer.mock(TranscriptLocator, { locate: () => Effect.succeedNone }),
      Layer.mock(LastTurn, { read: () => Effect.succeed([]) }),
    ]),
  )

  return { asks: Context.get(context, PendingAsks), ledger, reads: Queue.clear(sent) }
})

const bashScreen = Effect.fn('bashScreen')(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.readFileString(
    `${import.meta.dirname}/fixtures/spike-80/screens/12-native-bash-t20.txt`,
  )
})

layer(BunFileSystem.layer, { excludeTestServices: true })('PendingAsks', (it) => {
  it.effect("reads a blocked agent's ask from its hook, with the options its dialog shows", () =>
    Effect.gen(function* () {
      const { asks } = yield* startAsks(bashCall('toolu_01XXC3'), yield* bashScreen())
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
          }),
        ),
      )
    }),
  )

  it.effect('keeps the ask it derived while the agent stays in the same blocked episode', () =>
    Effect.gen(function* () {
      const { asks, reads } = yield* startAsks(bashCall('toolu_01XXC3'), yield* bashScreen())
      const first = yield* asks.askOf(BLOCKED, SESSION_OPTION, 0)
      const again = yield* asks.askOf(BLOCKED, SESSION_OPTION, 0)

      expect(again).toEqual(first)
      expect(yield* reads).toHaveLength(1)
    }),
  )

  it.effect('forgets a declined permission once the agent is idle, but not while it works', () =>
    Effect.gen(function* () {
      const { asks } = yield* startAsks(bashCall('toolu_01XXC3'), yield* bashScreen())
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

  it.effect('works out the diff of an Edit from the file as it is on disk', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped()
      const filePath = `${directory}/greeting.txt`

      yield* fileSystem.writeFileString(filePath, 'hello\n')
      const { asks } = yield* startAsks(editCall(filePath), '')
      const ask = yield* asks.askOf(BLOCKED, SESSION_OPTION, 0)

      expect(Option.flatMap(ask, editToPatch)).toEqual(
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
      const { asks, reads } = yield* startAsks(bashCall('toolu_01XXC3'), yield* bashScreen())

      expect(yield* asks.askOf(agentInfo(), SESSION_OPTION, 0)).toEqual(Option.none())
      expect(yield* reads).toEqual([])
    }),
  )
})
