import * as Arr from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Redacted from 'effect/Redacted'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

import { CrookHubToken, CrookHubUrl, HUB_AUTHORIZATION_HEADER } from '@crook/agent/HubLink'
import {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  stateFile,
} from '@crook/agent/StateDirectory'
import { type AttachmentRef, attachmentDigestOf } from '@crook/domain/Command'
import { ATTACHMENT_FETCH_TIMEOUT } from '@crook/protocol/AgentLink'
import { AttachmentUnavailable } from '@crook/protocol/Commands'
import { UPLOADS_PATH } from '@crook/protocol/HubRoutes'

export interface SavedAttachment {
  readonly path: string
  readonly picture: boolean
}

export type SaveAttachments = (
  attachments: readonly AttachmentRef[],
) => Effect.Effect<readonly SavedAttachment[], AttachmentUnavailable>

interface PictureKind {
  readonly signature: readonly number[]
  readonly extension: string
}

const UPLOADS_KEPT_FOR = Duration.days(7)
const NAME_LENGTH_LIMIT = 120
const DIGEST_FOLDER_LENGTH = 16
const FALLBACK_NAME = 'attachment'
const ATTACHED_FILE_LABEL = 'Attached file:'
const UNSAFE_NAME_CHARACTERS = /[^\w.-]+/gu
const LEADING_DOTS_OR_DASHES = /^[.-]+/u
const EXTENSION = /\.[^.]*$/u
const SECURE_SCHEME = 'wss:'
const HTTPS = 'https:'
const HTTP = 'http:'

const PICTURE_KINDS: readonly PictureKind[] = [
  { signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], extension: '.png' },
  { signature: [0xff, 0xd8, 0xff], extension: '.jpg' },
]

export const CrookUploadsPath = stateFile('CROOK_UPLOADS_PATH', 'uploads')

const pictureExtensionOf = (bytes: Uint8Array): Option.Option<string> =>
  pipe(
    Arr.findFirst(PICTURE_KINDS, (kind) =>
      kind.signature.every((byte, index) => bytes[index] === byte),
    ),
    Option.map((kind) => kind.extension),
  )

export const safeFileName = (name: string, pictureExtension: Option.Option<string>): string => {
  const cleaned = name
    .replaceAll(UNSAFE_NAME_CHARACTERS, '-')
    .replace(LEADING_DOTS_OR_DASHES, '')
    .slice(0, NAME_LENGTH_LIMIT)
  const named = cleaned.length > 0 ? cleaned : FALLBACK_NAME

  return Option.match(pictureExtension, {
    onNone: () => named,
    onSome: (extension) => `${named.replace(EXTENSION, '')}${extension}`,
  })
}

export const uploadUrl = (hubUrl: URL, digest: string): URL => {
  const url = new URL(`${UPLOADS_PATH}/${digest}`, hubUrl)

  url.protocol = url.protocol === SECURE_SCHEME ? HTTPS : HTTP

  return url
}

export const promptText = (saved: readonly SavedAttachment[], text: string): string =>
  [
    ...saved.filter((file) => file.picture).map((file) => file.path),
    ...saved.filter((file) => !file.picture).map((file) => `${ATTACHED_FILE_LABEL} ${file.path}`),
    ...(text.length > 0 ? [text] : []),
  ].join('\n')

const unavailable = (reason: string) => () => new AttachmentUnavailable({ reason })

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const client = yield* HttpClient.HttpClient
  const hubUrl = yield* CrookHubUrl
  const token = yield* CrookHubToken
  const directory = yield* CrookUploadsPath

  const download = (attachment: AttachmentRef) =>
    HttpClientRequest.get(uploadUrl(hubUrl, attachment.digest)).pipe(
      HttpClientRequest.setHeader(HUB_AUTHORIZATION_HEADER, `Bearer ${Redacted.value(token)}`),
      client.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.map((buffer) => new Uint8Array(buffer)),
      Effect.timeout(ATTACHMENT_FETCH_TIMEOUT),
      Effect.mapError(unavailable(`the hub did not hand over "${attachment.name}"`)),
    )

  const sweep = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const oldest = now - Duration.toMillis(UPLOADS_KEPT_FOR)
    const entries = (yield* fileSystem.exists(directory))
      ? yield* fileSystem.readDirectory(directory)
      : []

    yield* Effect.forEach(entries, (entry) => {
      const folder = path.join(directory, entry)

      return fileSystem.stat(folder).pipe(
        Effect.map((info) => Option.exists(info.mtime, (changed) => changed.getTime() < oldest)),
        Effect.flatMap((stale) =>
          stale ? fileSystem.remove(folder, { recursive: true }) : Effect.void,
        ),
      )
    })
  }).pipe(
    Effect.catchTag('PlatformError', (error) =>
      Effect.logWarning(
        `crook could not clear old attachments from ${directory}: ${error.message}`,
      ),
    ),
  )

  const saveOne = Effect.fn('AttachmentFiles.saveOne')(function* (attachment: AttachmentRef) {
    const bytes = yield* download(attachment)
    const digest = yield* attachmentDigestOf(bytes)

    if (digest !== attachment.digest) {
      return yield* new AttachmentUnavailable({
        reason: `"${attachment.name}" arrived with other bytes than the phone sent`,
      })
    }

    const pictureExtension = pictureExtensionOf(bytes)
    const folder = path.join(directory, digest.slice(0, DIGEST_FOLDER_LENGTH))
    const file = path.join(folder, safeFileName(attachment.name, pictureExtension))

    yield* fileSystem
      .makeDirectory(folder, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE })
      .pipe(
        Effect.andThen(fileSystem.writeFile(file, bytes, { mode: OWNER_ONLY_FILE_MODE })),
        Effect.andThen(fileSystem.chmod(file, OWNER_ONLY_FILE_MODE)),
        Effect.mapError(unavailable(`crook could not write "${attachment.name}" to ${folder}`)),
      )

    return { path: file, picture: Option.isSome(pictureExtension) }
  })

  const save = Effect.fn('AttachmentFiles.save')(function* (attachments: readonly AttachmentRef[]) {
    const saved = yield* Effect.forEach(attachments, saveOne)

    yield* sweep

    return saved
  })

  yield* sweep

  return AttachmentFiles.of({ save })
})

export class AttachmentFiles extends Context.Service<
  AttachmentFiles,
  {
    readonly save: SaveAttachments
  }
>()('@crook/agent/AttachmentFiles') {
  static readonly layer = Layer.effect(this, make)
}
