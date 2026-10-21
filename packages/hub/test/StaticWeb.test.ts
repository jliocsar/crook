import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as HttpClient from 'effect/http/HttpClient'

import {
  EMBEDDED_WEB_DIRECTORY,
  type HubBundle,
  WebBuildMissing,
  WebRootUnset,
  resolveWebRoot,
} from '@crook/hub/StaticWeb'
import { SERVICE_WORKER_PATH } from '@crook/protocol/HubRoutes'
import { CONTENT_SECURITY_POLICY } from '@crook/web/csp/ContentSecurityPolicy'

import { ownerLogin, testHub } from './Fixtures'

const FIXTURE_WEB_ROOT = `${import.meta.dirname}/web`
const LATER_THAN_ANY_BUILD = 'Fri, 31 Dec 9999 23:59:59 GMT'

const NOT_EMBEDDING: HubBundle = {
  embedsFiles: false,
  directory: import.meta.dirname,
}

const headersOf = (path: string, headers: Record<string, string>) =>
  Effect.map(HttpClient.get(path, { headers }), (response) => ({
    status: response.status,
    contentSecurityPolicy: response.headers['content-security-policy'],
    cacheControl: response.headers['cache-control'],
    contentType: response.headers['content-type'],
  }))

const rootUnder = (environment: Record<string, string>, bundle: HubBundle) =>
  resolveWebRoot(bundle).pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(environment)),
  )

const embeddingBundle = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped()

  yield* fileSystem.makeDirectory(`${directory}/${EMBEDDED_WEB_DIRECTORY}`)
  yield* fileSystem.writeFileString(
    `${directory}/${EMBEDDED_WEB_DIRECTORY}/index.html`,
    '<title>crook</title>',
  )

  return { embedsFiles: true, directory }
})

layer(testHub, { excludeTestServices: true })('StaticWeb over HTTP', (live) => {
  live.effect('sends the content security policy with the shell and with a deep link', () =>
    Effect.gen(function* () {
      const shell = yield* headersOf('/', ownerLogin)
      const deepLink = yield* headersOf('/herd', { ...ownerLogin, Accept: 'text/html' })

      expect(shell).toEqual({
        status: 200,
        contentSecurityPolicy: CONTENT_SECURITY_POLICY,
        cacheControl: undefined,
        contentType: 'text/html; charset=utf-8',
      })
      expect(deepLink).toEqual(shell)
    }),
  )

  live.effect('answers a conditional request in full and sends no validators to make one', () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get('/', {
        headers: {
          ...ownerLogin,
          'If-None-Match': '*',
          'If-Modified-Since': LATER_THAN_ANY_BUILD,
        },
      })

      expect({
        status: response.status,
        etag: response.headers['etag'],
        lastModified: response.headers['last-modified'],
      }).toEqual({ status: 200, etag: undefined, lastModified: undefined })
    }),
  )

  live.effect('has the browser revalidate the service worker every time it checks for one', () =>
    Effect.gen(function* () {
      expect(yield* headersOf(SERVICE_WORKER_PATH, ownerLogin)).toEqual({
        status: 200,
        contentSecurityPolicy: CONTENT_SECURITY_POLICY,
        cacheControl: 'no-cache',
        contentType: 'text/javascript; charset=utf-8',
      })
    }),
  )
})

layer(Layer.mergeAll(BunFileSystem.layer, Path.layer))('StaticWeb.resolveWebRoot', (it) => {
  it.effect('serves the configured directory, even from a hub that embeds a build', () =>
    Effect.gen(function* () {
      const embedding = yield* embeddingBundle

      expect(yield* rootUnder({ CROOK_WEB_ROOT: FIXTURE_WEB_ROOT }, NOT_EMBEDDING)).toBe(
        FIXTURE_WEB_ROOT,
      )
      expect(yield* rootUnder({ CROOK_WEB_ROOT: FIXTURE_WEB_ROOT }, embedding)).toBe(
        FIXTURE_WEB_ROOT,
      )
    }),
  )

  it.effect('serves the embedded build when nothing is configured', () =>
    Effect.gen(function* () {
      const embedding = yield* embeddingBundle

      expect(yield* rootUnder({}, embedding)).toBe(
        `${embedding.directory}/${EMBEDDED_WEB_DIRECTORY}`,
      )
    }),
  )

  it.effect('refuses to start with nothing to serve', () =>
    Effect.gen(function* () {
      const elsewhere = `${import.meta.dirname}/nothing-here`

      expect(yield* Effect.flip(rootUnder({}, NOT_EMBEDDING))).toEqual(new WebRootUnset())
      expect(yield* Effect.flip(rootUnder({ CROOK_WEB_ROOT: elsewhere }, NOT_EMBEDDING))).toEqual(
        new WebBuildMissing({ root: elsewhere }),
      )
    }),
  )
})
