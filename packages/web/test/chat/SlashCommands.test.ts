import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'

import { SkillListing } from '@crook/domain/Skill'
import { slashSuggestions } from '@crook/web/chat/SlashCommands'

const skill = (name: string, scope: SkillListing['scope']) =>
  new SkillListing({
    name,
    description: `${name} does a thing`,
    argumentHint: Option.none(),
    scope,
  })

const SESSION_SKILLS = [
  skill('prototype', 'project'),
  skill('handoff', 'project'),
  skill('adhd', 'personal'),
  skill('typesafe:typesafe-ai', 'plugin'),
  skill('clear', 'project'),
]

const namesByGroup = (text: string) =>
  slashSuggestions(text, SESSION_SKILLS).map((group) => [
    group.label,
    group.commands.map((command) => command.name),
  ])

describe('slashSuggestions', () => {
  it('groups the session skills by where they come from, with the PTY-safe built-ins last', () => {
    expect(namesByGroup('/')).toEqual([
      ['This project', ['clear', 'handoff', 'prototype']],
      ['Yours', ['adhd']],
      ['Plugins', ['typesafe:typesafe-ai']],
      ['Claude Code', ['compact', 'cost', 'effort', 'fast', 'model', 'rename']],
    ])
  })

  it('narrows to the commands whose name, or a plugin skill name, starts with what was typed', () => {
    expect(namesByGroup('/c')).toEqual([
      ['This project', ['clear']],
      ['Claude Code', ['compact', 'cost']],
    ])
    expect(namesByGroup('/Type')).toEqual([['Plugins', ['typesafe:typesafe-ai']]])
    expect(namesByGroup('/prototype now')).toEqual([])
    expect(namesByGroup('fix /c')).toEqual([])
  })

  it('offers only the built-ins before the session has listed its skills', () => {
    expect(
      slashSuggestions('/', []).map((group) => group.commands.map((command) => command.name)),
    ).toEqual([['clear', 'compact', 'cost', 'effort', 'fast', 'model', 'rename']])
  })
})
