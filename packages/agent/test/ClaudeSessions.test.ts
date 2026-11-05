import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'

import { ClaudeSessionFileUnreadable, ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { ClaudeSessionId } from '@crook/domain/Ids'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type ScriptedResponse,
  scriptedRejection,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import { PaneProcessInfoMethod } from '@crook/herdr/Methods'
import { agentInfo } from '@crook/herdr/RecordFixtures'
import { AgentSessionInfo, PaneProcess, PaneProcessInfo } from '@crook/herdr/Records'

interface ProcessFixture {
  readonly environ: (root: string) => string
  readonly sessionRoot: (root: string) => string
  readonly pidFile: Option.Option<string>
}

const LIVE_CLAUDE_STAT =
  '2224797 (claude) S 1815179 2224797 1815179 34828 2224797 4194304 1549769 10025154 33084 1757 63039 6528 14996 4773 20 0 31 0 248837515 5818683392 99488 18446744073709551615 27164160 97022672 140736926585248 0 0 0 0 4096 2072145151 0 0 0 17 0 0 0 0 0 0 97026768 270004224 755728384 140736926593345 140736926596185 140736926596185 140736926605241 0'

const LIVE_CLAUDE_PROC_START = '248837515'
const LIVE_CLAUDE_PID = 2224797
const SESSION_ID = '270d2fc3-129e-4a0d-aef3-78f495af98c9'
const REPORTED_SESSION = ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')

const PidFile = Schema.fromJsonString(
  Schema.Struct({ pid: Schema.Int, sessionId: Schema.String, procStart: Schema.String }),
)

const pidFile = (procStart: string) =>
  Schema.encodeSync(PidFile)({ pid: LIVE_CLAUDE_PID, sessionId: SESSION_ID, procStart })

const processInfo = (processes: readonly PaneProcess[]) =>
  scriptedResult(PaneProcessInfoMethod, {
    type: 'pane_process_info',
    process_info: new PaneProcessInfo({ pane_id: 'w1:p1', foreground_processes: processes }),
  })

const claudeInPane = processInfo([
  new PaneProcess({ pid: LIVE_CLAUDE_PID, name: 'claude' }),
  new PaneProcess({ pid: 1232679, name: 'lx' }),
])

const workConfigDir: ProcessFixture = {
  environ: (root) => `HOME=${root}/home\0CLAUDE_CONFIG_DIR=${root}/claude-work\0`,
  sessionRoot: (root) => `${root}/claude-work`,
  pidFile: Option.some(pidFile(LIVE_CLAUDE_PROC_START)),
}

const sessions = Effect.fn('sessions')(function* (
  responses: readonly ScriptedResponse[],
  fixture: ProcessFixture = workConfigDir,
  heldSessions: readonly ClaudeSessionId[] = [],
) {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()
  const processDirectory = `${root}/proc/${LIVE_CLAUDE_PID}`
  const sessionDirectory = `${fixture.sessionRoot(root)}/sessions`

  yield* fileSystem.makeDirectory(processDirectory, { recursive: true })
  yield* fileSystem.makeDirectory(sessionDirectory, { recursive: true })
  yield* fileSystem.writeFileString(`${processDirectory}/environ`, fixture.environ(root))
  yield* fileSystem.writeFileString(`${processDirectory}/stat`, LIVE_CLAUDE_STAT)
  yield* Option.match(fixture.pidFile, {
    onNone: () => Effect.void,
    onSome: (contents) =>
      fileSystem.writeFileString(`${sessionDirectory}/${LIVE_CLAUDE_PID}.json`, contents),
  })

  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const context = yield* Layer.build(
    Layer.provide(ClaudeSessions.layerAt(`${root}/proc`), [
      HerdrClient.layerTest({ responses, events }),
      ClaudeSessionFiles.layerTest(heldSessions),
    ]),
  )

  return Context.get(context, ClaudeSessions)
})

const reportedSession = (kind: 'id' | 'path', value: string) =>
  agentInfo({
    agent_session: Option.some(
      new AgentSessionInfo({ agent: 'claude', kind, source: 'herdr:claude', value }),
    ),
  })

layer(BunFileSystem.layer, { excludeTestServices: true })('ClaudeSessions', (it) => {
  it.effect('takes the session herdr reports while a pid file names it, without asking', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([], workConfigDir, [REPORTED_SESSION])
      const session = yield* claudeSessions.resolve(reportedSession('id', REPORTED_SESSION))

      expect(session).toEqual(Option.some(REPORTED_SESSION))
    }),
  )

  it.effect('reads the pid file when herdr still reports the session a /clear just left', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane])
      const session = yield* claudeSessions.resolve(reportedSession('id', REPORTED_SESSION))

      expect(session).toEqual(Option.some(SESSION_ID))
    }),
  )

  it.effect('keeps what herdr reports when the process cannot say otherwise', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], {
        ...workConfigDir,
        pidFile: Option.none(),
      })
      const session = yield* claudeSessions.resolve(reportedSession('id', REPORTED_SESSION))

      expect(session).toEqual(Option.some(REPORTED_SESSION))
    }),
  )

  it.effect('falls through to the pid file when herdr reports a session path', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane])
      const session = yield* claudeSessions.resolve(
        reportedSession('path', '/home/jliocsar/.claude/projects/crook/session.jsonl'),
      )

      expect(session).toEqual(Option.some(SESSION_ID))
    }),
  )

  it.effect('skips agents that are not claude', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([])
      const session = yield* claudeSessions.resolve(agentInfo({ agent: Option.some('codex') }))

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('falls back to the pid file under the process CLAUDE_CONFIG_DIR', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane])
      const session = yield* claudeSessions.resolve(agentInfo())

      expect(session).toEqual(Option.some(SESSION_ID))
    }),
  )

  it.effect('defaults the claude root to ~/.claude from the process HOME', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], {
        ...workConfigDir,
        environ: (root) => `HOME=${root}/home\0`,
        sessionRoot: (root) => `${root}/home/.claude`,
      })
      const session = yield* claudeSessions.resolve(agentInfo())

      expect(session).toEqual(Option.some(SESSION_ID))
    }),
  )

  it.effect('ignores a pid file left by an earlier process with the same pid', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], {
        ...workConfigDir,
        pidFile: Option.some(pidFile('232309271')),
      })
      const session = yield* claudeSessions.resolve(agentInfo())

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('finds nothing when claude wrote no pid file', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], {
        ...workConfigDir,
        pidFile: Option.none(),
      })
      const session = yield* claudeSessions.resolve(agentInfo())

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('fails with ClaudeSessionFileUnreadable when the pid file changed shape', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], {
        ...workConfigDir,
        pidFile: Option.some('{}'),
      })
      const error = yield* claudeSessions.resolve(agentInfo()).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ClaudeSessionFileUnreadable)
    }),
  )

  it.effect('finds nothing when no claude process runs in the pane', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([
        processInfo([new PaneProcess({ pid: 1232679, name: 'lx' })]),
      ])
      const session = yield* claudeSessions.resolve(agentInfo())

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('finds nothing when the pane closed before herdr was asked', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([
        scriptedRejection(PaneProcessInfoMethod, 'pane_not_found', 'pane not found'),
      ])
      const session = yield* claudeSessions.resolve(agentInfo())

      expect(session).toEqual(Option.none())
    }),
  )
})
