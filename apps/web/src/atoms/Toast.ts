import * as Data from 'effect/Data'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'

export class Toast extends Data.Class<{
  readonly id: number
  readonly text: string
}> {}

export type ToastIntent = Data.TaggedEnum<{
  Show: { readonly text: string }
  Expire: { readonly id: number }
}>

export const TOAST_DURATION = Duration.seconds(3)

export const ToastIntent = Data.taggedEnum<ToastIntent>()

const shownToastAtom = Atom.make(Option.none<Toast>()).pipe(Atom.keepAlive)

const toastsShownAtom = Atom.make(0).pipe(Atom.keepAlive)

export const toastAtom = Atom.writable(
  (get) => get(shownToastAtom),
  (context, intent: ToastIntent) => {
    ToastIntent.$match(intent, {
      Show: ({ text }) => {
        const id = context.get(toastsShownAtom) + 1

        context.set(toastsShownAtom, id)
        context.set(shownToastAtom, Option.some(new Toast({ id, text })))
      },
      Expire: ({ id }) => {
        if (Option.exists(context.get(shownToastAtom), (shown) => shown.id === id)) {
          context.set(shownToastAtom, Option.none())
        }
      },
    })
  },
)
