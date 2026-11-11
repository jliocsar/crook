import { expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'
import * as HttpClient from 'effect/http/HttpClient'
import type * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

import { attachmentDigestOf } from '@crook/domain/Command'
import { MachineId } from '@crook/domain/Ids'
import { HubUploads, UploadRefused } from '@crook/web/rpc/HubUploads'

const PAGE = new URL('https://my-hub.exe.xyz/m/laptop/p/w1%3Ap1')
const LAPTOP = MachineId.make('laptop')
const PHOTO = new TextEncoder().encode('a photo')
const NO_CONTENT = 204
const PAYLOAD_TOO_LARGE = 413
const HUB_ANSWER = 'That file is larger than a message can carry, so the hub refused it.'

const uploadsAnswering = Effect.fn('uploadsAnswering')(function* (answer: () => Response) {
  const requests = yield* Ref.make<readonly HttpClientRequest.HttpClientRequest[]>([])
  const client = HttpClient.make((request) =>
    Effect.as(
      Ref.update(requests, (seen) => [...seen, request]),
      HttpClientResponse.fromWeb(request, answer()),
    ),
  )
  const context = yield* Layer.build(
    Layer.provide(HubUploads.layerOnPage(PAGE), Layer.succeed(HttpClient.HttpClient, client)),
  )

  return { uploads: Context.get(context, HubUploads), requests: Ref.get(requests) }
})

it.effect('puts the bytes under their digest on the page’s own hub, naming the machine', () =>
  Effect.gen(function* () {
    const digest = yield* attachmentDigestOf(PHOTO)
    const { uploads, requests } = yield* uploadsAnswering(
      () => new Response(null, { status: NO_CONTENT }),
    )

    yield* uploads.upload(LAPTOP, { digest, bytes: PHOTO })

    const [sent] = yield* requests

    expect(sent?.method).toBe('PUT')
    expect(sent?.url).toBe(`https://my-hub.exe.xyz/uploads/${digest}`)
    expect(sent?.urlParams.params).toEqual([['machine', 'laptop']])
  }).pipe(Effect.scoped),
)

it.effect('passes on what the hub said when it refuses an upload', () =>
  Effect.gen(function* () {
    const digest = yield* attachmentDigestOf(PHOTO)
    const { uploads } = yield* uploadsAnswering(
      () => new Response(HUB_ANSWER, { status: PAYLOAD_TOO_LARGE }),
    )

    const refused = yield* uploads.upload(LAPTOP, { digest, bytes: PHOTO }).pipe(Effect.flip)

    expect(refused).toEqual(new UploadRefused({ status: PAYLOAD_TOO_LARGE, hubAnswer: HUB_ANSWER }))
    expect(refused.message).toBe(HUB_ANSWER)
  }).pipe(Effect.scoped),
)
