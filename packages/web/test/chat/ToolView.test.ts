import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'

import { SubagentRun } from '@crook/web/chat/ChatItems'
import { treeRun, withoutLineNumbers } from '@crook/web/chat/ToolView'

import { START } from '../HerdFixtures.ts'
import { REVIEWER, SESSION } from '../TranscriptFixtures.ts'

const REVIEW = new SubagentRun({
  toolUseId: 'toolu_review',
  session: SESSION,
  subagent: Option.some(REVIEWER),
  description: 'Review the diff',
  agentType: 'general-purpose',
  model: Option.none(),
  prompt: 'Review it',
  background: false,
  status: 'done',
  sessionIdle: false,
  startedAt: Option.none(),
  finishedAt: Option.none(),
})

describe('withoutLineNumbers', () => {
  it('drops the numbering Read puts before every line, in either form', () => {
    expect(withoutLineNumbers('1\timport a\n2\t\n3\texport b')).toBe('import a\n\nexport b')
    expect(withoutLineNumbers('     9→const a = 1\n    10→const b = 2')).toBe(
      'const a = 1\nconst b = 2',
    )
  })

  it('leaves text alone when any line is not numbered', () => {
    expect(withoutLineNumbers('1\tone\ntwo')).toBe('1\tone\ntwo')
  })
})

describe('treeRun', () => {
  it('offers a run with a transcript only where the screen can open it', () => {
    expect(treeRun(REVIEW, { now: START, paneClosed: false, opensRuns: true }).selectable).toBe(
      true,
    )
    expect(treeRun(REVIEW, { now: START, paneClosed: false, opensRuns: false }).selectable).toBe(
      false,
    )
  })
})
