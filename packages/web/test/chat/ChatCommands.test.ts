import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import { pendingPromptRows, waitAfterSend } from '@crook/web/chat/ChatCommands'
import type { PromptSend, PromptWait } from '@crook/web/chat/ChatCommands'
import { ChatItem } from '@crook/web/chat/ChatItems'

const NOTHING: PromptWait = { promptsAtSend: 0, pending: [] }

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

const sent = (text: string) => ({ text, queued: false })

const queued = (text: string) => ({ text, queued: true })

describe('waitAfterSend', () => {
  it('waits for every prompt sent before the first one arrived', () => {
    const first = waitAfterSend(NOTHING, prompts(1), sending('second'))
    const second = waitAfterSend(first, prompts(1), sending('third'))

    expect(first).toStrictEqual({ promptsAtSend: 1, pending: [sent('second')] })
    expect(second).toStrictEqual({
      promptsAtSend: 1,
      pending: [sent('second'), queued('third')],
    })
  })

  it('starts counting again from the thread once everything awaited arrived', () => {
    const both = { promptsAtSend: 1, pending: [sent('second'), queued('third')] }

    expect(waitAfterSend(both, prompts(3), sending('fourth'))).toStrictEqual({
      promptsAtSend: 3,
      pending: [sent('fourth')],
    })
  })

  it('counts a failed prompt out once another send replaces it', () => {
    const replaced = waitAfterSend(
      { promptsAtSend: 1, pending: [sent('second'), queued('failed')] },
      prompts(1),
      sending('again', { replacesFailed: true }),
    )

    expect(replaced).toStrictEqual({ promptsAtSend: 1, pending: [sent('second'), queued('again')] })
  })

  it('awaits nothing for a slash command, which never comes back as a prompt', () => {
    const slash = sending('/compact', { prompt: Option.none() })
    const waiting = { promptsAtSend: 1, pending: [sent('second')] }

    expect(waitAfterSend(NOTHING, prompts(1), slash)).toStrictEqual(NOTHING)
    expect(waitAfterSend(waiting, prompts(1), slash)).toStrictEqual(waiting)
    expect(waitAfterSend(waiting, prompts(1), { ...slash, replacesFailed: true })).toStrictEqual(
      NOTHING,
    )
  })

  it('queues a prompt sent while Claude works, as its own TUI does', () => {
    expect(
      waitAfterSend(NOTHING, prompts(1), sending('meanwhile', { working: true })),
    ).toStrictEqual({ promptsAtSend: 1, pending: [queued('meanwhile')] })
  })

  it('queues a prompt behind one Claude has not taken yet, whatever the status says', () => {
    const behind = waitAfterSend(
      { promptsAtSend: 1, pending: [sent('second'), queued('third')] },
      prompts(2),
      sending('fourth'),
    )

    expect(behind).toStrictEqual({
      promptsAtSend: 1,
      pending: [sent('second'), queued('third'), queued('fourth')],
    })
  })
})

describe('pendingPromptRows', () => {
  const waiting = { promptsAtSend: 1, pending: [sent('second'), queued('third'), queued('fourth')] }

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
