import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'

import type { ImageBlock, ToolResultContent, UserBlock } from '@crook/domain/TranscriptMessage'
import { PARAGRAPH_BREAK } from '@crook/web/text/Lines'

type ContentBlock = UserBlock | ToolResultContent

export const textsIn = (blocks: readonly ContentBlock[]): readonly string[] =>
  Arr.flatMap(blocks, (block) =>
    Match.value(block).pipe(
      Match.tag('Text', (text) => [text.text]),
      Match.orElse(() => []),
    ),
  )

export const wordsIn = (blocks: readonly ContentBlock[]): string =>
  Arr.join(textsIn(blocks), PARAGRAPH_BREAK)

export const imagesIn = (blocks: readonly ContentBlock[]): readonly ImageBlock[] =>
  Arr.flatMap(blocks, (block) =>
    Match.value(block).pipe(
      Match.tag('Image', (image) => [image]),
      Match.orElse(() => []),
    ),
  )
