import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import {
  type AskEvidence,
  deriveAsk,
  optionChoice,
  withEditPatch,
} from '@crook/claude/AskDerivation'
import {
  type HookLedger,
  dismissBefore,
  emptyHookLedger,
  pendingPermission,
  recordHook,
} from '@crook/claude/HookLedger'
import type { HookPayload } from '@crook/claude/HookPayload'
import { firstUnmatchedToolUse } from '@crook/claude/LastTurn'
import { keysToSelect, parseDialog } from '@crook/claude/PermissionDialog'
import { Ask } from '@crook/domain/Ask'
import { ClaudeSessionId } from '@crook/domain/Ids'

import { platform, spikeHooks, spikeScreen, spikeTranscript } from './Fixtures'

const NATIVE_SESSION = ClaudeSessionId.make('84f3659c-7fcf-4280-8580-b82ae5fd8f91')
const QUESTION_SESSION = ClaudeSessionId.make('dec38383-2aff-4b84-9c66-50da3eeaf74c')
const EPISODE = { terminal: 'term_65e4961524c522', stateChangeSeq: 8 }

const encodeAsk = Schema.encodeSync(Ask)

const replay = (payloads: readonly HookPayload[], ledger: HookLedger = emptyHookLedger) =>
  payloads.reduce(recordHook, ledger)

const sessionOf = (payloads: readonly HookPayload[]) =>
  Option.getOrElse(
    Option.map(Option.fromUndefinedOr(payloads[0]), (payload) => payload.session_id),
    () => NATIVE_SESSION,
  )

const noEvidence = (screen: string): AskEvidence => ({
  episode: EPISODE,
  screen: Option.some(screen),
  dialog: parseDialog(screen),
  pending: Option.none(),
  toolUse: Option.none(),
})

layer(platform)('the permission dialog on the screen', (it) => {
  it.effect('reads a Bash dialog: header, description, command and the four options', () =>
    Effect.gen(function* () {
      const dialog = Option.getOrThrow(parseDialog(yield* spikeScreen('12-native-bash-t20')))

      expect(dialog.kind).toBe('permission')
      expect(dialog.header).toBe('Bash command')
      expect(dialog.plugin).toEqual(Option.none())
      expect(dialog.subject).toEqual(Option.some('Write probe text to a file'))
      expect(dialog.body).toEqual(['echo probe-bash-native > bash-native.txt'])
      expect(dialog.prompt).toEqual(['Do you want to proceed?'])
      expect(dialog.options.map((option) => [option.number, option.selected])).toEqual([
        [1, true],
        [2, false],
        [3, false],
        [4, false],
      ])
      expect(dialog.options.map((option) => optionChoice(option.label))).toEqual([
        'yes',
        'always',
        'other',
        'no',
      ])
    }),
  )

  it.effect('reads an Edit and a Write dialog with the file they name', () =>
    Effect.gen(function* () {
      const edit = Option.getOrThrow(parseDialog(yield* spikeScreen('20-edit-blocked')))
      const write = Option.getOrThrow(parseDialog(yield* spikeScreen('22-write-blocked')))

      expect([edit.header, edit.subject, edit.body]).toEqual([
        'Edit file',
        Option.some('seed.txt'),
        ['1 -hello', '1 +world'],
      ])
      expect(edit.options.map((option) => optionChoice(option.label))).toEqual([
        'yes',
        'always',
        'no',
      ])
      expect([write.header, write.subject]).toEqual(['Create file', Option.some('note.txt')])
    }),
  )

  it.effect('reads the plugin and drops the queue counter from a codemode dialog', () =>
    Effect.gen(function* () {
      const first = Option.getOrThrow(parseDialog(yield* spikeScreen('110-codemode6-blocked')))
      const queued = Option.getOrThrow(parseDialog(yield* spikeScreen('112-codemode6-zombie')))

      expect([first.header, first.plugin, first.body]).toEqual([
        'Bash command',
        Option.some('codemode'),
        ['echo cm6-bash > cm6-bash.txt'],
      ])
      expect(first.options.map((option) => option.label)).toEqual(['Yes', 'No'])
      expect([queued.header, queued.plugin]).toEqual(['Bash command', Option.some('codemode')])
    }),
  )

  it.effect('reads an AskUserQuestion dialog with each option and its description', () =>
    Effect.gen(function* () {
      const dialog = Option.getOrThrow(parseDialog(yield* spikeScreen('80-ask-blocked')))

      expect(dialog.kind).toBe('question')
      expect(dialog.header).toBe('Color')
      expect(dialog.body).toEqual(['Which color do you prefer?'])
      expect(dialog.options.map((option) => [option.number, option.label, option.details])).toEqual(
        [
          [1, 'Red', ['warm']],
          [2, 'Green', ['calm']],
          [3, 'Blue', ['cool']],
          [4, 'Type something.', []],
          [5, 'Chat about this', []],
        ],
      )
    }),
  )

  it.effect('finds no dialog on an idle screen, even one that lists numbered choices', () =>
    Effect.gen(function* () {
      expect(parseDialog(yield* spikeScreen('70-ask-blocked'))).toEqual(Option.none())
    }),
  )

  it.effect('moves the cursor from the selected option and confirms', () =>
    Effect.gen(function* () {
      const dialog = Option.getOrThrow(parseDialog(yield* spikeScreen('12-native-bash-t20')))

      expect(keysToSelect(dialog, 1)).toEqual(Option.some(['enter']))
      expect(keysToSelect(dialog, 4)).toEqual(Option.some(['down', 'down', 'down', 'enter']))
      expect(keysToSelect(dialog, 5)).toEqual(Option.none())
    }),
  )
})

