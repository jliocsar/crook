import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { type AskEvidence, deriveAsk, optionChoice } from '@crook/claude/AskDerivation'
import { parseDialog } from '@crook/claude/ScreenDialog'
import { spikeScreen } from '@crook/claude/fixtures/SpikeScreens.ts'
import { Ask } from '@crook/domain/Ask'
import { ToolUseBlock } from '@crook/domain/TranscriptMessage'

import { platform } from './Fixtures'

const EPISODE = { terminal: 'term_65e4961524c522', stateChangeSeq: 8 }

const encodeAsk = Schema.encodeSync(Ask)

const noEvidence = (screen: string): AskEvidence => ({
  episode: EPISODE,
  screen: Option.some(screen),
  dialog: parseDialog(screen),
  pending: [],
  toolUse: Option.none(),
})

layer(platform)('how a permission dialog ends and what its answers mean', (it) => {
  it.effect('reads a dialog that ends on an option saying esc, with no footer', () =>
    Effect.gen(function* () {
      const dialog = Option.getOrThrow(parseDialog(yield* spikeScreen('124-webfetch-blocked')))

      expect(dialog.header).toEqual('Fetch')
      expect(dialog.subject).toEqual(Option.some('Claude wants to fetch content from example.com'))
      expect(dialog.options.map((option) => [option.label, optionChoice(option.label)])).toEqual([
        ['Yes', 'yes'],
        ["Yes, and don't ask again for example.com", 'always'],
        ['No, and tell Claude what to do differently (esc)', 'no'],
      ])
    }),
  )

  it.effect('reads that ending wrapped onto a line of its own', () =>
    Effect.gen(function* () {
      const screen = (yield* spikeScreen('124-webfetch-blocked')).replace(
        'differently (esc)',
        'differently\n      (esc)',
      )
      const options = Match.value(deriveAsk(noEvidence(screen))).pipe(
        Match.tag('PermissionAsk', (permission) =>
          permission.options.map((option) => [option.label, option.choice]),
        ),
        Match.orElse(() => []),
      )

      expect(options).toContainEqual(['No, and tell Claude what to do differently (esc)', 'no'])
    }),
  )

  it.effect('names the tool of a fetch dialog it reads alone', () =>
    Effect.gen(function* () {
      const tool = Match.value(
        deriveAsk(noEvidence(yield* spikeScreen('124-webfetch-blocked'))),
      ).pipe(
        Match.tag('PermissionAsk', (permission) => permission.tool),
        Match.orElse(() => 'no permission'),
      )

      expect(tool).toEqual('WebFetch')
    }),
  )

  it.effect('reads a plan approval, which ends on its editor line, and keeps the call', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('125-plan-approval')
      const ask = deriveAsk({
        ...noEvidence(screen),
        toolUse: Option.some(
          new ToolUseBlock({
            id: 'toolu_plan',
            name: 'ExitPlanMode',
            input: { plan: 'Create a.txt holding the word hi.' },
          }),
        ),
      })

      expect(encodeAsk(ask)).toEqual(
        expect.objectContaining({
          id: 'toolu_plan',
          tool: 'ExitPlanMode',
          options: [
            { number: 1, label: 'Yes, and use auto mode', choice: 'other' },
            { number: 2, label: 'Yes, manually approve edits', choice: 'other' },
            {
              number: 3,
              label: 'Tell Claude what to change shift+tab to approve with this feedback',
              choice: 'other',
            },
          ],
        }),
      )
    }),
  )

  it.effect('leaves an unknown dialog its own, with a plan call waiting', () =>
    Effect.gen(function* () {
      const ask = deriveAsk({
        ...noEvidence(yield* spikeScreen('124-webfetch-blocked')),
        dialog: Option.map(parseDialog(yield* spikeScreen('124-webfetch-blocked')), (dialog) => ({
          ...dialog,
          header: 'Something new',
        })),
        toolUse: Option.some(
          new ToolUseBlock({
            id: 'toolu_plan',
            name: 'ExitPlanMode',
            input: { plan: 'Create a.txt holding the word hi.' },
          }),
        ),
      })

      expect(encodeAsk(ask)).toEqual(expect.objectContaining({ source: 'screen' }))
    }),
  )

  it.effect('does not take a plan footer above the input box for a dialog', () =>
    Effect.gen(function* () {
      const answer = [
        '─'.repeat(40),
        ' The plan dialog said:',
        '  1. Yes',
        '  ctrl+g to edit in Vim',
        '',
        '─'.repeat(40),
        '❯ ',
        '─'.repeat(40),
        '  ? for shortcuts',
      ].join('\n')

      expect(parseDialog(answer)).toEqual(Option.none())
    }),
  )

  it.effect('does not take a line saying esc in the conversation for a dialog', () =>
    Effect.gen(function* () {
      const answer = [
        '● Its options were:',
        '  1. Yes',
        '  3. No, and tell Claude what to do differently (esc)',
        '',
        '─'.repeat(40),
        '❯ ',
        '─'.repeat(40),
        '  ? for shortcuts',
      ].join('\n')

      expect(parseDialog(answer)).toEqual(Option.none())
    }),
  )

  it.effect('reads the one-time answers of a read outside the working directories', () =>
    Effect.gen(function* () {
      const dialog = Option.getOrThrow(
        parseDialog(yield* spikeScreen('122-read-outside-working-directories')),
      )

      expect(dialog.options.map((option) => [option.label, optionChoice(option.label)])).toEqual([
        ['Yes, and keep allowing any reads outside the working directories', 'always'],
        ['No, and block reads outside the working directories from now on', 'other'],
        ['No, and ask again next time', 'no'],
        ['Yes, but ask again next time', 'yes'],
      ])
    }),
  )

  it('classes the answers Claude Code writes on its permission dialogs', () => {
    expect(
      [
        'Allow',
        'Deny (esc)',
        'Deny, and tell Claude what to do differently (esc)',
        'Yes, and use auto mode',
        'Yes, and manually approve edits',
        'No, keep planning',
      ].map(optionChoice),
    ).toEqual(['yes', 'no', 'no', 'other', 'other', 'other'])
  })
})
