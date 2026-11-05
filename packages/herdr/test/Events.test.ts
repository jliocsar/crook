import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { HerdrEvent } from '@crook/herdr/Events'

const CAPTURED_EVENTS = `${import.meta.dirname}/fixtures/spike-81-events.ndjson`

const decodeEvent = Schema.decodeUnknownResult(Schema.fromJsonString(HerdrEvent))

layer(BunFileSystem.layer)('HerdrEvent', (it) => {
  it.effect('reads every event herdr 0.9.5 sent through restarts and handoffs', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const lines = pipe(
        Str.split(yield* fileSystem.readFileString(CAPTURED_EVENTS), '\n'),
        Arr.filter(Str.isNonEmpty),
      )
      const names = Arr.filterMap(lines, (line) =>
        Result.map(decodeEvent(line), (event) => event.event),
      )

      expect(names).toHaveLength(lines.length)
      expect(names).toContain('pane_closed')
      expect(names).toContain('pane.agent_status_changed')
    }),
  )
})
