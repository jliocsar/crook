import { useAtomValue } from '@effect/atom-react/Hooks'
import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'
import * as React from 'react'

import {
  recallLines,
  remember,
  RenderedLines,
  useRenderCache,
} from '@crook/web/components/RenderCache'
import {
  HighlightJob,
  HighlightReply,
  isStyled,
  type HighlightedLines,
  type HighlightToken,
} from '@crook/web/highlight/HighlightedCode'
import { HighlighterUnavailable } from '@crook/web/highlight/HighlighterUnavailable'
import { LINE_BREAK } from '@crook/web/text/Lines'

interface CodeHighlighter {
  readonly highlight: (
    code: string,
    language: string,
  ) => Effect.Effect<Option.Option<HighlightedLines>>
}

const CUSTOM_PROPERTY_PREFIX = '--'
const STYLE_SEPARATOR = ';'
const STYLE_DECLARATION = /^\s*([^:]+?)\s*:\s*(.+?)\s*$/u
const NO_LANGUAGE = ''

export const HIGHLIGHT_LINE_LIMIT = 300
export const SHELL_LANGUAGE = 'shellscript'

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

class HighlightKey extends Data.Class<{ readonly code: string; readonly language: string }> {}

const encodeJob = Schema.encodeSync(HighlightJob)
const decodeReply = Schema.decodeUnknownOption(HighlightReply)

const openWorker = Effect.try({
  try: () =>
    new Worker(new URL('./HighlightWorker.ts', import.meta.url), {
      type: 'module',
      name: 'highlighter',
    }),
  catch: (cause) => new HighlighterUnavailable({ cause }),
})

const connect = Effect.gen(function* () {
  const worker = yield* Effect.acquireRelease(openWorker, (opened) =>
    Effect.sync(() => {
      opened.terminate()
    }),
  )
  const nextId = yield* Ref.make(0)
  const waiting = new Map<number, (lines: Option.Option<HighlightedLines>) => void>()

  worker.addEventListener('message', (event) => {
    Option.map(decodeReply(event.data), (reply) => {
      waiting.get(reply.id)?.(reply.lines)
      waiting.delete(reply.id)
    })
  })

  const highlight = (code: string, language: string) =>
    Effect.flatMap(
      Ref.getAndUpdate(nextId, (id) => id + 1),
      (id) =>
        Effect.callback<Option.Option<HighlightedLines>>((resume) => {
          waiting.set(id, (lines) => {
            resume(Effect.succeed(lines))
          })
          worker.postMessage(encodeJob({ id, code, language }))

          return Effect.sync(() => {
            waiting.delete(id)
          })
        }),
    )

  return { highlight } satisfies CodeHighlighter
})

const highlighterAtom = Atom.make(connect).pipe(Atom.keepAlive)

const highlightedAtom = Atom.family((key: HighlightKey) =>
  Atom.make((get) =>
    key.language === NO_LANGUAGE
      ? Effect.succeedNone
      : Effect.flatMap(get.result(highlighterAtom), (highlighter) =>
          highlighter.highlight(key.code, key.language),
        ),
  ),
)

export const languageOfPath = (path: string): Option.Option<string> =>
  pipe(
    Option.fromUndefinedOr(path.split('.').at(-1)),
    Option.filter((extension) => extension !== path),
    Option.flatMap((extension) =>
      Option.fromUndefinedOr(LANGUAGE_OF_EXTENSION.get(extension.toLowerCase())),
    ),
  )

const isShortEnough = (code: string): boolean =>
  code.split(LINE_BREAK).length <= HIGHLIGHT_LINE_LIMIT

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

const styleOf = (style: string): React.CSSProperties =>
  Object.fromEntries(pipe(style.split(STYLE_SEPARATOR), Arr.map(declarationOf), Arr.getSomes))

const renderToken = (token: HighlightToken, index: number): React.ReactNode =>
  isStyled(token) ? (
    <span key={index} style={styleOf(token.style)}>
      {token.content}
    </span>
  ) : (
    token.content
  )

export const renderLines = (lines: HighlightedLines): readonly React.ReactNode[] =>
  Arr.map(lines, (line) => Arr.map(line, renderToken))

export const useHighlightedLines = (
  code: string,
  language: Option.Option<string>,
): Option.Option<readonly React.ReactNode[]> => {
  const cache = useRenderCache()
  const name = Option.getOrElse(language, () => NO_LANGUAGE)
  const cacheKey = `${name}${LINE_BREAK}${code}`
  const recalled = recallLines(cache, cacheKey)
  const wanted = Option.isNone(recalled) && Str.isNonEmpty(name) && isShortEnough(code)
  const key = React.useMemo(
    () => new HighlightKey({ code: wanted ? code : '', language: wanted ? name : NO_LANGUAGE }),
    [wanted, code, name],
  )
  const result = useAtomValue(highlightedAtom(key))
  const fresh = React.useMemo(
    () => Option.map(Option.flatten(AsyncResult.value(result)), renderLines),
    [result],
  )

  React.useEffect(() => {
    if (Option.isSome(fresh)) {
      remember(cache, cacheKey, new RenderedLines(fresh.value))
    }
  }, [cache, cacheKey, fresh])

  return Option.orElse(recalled, () => fresh)
}