layer(platform)('the hook ledger', (it) => {
  it.effect('holds the PermissionRequest with the tool_use_id of the PreToolUse before it', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('native-edit-approved')
      const untilAsked = payloads.slice(
        0,
        payloads.findIndex((payload) => payload.hook_event_name === 'PermissionRequest') + 1,
      )
      const pending = Option.getOrThrow(pendingPermission(replay(untilAsked), NATIVE_SESSION))

      expect([pending.toolName, pending.toolUseId]).toEqual([
        'Edit',
        Option.some('toolu_01E7pJi46fPfLt6HWm616tdc'),
      ])
      expect(pendingPermission(replay(payloads), NATIVE_SESSION)).toEqual(Option.none())
    }),
  )

  it.effect('keeps a declined ask, since no hook fires, until it is dismissed', () =>
    Effect.gen(function* () {
      const ledger = replay(yield* spikeHooks('native-bash-declined-no'))

      expect(Option.isSome(pendingPermission(ledger, NATIVE_SESSION))).toBe(true)
      expect(
        pendingPermission(dismissBefore(ledger, NATIVE_SESSION, ledger.received), NATIVE_SESSION),
      ).toEqual(Option.none())
      expect(dismissBefore(ledger, NATIVE_SESSION, 0)).toEqual(ledger)
    }),
  )

  it.effect('follows the second dialog of a parallel batch once the first is approved', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('native-parallel-bash-approve-then-esc')
      const pending = Option.getOrThrow(pendingPermission(replay(payloads), NATIVE_SESSION))

      expect(pending.toolUseId).toEqual(Option.some('toolu_01DpzNjNuYom5Ee3nLAGae5h'))
    }),
  )

  it.effect('keeps a codemode ask open after the outer call times out', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('codemode-bash-timeout-then-zombie-approved')
      const beforeApproval = payloads.slice(0, -1)
      const session = sessionOf(payloads)
      const pending = Option.getOrThrow(pendingPermission(replay(beforeApproval), session))

      expect(pending.toolName).toBe('Bash')
      expect(Option.getOrThrow(pending.toolUseId)).toMatch(/^toolu_plugin_/u)
      expect(pendingPermission(replay(payloads), session)).toEqual(Option.none())
    }),
  )
})

