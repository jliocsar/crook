import { cn } from 'cn'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as React from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  recallNode,
  remember,
  RenderedNode,
  useRenderCache,
  type CodeRenderer,
} from '@crook/web/components/RenderCache'

type ResponseProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  children: string
  renderCode?: CodeRenderer
}

const FENCE_LANGUAGE = /language-([\w+-]+)/u
const TRAILING_NEWLINE = /\n$/u
const REMARK_PLUGINS = [remarkGfm]
const DISALLOWED_ELEMENTS = ['img']
const MARKDOWN_SLOT = 'markdown'

const decodeText = Schema.decodeUnknownOption(Schema.String)

const fenceLanguage = (className: string | undefined): Option.Option<string> =>
  Option.flatMap(Option.fromNullishOr(FENCE_LANGUAGE.exec(className ?? '')), (match) =>
    Option.fromUndefinedOr(match[1]),
  )

const markdownComponents = (renderCode: ResponseProps['renderCode']): Components => ({
  code({ className, children }) {
    const language = fenceLanguage(className)
    const body = Option.getOrElse(decodeText(children), () => '').replace(TRAILING_NEWLINE, '')

    if (Option.isNone(language) && !body.includes('\n')) {
      return (
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
      )
    }

    if (renderCode !== undefined) {
      return <>{renderCode(body, language)}</>
    }

    return (
      <span className="border-border bg-muted/40 my-3 block overflow-x-auto rounded-[var(--radius)] border p-3">
        <code className="font-mono text-xs whitespace-pre">{body}</code>
      </span>
    )
  },
  pre({ children }) {
    return <>{children}</>
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    )
  },
})

export const Response = React.memo(MarkdownResponse)

function MarkdownResponse({ children, renderCode, className, ...rootProps }: ResponseProps) {
  const cache = useRenderCache()
  const components = React.useMemo(() => markdownComponents(renderCode), [renderCode])
  const cacheKey = `${MARKDOWN_SLOT} ${children}`
  const rendered = React.useMemo(
    () =>
      Option.getOrElse(recallNode(cache, cacheKey, renderCode), () =>
        Markdown({
          remarkPlugins: REMARK_PLUGINS,
          disallowedElements: DISALLOWED_ELEMENTS,
          components,
          children,
        }),
      ),
    [cache, cacheKey, components, children],
  )

  React.useEffect(() => {
    remember(cache, cacheKey, new RenderedNode(rendered, renderCode))
  }, [cache, cacheKey, rendered, renderCode])

  return (
    <div
      data-slot="response"
      className={cn(
        'min-w-0 text-base leading-6 break-words [&_a]:underline [&_a]:underline-offset-4 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&>*+*]:mt-3 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_table]:block [&_table]:overflow-x-auto [&_th]:px-2 [&_td]:px-2 [&_blockquote]:border-border [&_blockquote]:border-l-2 [&_blockquote]:pl-3',
        className,
      )}
      {...rootProps}
    >
      {rendered}
    </div>
  )
}
