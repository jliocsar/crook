import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'

import { TIMELINE_EXPECTATIONS } from '@crook/frames/Expectations'

import { CATALOG_STORIES } from '../../stories/Catalog.ts'

describe('the frames tool and the catalog', () => {
  it('declares what every timeline story may show, and for no other story', () => {
    const timelines = Arr.filter(CATALOG_STORIES, (story) => story.kind === 'transition')

    expect(Object.keys(TIMELINE_EXPECTATIONS).toSorted()).toEqual(
      Arr.map(timelines, (story) => story.id).toSorted(),
    )
  })
})
