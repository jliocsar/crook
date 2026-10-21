import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type * as Option from 'effect/Option'

import { type ScreenDialog, parseDialog } from '@crook/claude/ScreenDialog'
import { HerdrClient, type HerdrRequestError } from '@crook/herdr/HerdrClient'
import { PaneReadMethod } from '@crook/herdr/Methods'

export interface PaneScreen {
  readonly screen: string
  readonly dialog: Option.Option<ScreenDialog>
}

const make = Effect.gen(function* () {
  const herdr = yield* HerdrClient

  const read = Effect.fn('PaneScreens.read')(function* (pane: string) {
    const reply = yield* herdr.request(PaneReadMethod, { pane_id: pane, source: 'detection' })

    return { screen: reply.read.text, dialog: parseDialog(reply.read.text) }
  })

  return PaneScreens.of({ read })
})

export class PaneScreens extends Context.Service<
  PaneScreens,
  {
    readonly read: (pane: string) => Effect.Effect<PaneScreen, HerdrRequestError>
  }
>()('@crook/agent/PaneScreens') {
  static readonly layer = Layer.effect(this, make)
}
