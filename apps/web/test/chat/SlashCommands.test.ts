import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import { SkillListing } from '@crook/domain/Skill'
import { isCommandSend, laptopOnlyNote, slashSuggestions } from '@crook/web/chat/SlashCommands'

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
      ['Claude Code', ['compact', 'effort', 'fast', 'model', 'rename']],
    ])
  })

  it('narrows to the commands whose name, or a plugin skill name, starts with what was typed', () => {
    expect(namesByGroup('/c')).toEqual([
      ['This project', ['clear']],
      ['Claude Code', ['compact']],
    ])
    expect(namesByGroup('/Type')).toEqual([['Plugins', ['typesafe:typesafe-ai']]])
    expect(namesByGroup('/prototype now')).toEqual([])
    expect(namesByGroup('fix /c')).toEqual([])
  })

  it('offers only the built-ins before the session has listed its skills', () => {
    expect(
      slashSuggestions('/', []).map((group) => group.commands.map((command) => command.name)),
    ).toEqual([['clear', 'compact', 'effort', 'fast', 'model', 'rename']])
  })
})

describe('laptopOnlyNote', () => {
  const needsLaptop = (text: string, skills: readonly SkillListing[] = []) =>
    Option.isSome(laptopOnlyNote(text, skills))

  it('refuses every bare command measured to open a dialog', () => {
    expect(
      Arr.filter(
        [
          'add-dir',
          'bashes',
          'config',
          'cost',
          'effort',
          'export',
          'fast',
          'feedback',
          'help',
          'hooks',
          'mcp',
          'memory',
          'model',
          'permissions',
          'plugin',
          'privacy-settings',
          'release-notes',
          'resume',
          'rewind',
          'sandbox',
          'stats',
          'status',
          'tasks',
          'theme',
          'usage',
        ],
        (name) => !needsLaptop(`/${name}`),
      ),
    ).toEqual([])
  })

  it('says the laptop is what it needs', () => {
    expect(laptopOnlyNote('/resume', [])).toEqual(
      Option.some(
        '/resume opens a dialog, so it needs the laptop. Name a session instead, with its id.',
      ),
    )
  })

  it('keeps what was measured to answer with no dialog, and what nobody measured', () => {
    expect(
      Arr.filter(
        [
          '/compact',
          '/clear',
          '/context',
          '/rename',
          '/copy',
          '/color',
          '/model opus',
          '/effort high',
          '/fast on',
          '/resume 00000000-0000-4000-8000-000000000000',
          '/some-unmeasured-command',
          'model',
          '/model/x',
        ],
        (text) => needsLaptop(text),
      ),
    ).toEqual([])
  })

  it('refuses a theme even with its argument, which opened the dialog all the same', () => {
    expect(needsLaptop('/theme dark')).toBe(true)
  })

  it('lets a skill of that name through, since the skill is what runs', () => {
    expect(
      needsLaptop('/usage', [
        new SkillListing({
          name: 'usage',
          description: 'A made up skill',
          argumentHint: Option.none(),
          scope: 'project',
        }),
      ]),
    ).toBe(false)
  })
})

describe('isCommandSend', () => {
  it('takes a slash name and a shell line as commands, and a path as a prompt', () => {
    expect(
      Arr.map(
        [
          '/model opus',
          '/compact',
          '/plugin:deploy now',
          '!kill 1',
          '/home/me/file is broken',
          'hi',
        ],
        isCommandSend,
      ),
    ).toEqual([true, true, true, true, false, false])
  })
})
