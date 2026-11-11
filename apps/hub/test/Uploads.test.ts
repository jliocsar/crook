import { expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as TestClock from 'effect/testing/TestClock'

import { attachmentDigestOf } from '@crook/domain/Command'
import { MachineId } from '@crook/domain/Ids'
import { UploadDigestMismatch, Uploads } from '@crook/hub/Uploads'

const LAPTOP = MachineId.make('laptop')
const DESKTOP = MachineId.make('desktop')
const PHOTO = new TextEncoder().encode('a photo')
const OTHER = new TextEncoder().encode('something else')

const uploads = Effect.map(Layer.build(Uploads.layer), (context) => Context.get(context, Uploads))

it.effect('hands an upload to the machine it was sent for, and to no other', () =>
  Effect.gen(function* () {
    const held = yield* uploads
    const digest = yield* attachmentDigestOf(PHOTO)

    yield* held.put(LAPTOP, digest, PHOTO)

    expect(yield* held.take(LAPTOP, digest)).toEqual(Option.some(PHOTO))
    expect(yield* held.take(DESKTOP, digest)).toEqual(Option.none())
  }).pipe(Effect.scoped),
)

it.effect('forgets an upload after 15 minutes', () =>
  Effect.gen(function* () {
    const held = yield* uploads
    const digest = yield* attachmentDigestOf(PHOTO)

    yield* held.put(LAPTOP, digest, PHOTO)
    yield* TestClock.adjust(Duration.minutes(14))

    const before = yield* held.take(LAPTOP, digest)

    yield* TestClock.adjust(Duration.minutes(2))

    expect(before).toEqual(Option.some(PHOTO))
    expect(yield* held.take(LAPTOP, digest)).toEqual(Option.none())
  }).pipe(Effect.scoped),
)

it.effect('refuses bytes that do not match the digest they were sent under', () =>
  Effect.gen(function* () {
    const held = yield* uploads
    const digest = yield* attachmentDigestOf(PHOTO)
    const actual = yield* attachmentDigestOf(OTHER)

    const refused = yield* held.put(LAPTOP, digest, OTHER).pipe(Effect.flip)

    expect(refused).toEqual(new UploadDigestMismatch({ claimed: digest, actual }))
    expect(yield* held.take(LAPTOP, digest)).toEqual(Option.none())
  }).pipe(Effect.scoped),
)
