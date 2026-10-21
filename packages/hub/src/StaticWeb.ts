import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { flow, pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import * as Headers from 'effect/http/Headers'
import type * as HttpServerError from 'effect/http/HttpServerError'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as HttpStaticServer from 'effect/http/HttpStaticServer'

import { SERVICE_WORKER_PATH } from '@crook/protocol/HubRoutes'
import { CONTENT_SECURITY_POLICY } from '@crook/web/csp/ContentSecurityPolicy'

export interface HubBundle {
  readonly embedsFiles: boolean
  readonly directory: string
}

const INDEX_FILE = 'index.html'
const REVALIDATE_EVERY_TIME = 'no-cache'

export const EMBEDDED_WEB_DIRECTORY = 'dist'

const CONDITIONAL_REQUEST_HEADERS: readonly string[] = [
  'if-none-match',
  'if-modified-since',
  'if-range',
]

export const CrookWebRoot = Config.option(Config.String('CROOK_WEB_ROOT'))

export const thisBundle: HubBundle = {
  embedsFiles: Bun.embeddedFiles.length > 0,
  directory: import.meta.dirname,
}

export class WebRootUnset extends Schema.TaggedError<WebRootUnset>()('WebRootUnset', {}) {
  override get message(): string {
    return 'CROOK_WEB_ROOT is not set and this hub embeds no web build, so it has no PWA to serve. Set CROOK_WEB_ROOT to the dist directory that `bun run --filter @crook/web build` writes, or run a compiled hub, which embeds it.'
  }
}

export class WebBuildMissing extends Schema.TaggedError<WebBuildMissing>()('WebBuildMissing', {
  root: Schema.String,
}) {
  override get message(): string {
    return `The web root ${this.root} holds no ${INDEX_FILE}, so the hub has no PWA to serve. Point CROOK_WEB_ROOT at the dist directory that \`bun run --filter @crook/web build\` writes.`
  }
}

export const shellHeaders = (pathname: string): Record<string, string> =>
  pathname === SERVICE_WORKER_PATH
    ? { 'Content-Security-Policy': CONTENT_SECURITY_POLICY, 'Cache-Control': REVALIDATE_EVERY_TIME }
    : { 'Content-Security-Policy': CONTENT_SECURITY_POLICY }

const pathnameOf = (request: HttpServerRequest.HttpServerRequest) =>
  pipe(
    HttpServerRequest.toURL(request),
    Option.map((url) => url.pathname),
    Option.getOrElse(() => request.url),
  )

const unconditional = (request: HttpServerRequest.HttpServerRequest) =>
  request.modify({ headers: Headers.removeMany(request.headers, CONDITIONAL_REQUEST_HEADERS) })

const withoutValidators = flow(
  HttpServerResponse.removeHeader('etag'),
  HttpServerResponse.removeHeader('last-modified'),
)

export const resolveWebRoot = Effect.fn('StaticWeb.resolveWebRoot')(function* (bundle: HubBundle) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const configured = yield* CrookWebRoot
  const root = yield* pipe(
    configured,
    Option.orElse(() =>
      Option.liftPredicate(
        path.join(bundle.directory, EMBEDDED_WEB_DIRECTORY),
        () => bundle.embedsFiles,
      ),
    ),
    Option.match({
      onNone: () => Effect.fail(new WebRootUnset()),
      onSome: Effect.succeed,
    }),
  )

  return yield* fileSystem.exists(path.join(root, INDEX_FILE)).pipe(
    Effect.filterOrFail(
      (hasIndex) => hasIndex,
      () => new WebBuildMissing({ root }),
    ),
    Effect.as(root),
  )
})

const withShellHeaders = (
  serve: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    HttpServerError.HttpServerError,
    HttpServerRequest.HttpServerRequest
  >,
) =>
  HttpServerRequest.HttpServerRequest.use((request) =>
    serve.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, unconditional(request)),
      Effect.map(
        flow(withoutValidators, HttpServerResponse.setHeaders(shellHeaders(pathnameOf(request)))),
      ),
    ),
  )

export const make = (bundle: HubBundle) =>
  resolveWebRoot(bundle).pipe(
    Effect.flatMap((root) => HttpStaticServer.make({ root, spa: true })),
    Effect.map(withShellHeaders),
    Effect.withSpan('StaticWeb.make'),
  )
