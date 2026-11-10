import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import type { HighlighterCore } from 'shiki/core'

import { CODE_THEMES } from '@crook/web/highlight/Themes'

type HastRoot = ReturnType<HighlighterCore['codeToHast']>

type HastNode = HastRoot['children'][number]

const LINE_CLASS = 'line'
const CLASS_SEPARATOR = ' '
const NO_STYLE = ''

export const HighlightToken = Schema.Struct({ content: Schema.String, style: Schema.String })
export type HighlightToken = typeof HighlightToken.Type

export const HighlightedLines = Schema.Array(Schema.Array(HighlightToken))
export type HighlightedLines = typeof HighlightedLines.Type

export const HighlightJob = Schema.Struct({
  id: Schema.Int,
  code: Schema.String,
  language: Schema.String,
})
export type HighlightJob = typeof HighlightJob.Type

export const HighlightReply = Schema.Struct({
  id: Schema.Int,
  lines: Schema.OptionFromNullOr(HighlightedLines),
})
export type HighlightReply = typeof HighlightReply.Type

const decodeText = Schema.decodeUnknownOption(Schema.String)

const isLine = (node: HastNode): boolean =>
  node.type === 'element' &&
  pipe(
    decodeText(node.properties.class),
    Option.exists((names) => names.split(CLASS_SEPARATOR).includes(LINE_CLASS)),
  )

const childrenOf = (node: HastNode): readonly HastNode[] =>
  node.type === 'element' ? node.children : []

const textOf = (node: HastNode): string =>
  node.type === 'text' ? node.value : pipe(childrenOf(node), Arr.map(textOf), Arr.join(''))

const tokenOf = (node: HastNode): Option.Option<HighlightToken> => {
  if (node.type === 'text') {
    return Option.some({ content: node.value, style: NO_STYLE })
  }

  if (node.type !== 'element') {
    return Option.none()
  }

  return Option.some({
    content: textOf(node),
    style: Option.getOrElse(decodeText(node.properties.style), () => NO_STYLE),
  })
}

const lineTokens = (line: HastNode): readonly HighlightToken[] =>
  pipe(childrenOf(line), Arr.map(tokenOf), Arr.getSomes)

const lineNodes = (root: HastRoot): readonly HastNode[] =>
  pipe(root.children, Arr.flatMap(childrenOf), Arr.flatMap(childrenOf), Arr.filter(isLine))

export const isStyled = (token: HighlightToken): boolean => token.style !== NO_STYLE

export const highlightedLines = (
  highlighter: HighlighterCore,
  code: string,
  language: string,
): Option.Option<HighlightedLines> =>
  pipe(
    Option.liftPredicate(language, (name) => highlighter.getLoadedLanguages().includes(name)),
    Option.map((lang) =>
      highlighter.codeToHast(code, { lang, themes: CODE_THEMES, defaultColor: false }),
    ),
    Option.map((root) => Arr.map(lineNodes(root), lineTokens)),
  )
