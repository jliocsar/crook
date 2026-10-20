import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

const VISIBLE = 'visible'

const signal = (
  target: EventTarget,
  events: readonly string[],
  read: () => boolean,
): Stream.Stream<boolean> =>
  Stream.callback<boolean>((queue) => {
    const emit = () => {
      Queue.offerUnsafe(queue, read())
    }

    return Effect.acquireRelease(
      Effect.sync(() => {
        emit()

        for (const event of events) {
          target.addEventListener(event, emit)
        }
      }),
      () =>
        Effect.sync(() => {
          for (const event of events) {
            target.removeEventListener(event, emit)
          }
        }),
    )
  }).pipe(Stream.changes)

export class PageSignals extends Context.Service<
  PageSignals,
  {
    readonly visible: Stream.Stream<boolean>
    readonly online: Stream.Stream<boolean>
  }
>()('@crook/web/PageSignals') {
  static readonly layer = Layer.sync(this, () =>
    PageSignals.of({
      visible: signal(document, ['visibilitychange'], () => document.visibilityState === VISIBLE),
      online: signal(window, ['online', 'offline'], () => navigator.onLine),
    }),
  )
}
