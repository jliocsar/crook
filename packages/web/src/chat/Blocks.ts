import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'

import type { ImageBlock, ToolResultContent, UserBlock } from '@crook/domain/TranscriptMessage'

type ContentBlock = UserBlock | ToolResultContent

export const textsIn = (blocks: readonly ContentBlock[]): readonly string[] =>
  Arr.flatMap(blocks, (block) =>
    Match.value(block).pipe(
      Match.tag('Text', (text) => [text.text]),
      Match.orElse(() => []),
    ),
  )

export const imagesIn = (blocks: readonly ContentBlock[]): readonly ImageBlock[] =>
  Arr.flatMap(blocks, (block) =>
    Match.value(block).pipe(
      Match.tag('Image', (image) => [image]),
      Match.orElse(() => []),
    ),
  )
