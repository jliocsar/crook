import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'

import { SkillCatalog, frontmatterOf, listingOf } from '@crook/claude/SkillCatalog'
import { TranscriptFile } from '@crook/claude/TranscriptLocator'
import { ClaudeSessionId } from '@crook/domain/Ids'
import { SkillListing } from '@crook/domain/Skill'

import { platform } from './Fixtures'

const SESSION = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
const PERSONAL = { scope: 'personal', plugin: Option.none() } as const
const PLUGIN = { scope: 'plugin', plugin: Option.some('kit') } as const

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const skillFile = (fields: string) => `---\n${fields}\n---\n\nDo the thing.\n`

const writeFile = Effect.fn('writeFile')(function* (file: string, content: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true })
  yield* fileSystem.writeFileString(file, content)
})

const writeSkill = (folder: string, name: string, fields: string) =>
  writeFile(`${folder}/${name}/SKILL.md`, skillFile(fields))

const catalogAt = Effect.fn('catalogAt')(function* (roots: readonly string[]) {
  const context = yield* Layer.build(SkillCatalog.layerAt(roots, []))

  return Context.get(context, SkillCatalog)
})

const namesAndScopes = (listings: readonly SkillListing[]) =>
  listings.map((listing) => `${listing.scope} ${listing.name}`)

layer(platform, { excludeTestServices: true })('SkillCatalog', (live) => {
  live.effect('reads the name, description, argument hint and visibility from frontmatter', () =>
    Effect.sync(() => {
      expect(
        listingOf(
          skillFile(
            'name: "handoff"\ndescription: >\n  Compact the conversation\n  into a handoff\nargument-hint: [issue] [format]',
          ),
          'folder-name',
          true,
          PERSONAL,
        ),
      ).toEqual(
        Option.some(
          new SkillListing({
            name: 'handoff',
            description: 'Compact the conversation into a handoff',
            argumentHint: Option.some('[issue] [format]'),
            scope: 'personal',
          }),
        ),
      )
      expect(
        listingOf(skillFile('description: Background\nuser-invocable: No'), 'x', true, PERSONAL),
      ).toEqual(Option.none())
      expect(
        Option.map(
          listingOf('# Ship\n\nShip it now.\n', 'release:ship', false, PERSONAL),
          (found) => [found.name, found.description],
        ),
      ).toEqual(Option.some(['release:ship', '# Ship']))
      expect(
        Option.map(
          listingOf(skillFile('name: review'), 'review', true, PLUGIN),
          (found) => found.name,
        ),
      ).toEqual(Option.some('kit:review'))
      expect(
        Option.map(
          listingOf(skillFile('name: kit:fancy'), 'fancy', true, PLUGIN),
          (found) => found.name,
        ),
      ).toEqual(Option.some('kit:fancy'))
      expect(frontmatterOf('\n---\nname: late\n---\n').fields).toEqual({})
      expect(frontmatterOf("---\ndescription: 'it''s quoted'\n---\n").fields).toEqual({
        description: "it's quoted",
      })
    }),
  )

  live.effect(
    'lists what Claude Code offers under / for a folder, in the order it resolves names',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const home = yield* fileSystem.makeTempDirectoryScoped()
        const repository = yield* fileSystem.makeTempDirectoryScoped()
        const pluginInstall = `${home}/plugins/cache/kit`

        yield* writeSkill(`${home}/skills`, 'recap', 'description: Restate the next steps')
        yield* writeSkill(`${home}/skills`, 'shared', 'description: The personal one')
        yield* writeSkill(`${home}/skills/synced`, 'pdf', 'description: Synced from claude.ai')
        yield* writeFile(`${home}/commands/git/sync.md`, skillFile('description: Sync the branch'))
        yield* writeFile(
          `${home}/settings.json`,
          encodeJson({
            enabledPlugins: { 'kit@market': true, 'idle@market': false },
            skillOverrides: { hidden: 'off', prototype: 'user-invocable-only' },
          }),
        )
        yield* writeFile(
          `${home}/plugins/installed_plugins.json`,
          encodeJson({
            version: 2,
            plugins: {
              'kit@market': [{ scope: 'user', installPath: pluginInstall }],
              'idle@market': [{ scope: 'user', installPath: `${home}/plugins/cache/idle` }],
            },
          }),
        )
        yield* writeSkill(`${pluginInstall}/skills`, 'review', 'description: Review the diff')
        yield* writeFile(`${pluginInstall}/commands/ship.md`, skillFile('description: Ship it'))
        yield* writeSkill(`${home}/plugins/cache/idle/skills`, 'idle', 'description: Not enabled')
        yield* fileSystem.makeDirectory(`${repository}/.git`)
        yield* writeSkill(
          `${repository}/.claude/skills`,
          'prototype',
          'description: Build versions',
        )
        yield* writeSkill(`${repository}/.claude/skills`, 'shared', 'description: The project one')
        yield* writeSkill(`${repository}/.claude/skills`, 'hidden', 'description: Turned off')
        yield* writeSkill(
          `${repository}/.claude/skills`,
          'background',
          'description: Only for Claude\nuser-invocable: false',
        )
        yield* writeSkill(
          `${repository}/packages/web/.claude/skills`,
          'nested',
          'description: From the folder Claude started in',
        )

        const catalog = yield* catalogAt([home])
        const listings = yield* catalog.list(`${repository}/packages/web`, Option.none())

        expect(namesAndScopes(listings)).toEqual([
          'personal git:sync',
          'plugin kit:review',
          'plugin kit:ship',
          'project nested',
          'project prototype',
          'personal recap',
          'personal shared',
        ])
        expect(listings.find((listing) => listing.name === 'shared')?.description).toBe(
          'The personal one',
        )
      }),
  )

  live.effect(
    'reads the Claude folder the session lives in, and a bare worktree from its main checkout',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const work = yield* fileSystem.makeTempDirectoryScoped()
        const personal = yield* fileSystem.makeTempDirectoryScoped()
        const main = yield* fileSystem.makeTempDirectoryScoped()
        const worktree = yield* fileSystem.makeTempDirectoryScoped()

        yield* writeSkill(`${work}/skills`, 'work-only', 'description: From the work folder')
        yield* writeSkill(`${personal}/skills`, 'personal-only', 'description: From ~/.claude')
        yield* fileSystem.makeDirectory(`${main}/.git/worktrees/feature`, { recursive: true })
        yield* writeSkill(`${main}/.claude/skills`, 'from-main', 'description: Main checkout')
        yield* writeFile(`${worktree}/.git`, `gitdir: ${main}/.git/worktrees/feature\n`)

        const catalog = yield* catalogAt([personal, work])
        const transcript = new TranscriptFile({
          session: SESSION,
          path: `${work}/projects/-repo/${SESSION}.jsonl`,
        })

        expect(namesAndScopes(yield* catalog.list(worktree, Option.some(transcript)))).toEqual([
          'project from-main',
          'personal work-only',
        ])
        expect(namesAndScopes(yield* catalog.list('', Option.none()))).toEqual([
          'personal personal-only',
          'personal work-only',
        ])
      }),
  )
})
