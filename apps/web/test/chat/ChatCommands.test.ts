import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import compactionAuto from '@crook/claude/fixtures/compaction-auto.jsonl?raw'
import compactionManual from '@crook/claude/fixtures/compaction-manual.jsonl?raw'
import slashCommands from '@crook/claude/fixtures/slash-commands.jsonl?raw'
import { LocalCommandBlock } from '@crook/domain/TranscriptMessage'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import { pendingPromptRows, waitAfterSend, waitWithoutCommands } from '@crook/web/chat/ChatCommands'
import type { PromptSend, PromptWait } from '@crook/web/chat/ChatCommands'
import { ChatItem, chatItems } from '@crook/web/chat/ChatItems'
import { NO_ROSTERS } from '@crook/web/chat/TranscriptState'

import { messagesOf } from '../../stories/RealTranscriptFixtures.ts'
import { CWD, prompt, sentCommand, sentPrompt, SESSION, user } from '../TranscriptFixtures.ts'

const NOTHING: PromptWait = { promptsAtSend: 0, commandsAtSend: 0, holesAtSend: 0, pending: [] }

const prompts = (count: number): readonly ChatItem[] =>
  Arr.makeBy(count, (index) =>
    ChatItem.UserPrompt({
      key: `prompt ${index}`,
      text: `prompt ${index}`,
      images: [],
      queued: false,
    }),
  )

const sending = (text: string, options: Partial<PromptSend> = {}): PromptSend => ({
  replacesFailed: false,
  prompt: Option.some(text),
  working: false,
  ...options,
})

const sent = (text: string) => ({ text, queued: false, command: false })

const queued = (text: string) => ({ text, queued: true, command: false })

describe('a send waiting while something else lands', () => {
  const foldOf = (lines: readonly TranscriptMessage[]) =>
    chatItems(
      Arr.map(lines, (message) => ({ session: SESSION, message })),
      { cwd: CWD, activity: 'still', rosters: NO_ROSTERS },
    )
  const shownOf = (wait: PromptWait, now: readonly ChatItem[]) =>
    Arr.map(pendingPromptRows(wait, now, false), (row) => row.text)

  it('keeps a prompt waiting through a prompt no one typed, and ends on its own', () => {
    const wait = waitAfterSend(NOTHING, [], sending('Check the toast'))
    const plugin = sentPrompt(0, 'A made-up reply', { kind: 'plugin', name: 'madeup' })
    const script = sentPrompt(10, 'A made-up script', { kind: 'sdk' })

    expect(shownOf(wait, foldOf([plugin, script]))).toEqual(['Check the toast'])
    expect(shownOf(wait, foldOf([plugin, script, prompt(20, 'Check the toast')]))).toEqual([])
  })

  it('keeps a slash send waiting through a scheduled command, and ends on its own', () => {
    const wait = waitAfterSend(NOTHING, [], sending('/model opus'))
    const fire = sentCommand(0, '/sweep', 'tick', { kind: 'scheduled' })
    const own = user(10, [new LocalCommandBlock({ name: '/model', args: 'opus' })])

    expect(shownOf(wait, foldOf([fire]))).toEqual(['/model opus'])
    expect(shownOf(wait, foldOf([fire, own]))).toEqual([])
  })

  it('still ends a send on a line from an agent too old to say who sent it', () => {
    const wait = waitAfterSend(NOTHING, [], sending('Check the toast'))

    expect(shownOf(wait, foldOf([prompt(0, 'Check the toast')]))).toEqual([])
  })
})

