import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Struct from 'effect/Struct'

import {
  type AskEvidence,
  deriveAsk,
  optionChoice,
  pendingEdit,
  withEditPatch,
} from '@crook/claude/AskDerivation'
import {
  type HookLedger,
  dismissBefore,
  emptyHookLedger,
  pendingPermissions,
  recordHook,
  retainSessions,
} from '@crook/claude/HookLedger'
import {
  type HookPayload,
  PermissionRequestPayload,
  PreToolUsePayload,
} from '@crook/claude/HookPayload'
import { firstUnmatchedToolUse } from '@crook/claude/LastTurn'
import { dialogFingerprint, keysToSelect, parseDialog } from '@crook/claude/ScreenDialog'
import { spikeScreen } from '@crook/claude/SpikeScreens'
import { Ask } from '@crook/domain/Ask'
import { ClaudeSessionId } from '@crook/domain/Ids'

import { platform, spikeHooks, spikeTranscript } from './Fixtures'

const NATIVE_SESSION = ClaudeSessionId.make('84f3659c-7fcf-4280-8580-b82ae5fd8f91')
const QUESTION_SESSION = ClaudeSessionId.make('dec38383-2aff-4b84-9c66-50da3eeaf74c')
const EPISODE = { terminal: 'term_65e4961524c522', stateChangeSeq: 8 }
const RETRIED_INPUT = { command: 'echo cm6-retry > cm6-retry.txt' }
const ZOMBIE_CALL = 'toolu_plugin_a0d69e5cfde74a13a255d88d5cbafb68'

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
  pending: [],
  toolUse: Option.none(),
})

const untilAsked = (payloads: readonly HookPayload[]) =>
  payloads.slice(
    0,
    payloads.findIndex((payload) => payload.hook_event_name === 'PermissionRequest') + 1,
  )

const latestPending = (ledger: HookLedger, session: ClaudeSessionId) =>
  Arr.last(pendingPermissions(ledger, session))

const withRetriedInput = (payload: HookPayload): HookPayload =>
  Match.value(payload).pipe(
    Match.discriminator('hook_event_name')(
      'PreToolUse',
      (started) =>
        new PreToolUsePayload(Struct.evolve(started, { tool_input: () => RETRIED_INPUT })),
    ),
    Match.discriminator('hook_event_name')(
      'PermissionRequest',
      (request) =>
        new PermissionRequestPayload(Struct.evolve(request, { tool_input: () => RETRIED_INPUT })),
    ),
    Match.orElse((other) => other),
  )

const retriedWithAnotherCommand = (payloads: readonly HookPayload[]) => {
  const retry = payloads.findLastIndex((payload) => payload.hook_event_name === 'PreToolUse')

  return payloads.map((payload, index) => (index >= retry ? withRetriedInput(payload) : payload))
}

const toolOf = (payload: HookPayload): Option.Option<string> =>
  Match.value(payload).pipe(
    Match.discriminatorsExhaustive('hook_event_name')({
      PreToolUse: (started) => Option.some(started.tool_name),
      PermissionRequest: (request) => Option.some(request.tool_name),
      PostToolUse: (finished) => Option.some(finished.tool_name),
      PostToolUseFailure: (failed) => Option.some(failed.tool_name),
      PostToolBatch: () => Option.none(),
    }),
  )

const isEvent = (event: HookPayload['hook_event_name'], tool: string) => (payload: HookPayload) =>
  payload.hook_event_name === event && Option.contains(toolOf(payload), tool)

const withCursorOn = (screen: string, option: string) =>
  screen.replace('❯ 1. Yes', '  1. Yes').replace(`  ${option}`, `❯ ${option}`)

