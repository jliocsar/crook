import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'

import { waitAfterSend } from '@crook/web/chat/ChatCommands'
import type { PromptWait } from '@crook/web/chat/ChatCommands'
import { ChatItem } from '@crook/web/chat/ChatItems'

const NOTHING: PromptWait = { promptsAtSend: 0, awaited: 0 }
const PROMPT = { replacesFailed: false, awaitsPrompt: true }

const prompts = (count: number): readonly ChatItem[] =>
  Arr.makeBy(count, (index) =>
    ChatItem.UserPrompt({
      key: `prompt ${index}`,
      text: `prompt ${index}`,
      images: [],
      queued: false,
    }),
  )

describe('waitAfterSend', () => {
  it('waits for every prompt sent before the first one arrived', () => {
    const first = waitAfterSend(NOTHING, prompts(1), PROMPT)
    const second = waitAfterSend(first, prompts(1), PROMPT)

    expect(first).toStrictEqual({ promptsAtSend: 1, awaited: 1 })
    expect(second).toStrictEqual({ promptsAtSend: 1, awaited: 2 })
  })

  it('starts counting again from the thread once everything awaited arrived', () => {
    const both = { promptsAtSend: 1, awaited: 2 }

    expect(waitAfterSend(both, prompts(3), PROMPT)).toStrictEqual({ promptsAtSend: 3, awaited: 1 })
  })

  it('counts a failed prompt out once another send replaces it', () => {
    const replaced = waitAfterSend({ promptsAtSend: 1, awaited: 2 }, prompts(1), {
      replacesFailed: true,
      awaitsPrompt: true,
    })

    expect(replaced).toStrictEqual({ promptsAtSend: 1, awaited: 2 })
  })

  it('awaits nothing for a slash command, which never comes back as a prompt', () => {
    const slash = { replacesFailed: false, awaitsPrompt: false }

    expect(waitAfterSend(NOTHING, prompts(1), slash)).toStrictEqual(NOTHING)
    expect(waitAfterSend({ promptsAtSend: 1, awaited: 1 }, prompts(1), slash)).toStrictEqual({
      promptsAtSend: 1,
      awaited: 1,
    })
    expect(
      waitAfterSend({ promptsAtSend: 1, awaited: 1 }, prompts(1), {
        replacesFailed: true,
        awaitsPrompt: false,
      }),
    ).toStrictEqual(NOTHING)
  })
})