describe('waitAfterSend', () => {
  it('waits for every prompt sent before the first one arrived', () => {
    const first = waitAfterSend(NOTHING, prompts(1), sending('second'))
    const second = waitAfterSend(first, prompts(1), sending('third'))

    expect(first).toStrictEqual({
      promptsAtSend: 1,
      commandsAtSend: 0,
      holesAtSend: 0,
      pending: [sent('second')],
    })
    expect(second).toStrictEqual({
      promptsAtSend: 1,
      commandsAtSend: 0,
      holesAtSend: 0,
      pending: [sent('second'), queued('third')],
    })
  })

  it('starts counting again from the thread once everything awaited arrived', () => {
    const both = {
      promptsAtSend: 1,
      commandsAtSend: 0,
      holesAtSend: 0,
      pending: [sent('second'), queued('third')],
    }

    expect(waitAfterSend(both, prompts(3), sending('fourth'))).toStrictEqual({
      promptsAtSend: 3,
      commandsAtSend: 0,
      holesAtSend: 0,
      pending: [sent('fourth')],
    })
  })

  it('counts a failed prompt out once another send replaces it', () => {
    const replaced = waitAfterSend(
      {
        promptsAtSend: 1,
        commandsAtSend: 0,
        holesAtSend: 0,
        pending: [sent('second'), queued('failed')],
      },
      prompts(1),
      sending('again', { replacesFailed: true }),
    )

    expect(replaced).toStrictEqual({
      promptsAtSend: 1,
      commandsAtSend: 0,
      holesAtSend: 0,
      pending: [sent('second'), queued('again')],
    })
  })

  it('awaits nothing for a send that says nothing, such as an answer with no message', () => {
    const slash = sending('/compact', { prompt: Option.none() })
    const waiting = {
      promptsAtSend: 1,
      commandsAtSend: 0,
      holesAtSend: 0,
      pending: [sent('second')],
    }

    expect(waitAfterSend(NOTHING, prompts(1), slash)).toStrictEqual(NOTHING)
    expect(waitAfterSend(waiting, prompts(1), slash)).toStrictEqual(waiting)
    expect(waitAfterSend(waiting, prompts(1), { ...slash, replacesFailed: true })).toStrictEqual(
      NOTHING,
    )
  })

  it('queues a prompt sent while Claude works, as its own TUI does', () => {
    expect(
      waitAfterSend(NOTHING, prompts(1), sending('meanwhile', { working: true })),
    ).toStrictEqual({
      promptsAtSend: 1,
      commandsAtSend: 0,
      holesAtSend: 0,
      pending: [queued('meanwhile')],
    })
  })

  it('queues a prompt behind one Claude has not taken yet, whatever the status says', () => {
    const behind = waitAfterSend(
      {
        promptsAtSend: 1,
        commandsAtSend: 0,
        holesAtSend: 0,
        pending: [sent('second'), queued('third')],
      },
      prompts(2),
      sending('fourth'),
    )

    expect(behind).toStrictEqual({
      promptsAtSend: 1,
      commandsAtSend: 0,
      holesAtSend: 0,
      pending: [sent('second'), queued('third'), queued('fourth')],
    })
  })
})

describe('a hole in the thread', () => {
  const hole = ChatItem.Omitted({ key: 'hole', byteLength: 2048 })
  const waiting = {
    promptsAtSend: 1,
    commandsAtSend: 0,
    holesAtSend: 0,
    pending: [sent('second'), queued('third')],
  }

  it('ends the wait, since what was waited for may be inside it', () => {
    expect(pendingPromptRows(waiting, [...prompts(1), hole], false)).toStrictEqual([])
  })

  it('leaves the wait alone when it is the row a cold open starts with', () => {
    expect(pendingPromptRows(waiting, [hole, ...prompts(1)], false)).toStrictEqual([
      { key: 'pending prompt 1', ...sent('second') },
      { key: 'pending prompt 2', ...queued('third') },
    ])
  })

  it('that was there at the send says nothing about the prompt sent after it', () => {
    const wait = waitAfterSend(NOTHING, [...prompts(1), hole, ...prompts(1)], sending('next'))

    expect(pendingPromptRows(wait, [...prompts(1), hole, ...prompts(1)], false)).toStrictEqual([
      { key: 'pending prompt 2', ...sent('next') },
    ])
  })
})