layer(platform)('deriveAsk', (it) => {
  it.effect('builds a Bash ask from the hook, with the options read from the screen', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('native-bash-declined-no')
      const screen = yield* spikeScreen('12-native-bash-t20')
      const ask = deriveAsk({
        ...noEvidence(screen),
        pending: pendingPermission(replay(payloads), NATIVE_SESSION),
      })

      expect(encodeAsk(ask)).toEqual({
        _tag: 'PermissionAsk',
        id: 'toolu_01AvVzUkx1YtZSQqhF7Ykrui',
        source: 'hook',
        tool: 'Bash',
        plugin: null,
        action: { _tag: 'RunCommand', command: 'echo probe-bash-native > bash-native.txt' },
        options: [
          { number: 1, label: 'Yes', choice: 'yes' },
          {
            number: 2,
            label:
              'Yes, and always allow access to /home/jliocsar/Projects/crook/tmp/spikes/scratch-80/sandbox from this project',
            choice: 'always',
          },
          {
            number: 3,
            label: 'Yes, and switch to auto mode · auto mode handles these prompts for you',
            choice: 'other',
          },
          { number: 4, label: 'No', choice: 'no' },
        ],
      })
    }),
  )

  it.effect('computes the Edit diff from the file, since the payload carries no patch', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('native-edit-approved')
      const untilAsked = payloads.slice(
        0,
        payloads.findIndex((payload) => payload.hook_event_name === 'PermissionRequest') + 1,
      )
      const ask = deriveAsk({
        ...noEvidence(yield* spikeScreen('20-edit-blocked')),
        pending: pendingPermission(replay(untilAsked), NATIVE_SESSION),
      })

      expect(encodeAsk(withEditPatch(ask, 'hello\n'))).toEqual(
        expect.objectContaining({
          tool: 'Edit',
          action: {
            _tag: 'EditFile',
            filePath: '/home/jliocsar/Projects/crook/tmp/spikes/scratch-80/sandbox/seed.txt',
            oldString: 'hello',
            newString: 'world',
            replaceAll: false,
            patch: [
              { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-hello', '+world'] },
            ],
          },
        }),
      )
    }),
  )

  it.effect('builds a question from an AskUserQuestion hook', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('askuserquestion-answered-locally')
      const untilAsked = payloads.slice(
        0,
        payloads.findIndex((payload) => payload.hook_event_name === 'PermissionRequest') + 1,
      )
      const ask = deriveAsk({
        ...noEvidence(yield* spikeScreen('80-ask-blocked')),
        pending: pendingPermission(replay(untilAsked), QUESTION_SESSION),
      })

      expect(encodeAsk(ask)).toEqual({
        _tag: 'QuestionAsk',
        id: 'toolu_016qRAXDn8XxsDwauXwVdYZB',
        source: 'hook',
        questions: [
          {
            header: 'Color',
            question: 'Which color do you prefer?',
            multiSelect: false,
            choices: [
              { label: 'Red', description: 'warm' },
              { label: 'Green', description: 'calm' },
              { label: 'Blue', description: 'cool' },
            ],
          },
        ],
      })
    }),
  )

  it.effect('falls back to the first unmatched tool_use of the transcript without a hook', () =>
    Effect.gen(function* () {
      const declined = yield* spikeTranscript('native-bash-declined-no', 5)
      const ask = deriveAsk({
        ...noEvidence(yield* spikeScreen('12-native-bash-t20')),
        toolUse: firstUnmatchedToolUse(declined),
      })

      expect(encodeAsk(ask)).toEqual(
        expect.objectContaining({
          id: 'toolu_01AvVzUkx1YtZSQqhF7Ykrui',
          source: 'transcript',
          action: { _tag: 'RunCommand', command: 'echo probe-bash-native > bash-native.txt' },
        }),
      )
    }),
  )

  it.effect('takes the first, not the last, unmatched call of a parallel batch', () =>
    Effect.gen(function* () {
      const bothPending = yield* spikeTranscript('native-parallel-bash-approve-then-esc', 3)
      const firstAnswered = yield* spikeTranscript('native-parallel-bash-approve-then-esc', 4)

      expect(Option.map(firstUnmatchedToolUse(bothPending), (toolUse) => toolUse.id)).toEqual(
        Option.some('toolu_01XPPvFwmW64WYSc5xVMyusV'),
      )
      expect(Option.map(firstUnmatchedToolUse(firstAnswered), (toolUse) => toolUse.id)).toEqual(
        Option.some('toolu_01DpzNjNuYom5Ee3nLAGae5h'),
      )
    }),
  )

  it.effect('ignores a pending codemode run and reads the relayed command off the screen', () =>
    Effect.gen(function* () {
      const relayed = yield* spikeTranscript('codemode-bash-timeout-then-zombie-approved', 3)
      const toolUse = firstUnmatchedToolUse(relayed)
      const ask = deriveAsk({ ...noEvidence(yield* spikeScreen('110-codemode6-blocked')), toolUse })

      expect(toolUse).toEqual(Option.none())
      expect(encodeAsk(ask)).toEqual(
        expect.objectContaining({
          source: 'screen',
          tool: 'Bash',
          plugin: 'codemode',
          action: { _tag: 'RunCommand', command: 'echo cm6-bash > cm6-bash.txt' },
        }),
      )
    }),
  )

  it.effect('distrusts a hook record that names another tool than the dialog shows', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('native-edit-approved')
      const untilAsked = payloads.slice(
        0,
        payloads.findIndex((payload) => payload.hook_event_name === 'PermissionRequest') + 1,
      )
      const ask = deriveAsk({
        ...noEvidence(yield* spikeScreen('12-native-bash-t20')),
        pending: pendingPermission(replay(untilAsked), NATIVE_SESSION),
      })

      expect(encodeAsk(ask)).toEqual(expect.objectContaining({ source: 'screen', tool: 'Bash' }))
    }),
  )

  it.effect('reads a question off the screen when nothing else names it', () =>
    Effect.gen(function* () {
      const ask = deriveAsk(noEvidence(yield* spikeScreen('80-ask-blocked')))

      expect(encodeAsk(ask)).toEqual(
        expect.objectContaining({
          _tag: 'QuestionAsk',
          source: 'screen',
          questions: [
            {
              header: 'Color',
              question: 'Which color do you prefer?',
              multiSelect: null,
              choices: [
                { label: 'Red', description: 'warm' },
                { label: 'Green', description: 'calm' },
                { label: 'Blue', description: 'cool' },
              ],
            },
          ],
        }),
      )
    }),
  )

  it.effect('is unknown with the raw screen when no source names the ask', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('70-ask-blocked')

      expect(encodeAsk(deriveAsk(noEvidence(screen)))).toEqual({
        _tag: 'UnknownAsk',
        id: 'blocked-term_65e4961524c522-8',
        screen,
      })
    }),
  )
})
