import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'

import { MACHINE_CHARTS } from '../../charts/Charts.ts'

const COMMITTED: Readonly<Record<string, string>> = import.meta.glob('../../charts/*.mmd', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const committedPath = (file: string): string => `../../charts/${file}`

describe('the machine charts', () => {
  it('holds every committed chart equal to what its table draws', () => {
    expect(Arr.map(MACHINE_CHARTS, ({ file }) => [file, COMMITTED[committedPath(file)]])).toEqual(
      Arr.map(MACHINE_CHARTS, ({ file, chart }) => [file, chart()]),
    )
  })

  it('commits no chart that no table draws', () => {
    expect(Object.keys(COMMITTED).toSorted()).toEqual(
      Arr.map(MACHINE_CHARTS, ({ file }) => committedPath(file)).toSorted(),
    )
  })
})
