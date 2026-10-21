import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'
import * as React from 'react'
import type { HighlighterCore } from 'shiki/core'

export type CodeHighlighter = HighlighterCore

type HastRoot = ReturnType<HighlighterCore['codeToHast']>

type HastNode = HastRoot['children'][number]

type HastElement = Extract<HastNode, { readonly type: 'element' }>

const LINE_CLASS = 'line'
const CUSTOM_PROPERTY_PREFIX = '--'
const STYLE_SEPARATOR = ';'
const STYLE_DECLARATION = /^\s*([^:]+?)\s*:\s*(.+?)\s*$/u

const LANGUAGE_OF_EXTENSION = new Map([
  ['ts', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  ['tsx', 'tsx'],
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['jsx', 'jsx'],
  ['json', 'json'],
  ['jsonc', 'jsonc'],
  ['jsonl', 'json'],
  ['toml', 'toml'],
  ['css', 'css'],
  ['md', 'markdown'],
  ['yml', 'yaml'],
  ['yaml', 'yaml'],
  ['py', 'python'],
  ['sh', 'shellscript'],
  ['bash', 'shellscript'],
  ['zsh', 'shellscript'],
  ['diff', 'diff'],
  ['patch', 'diff'],
])

export class HighlighterUnavailable extends Schema.TaggedError<HighlighterUnavailable>()(
  'HighlighterUnavailable',
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return 'The code highlighter did not load, so code shows without colours. Reload crook once the network is back.'
  }
}

export const highlighterAtom = Atom.make(
  Effect.gen(function* () {
    const shiki = yield* Effect.tryPromise({
      try: () => import('@crook/web/highlight/Shiki'),
      catch: (cause) => new HighlighterUnavailable({ cause }),
    })

    return yield* Effect.tryPromise({
      try: () => shiki.createCodeHighlighter(),
      catch: (cause) => new HighlighterUnavailable({ cause }),
    })
  }),
).pipe(Atom.keepAlive)

export const HighlighterContext = React.createContext<Option.Option<CodeHighlighter>>(Option.none())

export const useHighlighter = (): Option.Option<CodeHighlighter> =>
  React.useContext(HighlighterContext)

export const languageOfPath = (path: string): Option.Option<string> =>
  pipe(
    Option.fromUndefinedOr(path.split('.').at(-1)),
    Option.filter((extension) => extension !== path),
    Option.flatMap((extension) =>
      Option.fromUndefinedOr(LANGUAGE_OF_EXTENSION.get(extension.toLowerCase())),
    ),
  )

const isLine = (node: HastNode): boolean =>
  node.type === 'element' &&
  pipe(
    Arr.ensure(node.properties.className ?? []),
    Arr.some((name) => name === LINE_CLASS),
  )

const childrenOf = (node: HastNode): readonly HastNode[] =>
  node.type === 'element' ? node.children : []

const lineNodes = (root: HastRoot): readonly HastNode[] =>
  pipe(root.children, Arr.flatMap(childrenOf), Arr.flatMap(childrenOf), Arr.filter(isLine))

const declarationOf = (declaration: string): Option.Option<readonly [string, string]> =>
  pipe(
    Option.fromNullishOr(STYLE_DECLARATION.exec(declaration)),
    Option.flatMap((match) =>
      Option.all([Option.fromUndefinedOr(match[1]), Option.fromUndefinedOr(match[2])]),
    ),
    Option.map(([property, value]): readonly [string, string] => [
      property.startsWith(CUSTOM_PROPERTY_PREFIX) ? property : Str.camelCase(property),
      value,
    ]),
  )

const styleOf = (node: HastElement): React.CSSProperties =>
  pipe(
    Schema.decodeUnknownOption(Schema.String)(node.properties.style),
    Option.map((style) =>
      Object.fromEntries(pipe(style.split(STYLE_SEPARATOR), Arr.map(declarationOf), Arr.getSomes)),
    ),
    Option.getOrElse(() => ({})),
  )

const renderNode = (node: HastNode, index: number): React.ReactNode => {
  if (node.type === 'text') {
    return node.value
  }

  if (node.type !== 'element') {
    return null
  }

  return (
    <span key={index} style={styleOf(node)}>
      {Arr.map(node.children, renderNode)}
    </span>
  )
}

const renderLine = (line: HastNode): React.ReactNode => Arr.map(childrenOf(line), renderNode)

export const highlightLines = (
  highlighter: CodeHighlighter,
  code: string,
  language: string,
): Option.Option<readonly React.ReactNode[]> =>
  pipe(
    Option.liftPredicate(language, (name) => highlighter.getLoadedLanguages().includes(name)),
    Option.map((lang) =>
      highlighter.codeToHast(code, {
        lang,
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
      }),
    ),
    Option.map((root) => Arr.map(lineNodes(root), renderLine)),
  )

export const useHighlightedLines = (
  code: string,
  language: Option.Option<string>,
): Option.Option<readonly React.ReactNode[]> => {
  const highlighter = useHighlighter()
  const name = Option.getOrElse(language, () => '')

  return React.useMemo(
    () =>
      Option.flatMap(
        Option.all({ found: highlighter, lang: Option.liftPredicate(name, Str.isNonEmpty) }),
        ({ found, lang }) => highlightLines(found, code, lang),
      ),
    [highlighter, code, name],
  )
}
