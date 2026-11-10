import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen } from '@testing-library/react'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'

import { kitchenStoriesFrom } from '../../stories/Kitchen.tsx'
import type { Prototype } from '../../stories/Kitchen.tsx'
import type { Story } from '../../stories/Story.tsx'
import { eventually } from '../Dom.ts'

const PROTOTYPE: Prototype = {
  title: 'Two banners',
  hasReplay: true,
  variants: [
    { name: 'Quiet', axis: 'density', Component: () => <p>Quiet banner</p> },
    { name: 'Loud', axis: 'personality', Component: () => <p>Loud banner</p> },
  ],
}

const WORKING = './kitchen/banners/Prototype.tsx'
const BROKEN = './kitchen/broken/Prototype.tsx'

const loaders = {
  [WORKING]: () => Promise.resolve({ prototype: PROTOTYPE }),
  [BROKEN]: () => Promise.reject(new Error('A syntax error in the prototype')),
}

const storyNamed = (id: string) =>
  Effect.orDie(
    Effect.fromOption(Arr.findFirst(kitchenStoriesFrom(loaders), (story) => story.id === id)),
  )

const mounted = (story: Story) =>
  Effect.gen(function* () {
    const root = document.body.appendChild(document.createElement('div'))
    const scene = yield* story.start

    yield* scene.render(root)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        root.remove()
      }),
    )
  })

describe('the kitchen', () => {
  it('makes one story per prototype folder', () => {
    expect(kitchenStoriesFrom(loaders).map((story) => story.id)).toEqual([
      'kitchen/banners',
      'kitchen/broken',
    ])
  })

  it('has nothing to show when the folders are gone', () => {
    expect(kitchenStoriesFrom({})).toEqual([])
  })

  it.live('flips variants in the real shell with the picker and its keys', () =>
    Effect.scoped(
      Effect.gen(function* () {
        window.history.replaceState(null, '', '/')
        yield* mounted(yield* storyNamed('kitchen/banners'))
        yield* eventually(() => {
          expect(screen.getByText('Quiet banner')).toBeTruthy()
        })

        expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'Loud' }))
        yield* eventually(() => {
          expect(screen.getByText('Loud banner')).toBeTruthy()
        })

        expect(window.location.search).toBe('?v=2')
        expect(screen.getByRole('button', { name: 'Loud' }).getAttribute('aria-current')).toBe(
          'true',
        )

        fireEvent.keyDown(document.body, { key: '1' })
        yield* eventually(() => {
          expect(screen.getByText('Quiet banner')).toBeTruthy()
        })

        fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
        yield* eventually(() => {
          expect(screen.getByText('Loud banner')).toBeTruthy()
        })
      }),
    ),
  )

  it.live('fails only its own story when a prototype does not load', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const failed = yield* Effect.exit(
        Effect.provideService((yield* storyNamed('kitchen/broken')).start, Scope.Scope, scope),
      )

      yield* Scope.close(scope, Exit.void)

      expect(Exit.isFailure(failed)).toBe(true)
    }),
  )
})
