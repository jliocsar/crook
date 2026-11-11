import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

import type { AttachmentDigest } from '@crook/domain/Command'
import type { MachineId } from '@crook/domain/Ids'
import { ATTACHMENT_FETCH_TIMEOUT } from '@crook/protocol/AgentLink'
import { UPLOAD_MACHINE_PARAMETER, UPLOADS_PATH } from '@crook/protocol/HubRoutes'

export interface HeldUpload {
  readonly digest: AttachmentDigest
  readonly bytes: Uint8Array<ArrayBuffer>
}

export type UploadFailed = UploadRefused | UploadUnreachable

const SAME_ORIGIN_REQUEST: RequestInit = { credentials: 'same-origin', cache: 'no-store' }

export class UploadRefused extends Schema.TaggedError<UploadRefused>()('UploadRefused', {
  status: Schema.Int,
  hubAnswer: Schema.String,
}) {
  override get message(): string {
    return this.hubAnswer.length > 0
      ? this.hubAnswer
      : `The hub refused an attachment (status ${this.status}), so nothing was sent. Remove it, attach it again and send.`
  }
}

export class UploadUnreachable extends Schema.TaggedError<UploadUnreachable>()(
  'UploadUnreachable',
  { detail: Schema.String },
) {
  override get message(): string {
    return "crook could not upload an attachment to the hub, so nothing was sent. Check the phone's network and send again."
  }
}

const makeHubUploads = Effect.fn('makeHubUploads')(function* (page: URL) {
  const client = yield* HttpClient.HttpClient

  const upload = (machine: MachineId, held: HeldUpload) => {
    const url = new URL(`${UPLOADS_PATH}/${held.digest}`, page)

    url.searchParams.set(UPLOAD_MACHINE_PARAMETER, machine)

    return HttpClientRequest.put(url).pipe(
      HttpClientRequest.bodyUint8Array(held.bytes),
      client.execute,
      Effect.provideService(FetchHttpClient.RequestInit, SAME_ORIGIN_REQUEST),
      Effect.timeout(ATTACHMENT_FETCH_TIMEOUT),
      Effect.mapError((error) => new UploadUnreachable({ detail: error.message })),
      Effect.flatMap(
        HttpClientResponse.matchStatus({
          '2xx': () => Effect.void,
          orElse: (response) =>
            response.text.pipe(
              Effect.orElseSucceed(() => ''),
              Effect.flatMap((hubAnswer) =>
                Effect.fail(new UploadRefused({ status: response.status, hubAnswer })),
              ),
            ),
        }),
      ),
      Effect.withSpan('HubUploads.upload'),
    )
  }

  return HubUploads.of({ upload })
})

export class HubUploads extends Context.Service<
  HubUploads,
  {
    readonly upload: (machine: MachineId, held: HeldUpload) => Effect.Effect<void, UploadFailed>
  }
>()('@crook/web/HubUploads') {
  static readonly layerOnPage = (page: URL) => Layer.effect(this, makeHubUploads(page))

  static readonly layer = Layer.unwrap(
    Effect.sync(() => HubUploads.layerOnPage(new URL(window.location.href))),
  )
}