layer(platform)('the permission dialog on the screen', (it) => {
  it.effect('reads a Bash dialog: header, description, command and the four options', () =>
    Effect.gen(function* () {
      const dialog = Option.getOrThrow(parseDialog(yield* spikeScreen('12-native-bash-t20')))

      expect(dialog.kind).toBe('permission')
      expect(dialog.header).toBe('Bash command')
      expect(dialog.plugin).toEqual(Option.none())
      expect(dialog.queue).toEqual(Option.none())
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

  it.effect('takes a don’t-ask-again option for a standing grant', () =>
    Effect.gen(function* () {
      const dialog = Option.getOrThrow(parseDialog(yield* spikeScreen('105-npm-dont-ask-again')))

      expect(dialog.body).toEqual(['npm --version'])
      expect(dialog.options.map((option) => [option.label, optionChoice(option.label)])).toEqual([
        ['Yes', 'yes'],
        ['Yes, and don’t ask again for: npm *', 'always'],
        ['Yes, and switch to auto mode · auto mode handles these prompts for you', 'other'],
        ['No', 'no'],
      ])
    }),
  )

  it.effect('joins an option the terminal wrapped back into one label', () =>
    Effect.gen(function* () {
      const screen = (yield* spikeScreen('12-native-bash-t20')).replace(
        ' from this project',
        ' from this\n     project',
      )
      const options = Match.value(deriveAsk(noEvidence(screen))).pipe(
        Match.tag('PermissionAsk', (permission) =>
          permission.options.map((option) => [option.label, option.choice]),
        ),
        Match.orElse(() => []),
      )

      expect(options).toContainEqual([
        'Yes, and always allow access to /home/jliocsar/Projects/crook/tmp/spikes/scratch-80/sandbox from this project',
        'always',
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

  it.effect('reads the plugin and the queue counter of a codemode dialog', () =>
    Effect.gen(function* () {
      const first = Option.getOrThrow(parseDialog(yield* spikeScreen('110-codemode6-blocked')))
      const queued = Option.getOrThrow(parseDialog(yield* spikeScreen('112-codemode6-zombie')))

      expect([first.header, first.plugin, first.queue, first.body]).toEqual([
        'Bash command',
        Option.some('codemode'),
        Option.none(),
        ['echo cm6-bash > cm6-bash.txt'],
      ])
      expect(first.options.map((option) => option.label)).toEqual(['Yes', 'No'])
      expect([queued.header, queued.plugin, queued.queue]).toEqual([
        'Bash command',
        Option.some('codemode'),
        Option.some({ position: 1, total: 2 }),
      ])
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

  it.effect('fingerprints a dialog by what it asks, wherever the cursor rests', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('12-native-bash-t20')
      const fingerprintOf = (text: string) =>
        Option.map(parseDialog(text), (dialog) => dialogFingerprint(dialog))
      const moved = withCursorOn(screen, '4. No')

      expect(moved).not.toBe(screen)
      expect(fingerprintOf(moved)).toEqual(fingerprintOf(screen))
      expect(fingerprintOf(yield* spikeScreen('42-parallel-blocked-2'))).not.toEqual(
        fingerprintOf(yield* spikeScreen('40-parallel-blocked-1')),
      )
    }),
  )

  it.effect('fingerprints a queued dialog by its place in the queue, not by the queue length', () =>
    Effect.gen(function* () {
      const answered = yield* spikeScreen('112-codemode6-zombie')
      const fingerprintOf = (text: string) =>
        Option.map(parseDialog(text), (dialog) => dialogFingerprint(dialog))
      const longerQueue = answered.replace('1 of 2', '1 of 3')

      expect(longerQueue).not.toBe(answered)
      expect(fingerprintOf(longerQueue)).toEqual(fingerprintOf(answered))
      expect(fingerprintOf(yield* spikeScreen('113-codemode6-zombie-declined'))).not.toEqual(
        fingerprintOf(answered),
      )
    }),
  )
})

layer(platform)('the hook ledger', (it) => {
  it.effect('holds the PermissionRequest with the tool_use_id of the PreToolUse before it', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('native-edit-approved')
      const pending = Option.getOrThrow(latestPending(replay(untilAsked(payloads)), NATIVE_SESSION))

      expect([pending.toolName, pending.toolUseId]).toEqual([
        'Edit',
        Option.some('toolu_01E7pJi46fPfLt6HWm616tdc'),
      ])
      expect(pendingPermissions(replay(payloads), NATIVE_SESSION)).toEqual([])
    }),
  )

  it.effect('pairs a PermissionRequest that arrives before its PreToolUse', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('native-edit-approved')
      const started = payloads.findIndex(isEvent('PreToolUse', 'Edit'))
      const asked = payloads.findIndex(isEvent('PermissionRequest', 'Edit'))
      const delivered = [
        ...payloads.slice(0, started),
        ...Arr.reverse(payloads.slice(started, asked + 1)),
        ...payloads.slice(asked + 1),
      ]

      expect(asked).toBe(started + 1)

      const pending = Option.getOrThrow(
        latestPending(replay(delivered.slice(0, asked + 1)), NATIVE_SESSION),
      )

      expect(pending.toolUseId).toEqual(Option.some('toolu_01E7pJi46fPfLt6HWm616tdc'))
      expect(pendingPermissions(replay(delivered), NATIVE_SESSION)).toEqual([])
    }),
  )

  it.effect('resolves a request whose PreToolUse never arrived by its tool and input', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('native-edit-approved')
      const withoutStart = payloads.filter((payload) => !isEvent('PreToolUse', 'Edit')(payload))
      const pending = Option.getOrThrow(
        latestPending(replay(untilAsked(withoutStart)), NATIVE_SESSION),
      )

      expect(pending.toolUseId).toEqual(Option.none())
      expect(pendingPermissions(replay(withoutStart), NATIVE_SESSION)).toEqual([])
    }),
  )

  it.effect('keeps a declined ask, since no hook fires, until it is dismissed', () =>
    Effect.gen(function* () {
      const ledger = replay(yield* spikeHooks('native-bash-declined-no'))

      expect(Option.isSome(latestPending(ledger, NATIVE_SESSION))).toBe(true)
      expect(
        pendingPermissions(dismissBefore(ledger, NATIVE_SESSION, ledger.received), NATIVE_SESSION),
      ).toEqual([])
      expect(dismissBefore(ledger, NATIVE_SESSION, 0)).toEqual(ledger)
    }),
  )

  it.effect(
    'drops the records of a session no herd agent runs, once they are older than the read',
    () =>
      Effect.gen(function* () {
        const ledger = replay(yield* spikeHooks('native-bash-declined-no'))
        const forgotten = retainSessions(ledger, () => false, ledger.received)

        expect(pendingPermissions(forgotten, NATIVE_SESSION)).toEqual([])
        expect(forgotten.started).toEqual(emptyHookLedger.started)
        expect(retainSessions(ledger, () => false, 0)).toEqual(ledger)
        expect(
          retainSessions(ledger, (session) => session === NATIVE_SESSION, ledger.received),
        ).toEqual(ledger)
      }),
  )

  it.effect('follows the second dialog of a parallel batch once the first is approved', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('native-parallel-bash-approve-then-esc')
      const pending = Option.getOrThrow(latestPending(replay(payloads), NATIVE_SESSION))

      expect(pending.toolUseId).toEqual(Option.some('toolu_01DpzNjNuYom5Ee3nLAGae5h'))
    }),
  )

  it.effect('keeps a codemode ask open after the outer call times out', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('codemode-bash-timeout-then-zombie-approved')
      const beforeApproval = payloads.slice(0, -1)
      const session = sessionOf(payloads)
      const pending = Option.getOrThrow(latestPending(replay(beforeApproval), session))

      expect(pending.toolName).toBe('Bash')
      expect(Option.getOrThrow(pending.toolUseId)).toMatch(/^toolu_plugin_/u)
      expect(pendingPermissions(replay(payloads), session)).toEqual([])
    }),
  )

  it.effect('keeps both dialogs of a codemode retry, oldest first', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('codemode-bash-timeout-retry-zombies-declined')
      const pending = pendingPermissions(replay(payloads), sessionOf(payloads))

      expect(pending.map((permission) => Option.getOrThrow(permission.toolUseId))).toEqual([
        ZOMBIE_CALL,
        'toolu_plugin_94d257f4312c474cbf1d36817ad44e19',
      ])
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
        pending: pendingPermissions(replay(payloads), NATIVE_SESSION),
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
        dialog: dialogFingerprint(Option.getOrThrow(parseDialog(screen))),
      })
    }),
  )

  it.effect('answers the dialog the queue counter points at, not the latest request', () =>
    Effect.gen(function* () {
      const payloads = retriedWithAnotherCommand(
        yield* spikeHooks('codemode-bash-timeout-retry-zombies-declined'),
      )
      const ask = deriveAsk({
        ...noEvidence(yield* spikeScreen('112-codemode6-zombie')),
        pending: pendingPermissions(replay(payloads), sessionOf(payloads)),
      })

      expect(encodeAsk(ask)).toEqual(
        expect.objectContaining({
          id: ZOMBIE_CALL,
          source: 'hook',
          action: { _tag: 'RunCommand', command: 'echo cm6-bash > cm6-bash.txt' },
        }),
      )
    }),
  )

  it.effect('reads the screen when the hook names another command than the dialog shows', () =>
    Effect.gen(function* () {
      const payloads = retriedWithAnotherCommand(
        yield* spikeHooks('codemode-bash-timeout-retry-zombies-declined'),
      )
      const retryOnly = payloads.slice(
        payloads.findLastIndex((payload) => payload.hook_event_name === 'PreToolUse'),
      )
      const ask = deriveAsk({
        ...noEvidence(yield* spikeScreen('110-codemode6-blocked')),
        pending: pendingPermissions(replay(retryOnly), sessionOf(payloads)),
      })

      expect(encodeAsk(ask)).toEqual(
        expect.objectContaining({
          source: 'screen',
          action: { _tag: 'RunCommand', command: 'echo cm6-bash > cm6-bash.txt' },
        }),
      )
    }),
  )

  it.effect('computes the Edit diff from the file, since the payload carries no patch', () =>
    Effect.gen(function* () {
      const payloads = yield* spikeHooks('native-edit-approved')
      const ask = deriveAsk({
        ...noEvidence(yield* spikeScreen('20-edit-blocked')),
        pending: pendingPermissions(replay(untilAsked(payloads)), NATIVE_SESSION),
      })

      expect(encodeAsk(withEditPatch(Option.getOrThrow(pendingEdit(ask)), 'hello\n'))).toEqual(
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
      const screen = yield* spikeScreen('80-ask-blocked')
      const ask = deriveAsk({
        ...noEvidence(screen),
        pending: pendingPermissions(replay(untilAsked(payloads)), QUESTION_SESSION),
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
        dialog: dialogFingerprint(Option.getOrThrow(parseDialog(screen))),
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
      const ask = deriveAsk({
        ...noEvidence(yield* spikeScreen('12-native-bash-t20')),
        pending: pendingPermissions(replay(untilAsked(payloads)), NATIVE_SESSION),
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
