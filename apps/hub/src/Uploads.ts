import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as HttpServerRespondable from 'effect/http/HttpServerRespondable'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

import { ATTACHMENT_BYTES_LIMIT, AttachmentDigest, attachmentDigestOf } from '@crook/domain/Command'
import type { MachineId } from '@crook/domain/Ids'

interface HeldUpload {
  readonly machine: MachineId
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly expiresAt: number
}

const UPLOADS_HELD_FOR = Duration.minutes(15)
const BAD_REQUEST = 400
const NOT_FOUND = 404
const PAYLOAD_TOO_LARGE = 413
const UNPROCESSABLE = 422
const INSUFFICIENT_STORAGE = 507
const HELD_MESSAGES = 4

export const UPLOADS_HELD_BYTES = ATTACHMENT_BYTES_LIMIT * HELD_MESSAGES

export class UploadDigestMismatch extends Schema.TaggedError<UploadDigestMismatch>()(
  'UploadDigestMismatch',
  { claimed: AttachmentDigest, actual: AttachmentDigest },
) {
  override get message(): string {
    return 'The upload arrived with other bytes than its name says, so the hub dropped it. Attach the file again and resend.'
  }

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(HttpServerResponse.text(this.message, { status: UNPROCESSABLE }))
  }
}

export class UploadTooLarge extends Schema.TaggedError<UploadTooLarge>()('UploadTooLarge', {
  size: Schema.Int,
}) {
  override get message(): string {
    return 'That file is larger than a message can carry, so the hub refused it. Attach a smaller one.'
  }

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(HttpServerResponse.text(this.message, { status: PAYLOAD_TOO_LARGE }))
  }
}

export class UploadsFull extends Schema.TaggedError<UploadsFull>()('UploadsFull', {}) {
  override get message(): string {
    return 'The hub is holding as many uploads as it can right now. Wait a few minutes and send again.'
  }

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(HttpServerResponse.text(this.message, { status: INSUFFICIENT_STORAGE }))
  }
}

export class UploadRequestInvalid extends Schema.TaggedError<UploadRequestInvalid>()(
  'UploadRequestInvalid',
  { reason: Schema.String },
) {
  override get message(): string {
    return `The hub could not read this upload: ${this.reason}. Attach the file again and resend.`
  }

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(HttpServerResponse.text(this.message, { status: BAD_REQUEST }))
  }
}

export class UploadNotHeld extends Schema.TaggedError<UploadNotHeld>()('UploadNotHeld', {}) {
  override get message(): string {
    return 'The hub holds no such upload for this machine. It may have expired; send the message again from the phone.'
  }

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(HttpServerResponse.text(this.message, { status: NOT_FOUND }))
  }
}

const keyOf = (machine: MachineId, digest: AttachmentDigest) => `${machine}\u0000${digest}`

const heldBytes = (held: ReadonlyMap<string, HeldUpload>) =>
  Array.from(held.values()).reduce((sum, upload) => sum + upload.bytes.byteLength, 0)

const unexpired = (held: ReadonlyMap<string, HeldUpload>, now: number) =>
  new Map(Array.from(held).filter(([, upload]) => upload.expiresAt > now))

const make = Effect.gen(function* () {
  const held = yield* Ref.make<ReadonlyMap<string, HeldUpload>>(new Map())

  const put = Effect.fn('Uploads.put')(function* (
    machine: MachineId,
    claimed: AttachmentDigest,
    bytes: Uint8Array<ArrayBuffer>,
  ) {
    if (bytes.byteLength > ATTACHMENT_BYTES_LIMIT) {
      return yield* new UploadTooLarge({ size: bytes.byteLength })
    }

    const actual = yield* attachmentDigestOf(bytes)

    if (actual !== claimed) {
      return yield* new UploadDigestMismatch({ claimed, actual })
    }

    const now = yield* Clock.currentTimeMillis
    const upload = { machine, bytes, expiresAt: now + Duration.toMillis(UPLOADS_HELD_FOR) }

    const admitted = yield* Ref.modify(
      held,
      (current): readonly [boolean, ReadonlyMap<string, HeldUpload>] => {
        const kept = unexpired(current, now)

        kept.delete(keyOf(machine, claimed))

        return heldBytes(kept) + bytes.byteLength > UPLOADS_HELD_BYTES
          ? [false, kept]
          : [true, kept.set(keyOf(machine, claimed), upload)]
      },
    )

    return yield* admitted ? Effect.void : Effect.fail(new UploadsFull())
  })

  const take = Effect.fn('Uploads.take')(function* (machine: MachineId, digest: AttachmentDigest) {
    const now = yield* Clock.currentTimeMillis
    const current = yield* Ref.get(held)

    return Option.filter(
      Option.fromUndefinedOr(current.get(keyOf(machine, digest))),
      (upload) => upload.expiresAt > now,
    ).pipe(Option.map((upload) => upload.bytes))
  })

  return Uploads.of({ put, take })
})

export class Uploads extends Context.Service<
  Uploads,
  {
    readonly put: (
      machine: MachineId,
      digest: AttachmentDigest,
      bytes: Uint8Array<ArrayBuffer>,
    ) => Effect.Effect<void, UploadDigestMismatch | UploadTooLarge | UploadsFull>
    readonly take: (
      machine: MachineId,
      digest: AttachmentDigest,
    ) => Effect.Effect<Option.Option<Uint8Array<ArrayBuffer>>>
  }
>()('@crook/hub/Uploads') {
  static readonly layer = Layer.effect(this, make)
}
