import { expect, it } from '@effect/vitest'
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as Clock from 'effect/Clock'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as HttpClient from 'effect/http/HttpClient'
import type * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

import { AttachmentFiles, promptText, safeFileName, uploadUrl } from '@crook/agent/AttachmentFiles'
import { AttachmentRef, type AttachmentDigest, attachmentDigestOf } from '@crook/domain/Command'
import { AttachmentUnavailable } from '@crook/protocol/Commands'

interface HeldBytes {
  readonly digest: AttachmentDigest
  readonly bytes: Uint8Array<ArrayBuffer>
}

const HUB_URL = 'wss://hub.example/rpc/agent'
const HUB_TOKEN = 'machine-token'
const NOT_FOUND = 404
const OK = 200
const OWNER_ONLY_FILE = 0o600
const PERMISSION_BITS = 0o777
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const TEXT_BYTES = new TextEncoder().encode('build failed at step 3')
const PAST_A_WEEK = Duration.days(8)
const WITHIN_A_WEEK = Duration.hours(1)

const refOf = (name: string, mediaType: string, held: HeldBytes) =>
  new AttachmentRef({ name, mediaType, size: held.bytes.byteLength, digest: held.digest })

const heldOf = (bytes: Uint8Array<ArrayBuffer>) =>
  Effect.map(attachmentDigestOf(bytes), (digest): HeldBytes => ({ digest, bytes }))

const hubHolding = (
  held: readonly HeldBytes[],
  requests: Ref.Ref<readonly HttpClientRequest.HttpClientRequest[]>,
) =>
  HttpClient.make((request) =>
    Ref.update(requests, (seen) => [...seen, request]).pipe(
      Effect.as(
        HttpClientResponse.fromWeb(
          request,
          Option.match(
            Option.fromUndefinedOr(held.find((entry) => request.url.endsWith(entry.digest))),
            {
              onNone: () => new Response('gone', { status: NOT_FOUND }),
              onSome: (entry) => new Response(entry.bytes, { status: OK }),
            },
          ),
        ),
      ),
    ),
  )

const filesOver = Effect.fn('filesOver')(function* (held: readonly HeldBytes[], directory: string) {
  const requests = yield* Ref.make<readonly HttpClientRequest.HttpClientRequest[]>([])
  const context = yield* Layer.build(
    AttachmentFiles.layer.pipe(
      Layer.provide([
        Layer.succeed(HttpClient.HttpClient, hubHolding(held, requests)),
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            CROOK_HUB_URL: HUB_URL,
            CROOK_HUB_TOKEN: HUB_TOKEN,
            CROOK_UPLOADS_PATH: directory,
          }),
        ),
        BunFileSystem.layer,
        Path.layer,
      ]),
    ),
  )

  return { files: Context.get(context, AttachmentFiles), requests: Ref.get(requests) }
})

const uploadsFolder = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()

  return `${root}/uploads`
})

const agedBy = Effect.fn('agedBy')(function* (folder: string, age: Duration.Duration) {
  const fileSystem = yield* FileSystem.FileSystem
  const now = yield* Clock.currentTimeMillis
  const seconds = Duration.toSeconds(Duration.subtract(Duration.millis(now), age))

  yield* fileSystem.makeDirectory(folder, { recursive: true })
  yield* fileSystem.utimes(folder, seconds, seconds)
})

it('names a saved file so a pasted line stays one path', () => {
  expect(safeFileName('IMG 2041 (1).HEIC', Option.some('.jpg'))).toBe('IMG-2041-1-.jpg')
  expect(safeFileName('../../.ssh/authorized_keys', Option.none())).toBe('ssh-authorized_keys')
  expect(safeFileName('...', Option.none())).toBe('attachment')
  expect(safeFileName('Screenshot.png', Option.some('.png'))).toBe('Screenshot.png')
})

it('fetches an upload over https from the same host the agent dials', () => {
  expect(uploadUrl(new URL(HUB_URL), 'abc').href).toBe('https://hub.example/uploads/abc')
  expect(uploadUrl(new URL('ws://localhost:4000/rpc/agent'), 'abc').href).toBe(
    'http://localhost:4000/uploads/abc',
  )
})

it('types pictures first, one path a line, then the files, then the words', () => {
  expect(
    promptText(
      [
        { path: '/u/a/log.txt', picture: false },
        { path: '/u/b/shot.png', picture: true },
      ],
      'what broke?',
    ),
  ).toBe('/u/b/shot.png\nAttached file: /u/a/log.txt\nwhat broke?')
  expect(promptText([{ path: '/u/b/shot.png', picture: true }], '')).toBe('/u/b/shot.png')
})

it.live('saves what the hub hands over, owner-only, and asks with the machine token', () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* uploadsFolder
    const picture = yield* heldOf(PNG_BYTES)
    const log = yield* heldOf(TEXT_BYTES)
    const { files, requests } = yield* filesOver([picture, log], directory)

    const saved = yield* files.save([
      refOf('Pasted image', 'image/png', picture),
      refOf('build log.txt', 'text/plain', log),
    ])
    const sent = yield* requests
    const pictureInfo = yield* fileSystem.stat(saved[0]?.path ?? '')

    expect(saved).toEqual([
      { path: `${directory}/${picture.digest.slice(0, 16)}/Pasted-image.png`, picture: true },
      { path: `${directory}/${log.digest.slice(0, 16)}/build-log.txt`, picture: false },
    ])
    expect(new Uint8Array(yield* fileSystem.readFile(saved[1]?.path ?? ''))).toEqual(TEXT_BYTES)
    expect(pictureInfo.mode & PERMISSION_BITS).toBe(OWNER_ONLY_FILE)
    expect(sent.map((request) => request.headers['x-exedev-authorization'])).toEqual([
      `Bearer ${HUB_TOKEN}`,
      `Bearer ${HUB_TOKEN}`,
    ])
  }).pipe(Effect.scoped, Effect.provide([BunFileSystem.layer, Path.layer])),
)

it.live('fails, writing nothing, when the hub no longer holds it or hands over other bytes', () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* uploadsFolder
    const picture = yield* heldOf(PNG_BYTES)
    const swapped = { digest: picture.digest, bytes: TEXT_BYTES }
    const missing = yield* filesOver([], directory)
    const tampered = yield* filesOver([swapped], directory)

    const gone = yield* Effect.exit(missing.files.save([refOf('a.png', 'image/png', picture)]))
    const other = yield* Effect.exit(tampered.files.save([refOf('a.png', 'image/png', picture)]))

    expect(Exit.findErrorOption(gone)).toEqual(
      Option.some(new AttachmentUnavailable({ reason: 'the hub did not hand over "a.png"' })),
    )
    expect(Exit.findErrorOption(other)).toEqual(
      Option.some(
        new AttachmentUnavailable({
          reason: '"a.png" arrived with other bytes than the phone sent',
        }),
      ),
    )
    expect(yield* fileSystem.exists(directory)).toBe(false)
  }).pipe(Effect.scoped, Effect.provide([BunFileSystem.layer, Path.layer])),
)

it.live('clears uploads older than a week when it starts and after each save', () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* uploadsFolder
    yield* agedBy(`${directory}/old`, PAST_A_WEEK)
    yield* agedBy(`${directory}/recent`, WITHIN_A_WEEK)
    yield* filesOver([], directory)

    expect(yield* fileSystem.readDirectory(directory)).toEqual(['recent'])
  }).pipe(Effect.scoped, Effect.provide([BunFileSystem.layer, Path.layer])),
)
