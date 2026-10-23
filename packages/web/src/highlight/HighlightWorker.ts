import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import type { HighlighterCore } from 'shiki/core'

import {
  HighlightJob,
  HighlightReply,
  highlightedLines,
} from '@crook/web/highlight/HighlightedCode'
import { HighlighterUnavailable } from '@crook/web/highlight/HighlighterUnavailable'
import { createCodeHighlighter } from '@crook/web/highlight/Shiki'

const decodeJob = Schema.decodeUnknownEffect(HighlightJob)
const encodeReply = Schema.encodeEffect(HighlightReply)

const answer = (highlighter: Option.Option<HighlighterCore>, job: HighlightJob) =>
  encodeReply({
    id: job.id,
    lines: Option.flatMap(highlighter, (found) => highlightedLines(found, job.code, job.language)),
  }).pipe(
    Effect.flatMap((reply) =>
      Effect.sync(() => {
        postMessage(reply)
      }),
    ),
  )

const loadHighlighter = Effect.tryPromise({
  try: () => createCodeHighlighter(),
  catch: (cause) => new HighlighterUnavailable({ cause }),
}).pipe(
  Effect.asSome,
  Effect.catchTag('HighlighterUnavailable', (error) =>
    Effect.as(Effect.logWarning(error.message), Option.none<HighlighterCore>()),
  ),
)

const serve = Effect.gen(function* () {
  const highlighter = yield* Effect.cached(loadHighlighter)

  return yield* Stream.fromEventListener<MessageEvent>(globalThis, 'message').pipe(
    Stream.runForEach((event) =>
      decodeJob(event.data).pipe(
        Effect.flatMap((job) => Effect.flatMap(highlighter, (loaded) => answer(loaded, job))),
        Effect.catchTag('SchemaError', (error) =>
          Effect.logWarning(
            `The code highlighter got a request it could not read: ${error.message}`,
          ),
        ),
      ),
    ),
  )
})

Effect.runFork(serve)