describe('a command send', () => {
  const items = (jsonl: string) =>
    chatItems(
      Arr.map(messagesOf(jsonl), (message) => ({ session: SESSION, message })),
      { cwd: CWD, activity: 'still', rosters: NO_ROSTERS },
    )
  const landed = (send: string) =>
    Arr.filter(items(slashCommands), (item) => JSON.stringify(item).includes(send))
  const shownOf = (wait: PromptWait, now: readonly ChatItem[]) =>
    Arr.map(pendingPromptRows(wait, now, false), (row) => row.text)

  it('waits as a command, so a prompt landing does not end it', () => {
    const wait = waitAfterSend(NOTHING, [], sending('/model opus'))

    expect(wait.pending).toStrictEqual([{ text: '/model opus', queued: false, command: true }])
    expect(shownOf(wait, prompts(1))).toEqual(['/model opus'])
  })

  it('ends when what the real parser reads of its line lands', () => {
    const wait = waitAfterSend(NOTHING, [], sending('/rename probe name'))

    expect(shownOf(wait, [])).toEqual(['/rename probe name'])
    expect(shownOf(wait, landed('/rename probe name'))).toEqual([])
  })

  it('ends on a manual compaction and not on an automatic one', () => {
    const wait = waitAfterSend(NOTHING, [], sending('/compact'))

    expect(shownOf(wait, items(compactionAuto))).toEqual(['/compact'])
    expect(shownOf(wait, items(compactionManual))).toEqual([])
  })

  it('ends on the note an unknown command writes instead of a command line', () => {
    const wait = waitAfterSend(NOTHING, [], sending('/nosuchcommand'))

    expect(shownOf(wait, landed('Unknown command'))).toEqual([])
  })

  it('ends on the error a failed /compact writes with no row of its own', () => {
    const wait = waitAfterSend(NOTHING, [], sending('/compact'))

    expect(shownOf(wait, landed('No messages to compact'))).toEqual([])
  })

  it('stays through an interruption or a notice about something else', () => {
    const wait = waitAfterSend(NOTHING, [], sending('/nosuchcommand'))
    const unrelated = items(
      [
        '{"type":"user","message":{"content":[{"type":"text","text":"[Request interrupted by user]"}]}}',
        '{"type":"system","subtype":"informational","content":"A made up plugin reloaded"}',
      ].join('\n'),
    )

    expect(Arr.filter(unrelated, ChatItem.$is('Note'))).toHaveLength(2)
    expect(shownOf(wait, unrelated)).toEqual(['/nosuchcommand'])
  })

  it('ends on a shell line landing', () => {
    const wait = waitAfterSend(NOTHING, [], sending('!true'))

    expect(shownOf(wait, landed('! true'))).toEqual([])
  })

  it('keeps a prompt and a command apart whichever lands first', () => {
    const first = waitAfterSend(NOTHING, [], sending('/model opus'))
    const both = waitAfterSend(first, [], sending('After it'))

    expect(shownOf(both, prompts(1))).toEqual(['/model opus'])
    expect(shownOf(both, landed('/rename probe name'))).toEqual(['After it'])
  })

  it('leaves prompts waiting, and nothing else, once a command writes no line', () => {
    const first = waitAfterSend(NOTHING, prompts(1), sending('/login'))
    const both = waitAfterSend(first, prompts(1), sending('After it'))
    const left = waitWithoutCommands(both, prompts(1))

    expect(shownOf(left, prompts(1))).toEqual(['After it'])
    expect(shownOf(left, prompts(2))).toEqual([])
    expect(waitWithoutCommands(first, prompts(1))).toStrictEqual(NOTHING)
  })

  it('counts a path as a prompt, since Claude reads it as one', () => {
    const wait = waitAfterSend(NOTHING, [], sending('/home/me/file is broken'))

    expect(shownOf(wait, prompts(1))).toEqual([])
  })
})

describe('pendingPromptRows', () => {
  const waiting = {
    promptsAtSend: 1,
    commandsAtSend: 0,
    holesAtSend: 0,
    pending: [sent('second'), queued('third'), queued('fourth')],
  }

  it('keeps a row for each prompt the thread does not hold yet, keyed by its place', () => {
    expect(pendingPromptRows(waiting, prompts(2), false)).toStrictEqual([
      { key: 'pending prompt 2', ...queued('third') },
      { key: 'pending prompt 3', ...queued('fourth') },
    ])
  })

  it('leaves out the prompt still on its way, which the composer shows instead', () => {
    expect(pendingPromptRows(waiting, prompts(1), true)).toStrictEqual([
      { key: 'pending prompt 1', ...sent('second') },
      { key: 'pending prompt 2', ...queued('third') },
    ])
  })

  it('keeps every row when the thread reloads shorter than it was at the send', () => {
    expect(pendingPromptRows(waiting, prompts(0), false)).toHaveLength(3)
  })
})
