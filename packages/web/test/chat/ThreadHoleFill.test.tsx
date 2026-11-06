import { render } from '@testing-library/react'
import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import { afterEach, beforeEach, vi } from 'vitest'

import { TranscriptOffset } from '@crook/domain/Ids'
import { OmittedLines } from '@crook/domain/TranscriptMessage'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import { chatItems, isOmitted } from '@crook/web/chat/ChatItems'
import { Thread } from '@crook/web/chat/Thread'
import type { ThreadRow } from '@crook/web/chat/Thread'

import { present } from '../Dom.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { CWD, said, SESSION } from '../TranscriptFixtures.ts'
import { phoneViewport } from '../ThreadRender.tsx'

const HOLE_HEIGHT = 80
const LINE_HEIGHT = 32
const ROW_SPACING = 12
const HOLE_TEXT = 'Show earlier messages'
const FILLED_TEXT = 'What the gap held.'
const TAIL_TEXT = 'The tail under the hole.'
const HOLE_OFFSET = 40
const TAIL_OFFSET = 4096

const hole = new OmittedLines({
  offset: TranscriptOffset.make(HOLE_OFFSET),
  byteLength: TAIL_OFFSET - HOLE_OFFSET,
})

const rowsOf = (messages: readonly TranscriptMessage[]): readonly ThreadRow[] =>
  pipe(
    messages,
    Arr.map((message) => ({ session: SESSION, message })),
    (lines) => chatItems(lines, { cwd: CWD, activity: 'still', rosters: HashMap.empty() }),
    Arr.map((item) => ({
      key: item.key,
      hole: isOmitted(item),
      content: <p>{isOmitted(item) ? HOLE_TEXT : JSON.stringify(item)}</p>,
    })),
  )

const thread = (rows: readonly ThreadRow[]) => (
  <Thread rows={rows} dimmed={false} empty={<p>No messages yet</p>} />
)

const startOfRowHolding = (text: string): number =>
  Number.parseFloat(
    present(
      Array.from(document.querySelectorAll<HTMLElement>('[data-row]')).find((row) =>
        row.textContent.includes(text),
      ),
      `the row holding ${text}`,
    ).style.transform.replace('translateY(', ''),
  )

beforeEach(() => {
  stubMediaQueries([])
  phoneViewport()
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function rendered(
    this: HTMLElement,
  ) {
    if (!this.hasAttribute('data-row')) {
      return 0
    }

    return this.textContent.includes(HOLE_TEXT) ? HOLE_HEIGHT : LINE_HEIGHT
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a hole filled in the thread', () => {
  it('spaces the row under the filled line by that line, in the commit that lands it', () => {
    const { rerender } = render(
      thread(rowsOf([said(0, 'Above the hole.'), hole, said(TAIL_OFFSET, TAIL_TEXT)])),
    )

    rerender(
      thread(
        rowsOf([
          said(0, 'Above the hole.'),
          said(HOLE_OFFSET, FILLED_TEXT),
          said(TAIL_OFFSET, TAIL_TEXT),
        ]),
      ),
    )

    expect(startOfRowHolding(TAIL_TEXT) - startOfRowHolding(FILLED_TEXT)).toBe(
      LINE_HEIGHT + ROW_SPACING,
    )
  })
})
