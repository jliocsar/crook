import { describe, expect, it } from '@effect/vitest'
import * as Struct from 'effect/Struct'

import { AgentRow } from '@crook/domain/AgentRow'
import { agentAvatarSeed } from '@crook/web/herd/AgentAvatar'

import { agent } from '../HerdFixtures.ts'

describe('an agent avatar seed', () => {
  it('is the herdr label when the agent has one', () => {
    expect(agentAvatarSeed(agent('w1:p1', 'idle', { label: 'reviewer' }))).toBe('reviewer')
  })

  it('falls back to the pane when herdr gave no label', () => {
    expect(agentAvatarSeed(agent('w1:p1', 'idle'))).toBe('w1:p1')
  })

  it('stays the same when the chat title changes', () => {
    const before = agent('w1:p1', 'working', { label: 'reviewer', title: 'Read the diff' })
    const after = new AgentRow(Struct.evolve(before, { title: () => 'Write the summary' }))

    expect(agentAvatarSeed(after)).toBe(agentAvatarSeed(before))
  })
})
