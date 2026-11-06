import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'

import { ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { ClaudeSessionId } from '@crook/domain/Ids'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  HerdrConnectionClosed,
  type HerdrSubscriptionError,
  type ScriptedResponse,
  scriptedRejection,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import { PaneProcessInfoMethod } from '@crook/herdr/Methods'
import { agentInfo } from '@crook/herdr/fixtures/Records.ts'
import { AgentSessionInfo, PaneProcess, PaneProcessInfo } from '@crook/herdr/Records'

interface ProcessFixture {
  readonly environ: (root: string) => string
  readonly sessionRoot: (root: string) => string
  readonly pidFile: Option.Option<string>
}

const LIVE_CLAUDE_STAT =
  '2224797 (claude) S 1815179 2224797 1815179 34828 2224797 4194304 1549769 10025154 33084 1757 63039 6528 14996 4773 20 0 31 0 248837515 5818683392 99488 18446744073709551615 27164160 97022672 140736926585248 0 0 0 0 4096 2072145151 0 0 0 17 0 0 0 0 0 0 97026768 270004224 755728384 140736926593345 140736926596185 140736926596185 140736926605241 0'

const NO_FOREGROUND_JOB_REPLY =
  '{"id":"pane.process_info","result":{"type":"pane_process_info","process_info":{"pane_id":"w1:p1","shell_pid":3375068}}}'

const LIVE_CLAUDE_PROC_START = '248837515'
const LIVE_CLAUDE_PID = 2224797
const SESSION_ID = '270d2fc3-129e-4a0d-aef3-78f495af98c9'
const REPORTED_SESSION = ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')
const LAST_KNOWN_SESSION = ClaudeSessionId.make('5f0c2a8e-91d4-4b6e-a3c7-2e8d6b1f4a90')
const LEFT_BEHIND_BY_A_LONGER_RECORD = 'r":"dialog open"}'
const UNREADABLE_REPLY = '{"id":"pane.process_info","result":{"type":"an_unknown_reply"}}'

const PidFile = Schema.fromJsonString(
  Schema.Struct({ pid: Schema.Int, sessionId: Schema.String, procStart: Schema.String }),
)

const pidFile = (procStart: string) =>
  Schema.encodeSync(PidFile)({ pid: LIVE_CLAUDE_PID, sessionId: SESSION_ID, procStart })

const processInfo = (processes: readonly PaneProcess[]) =>
  scriptedResult(PaneProcessInfoMethod, {
    type: 'pane_process_info',
    process_info: new PaneProcessInfo({
      pane_id: 'w1:p1',
      foreground_processes: Option.some(processes),
    }),
  })

const noForegroundJob: ScriptedResponse = {
  method: PaneProcessInfoMethod.name,
  line: NO_FOREGROUND_JOB_REPLY,
}

const refusedWhileStopping = scriptedRejection(
  PaneProcessInfoMethod,
  'server_unavailable',
  'server is shutting down',
)

const unreadableReply: ScriptedResponse = {
  method: PaneProcessInfoMethod.name,
  line: UNREADABLE_REPLY,
}

const claudeInPane = processInfo([
  new PaneProcess({ pid: LIVE_CLAUDE_PID, name: 'claude' }),
  new PaneProcess({ pid: 1232679, name: 'lx' }),
])

const workConfigDir: ProcessFixture = {
  environ: (root) => `HOME=${root}/home\0CLAUDE_CONFIG_DIR=${root}/claude-work\0`,
  sessionRoot: (root) => `${root}/claude-work`,
  pidFile: Option.some(pidFile(LIVE_CLAUDE_PROC_START)),
}

const tornPidFile: ProcessFixture = {
  ...workConfigDir,
  pidFile: Option.some(`${pidFile(LIVE_CLAUDE_PROC_START)}${LEFT_BEHIND_BY_A_LONGER_RECORD}`),
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
      const session = yield* claudeSessions.resolve(
        reportedSession('id', REPORTED_SESSION),
        Option.none(),
      )

      expect(session).toEqual(Option.some(REPORTED_SESSION))
    }),
  )

  it.effect('reads the pid file when herdr still reports the session a /clear just left', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane])
      const session = yield* claudeSessions.resolve(
        reportedSession('id', REPORTED_SESSION),
        Option.none(),
      )

      expect(session).toEqual(Option.some(SESSION_ID))
    }),
  )

  it.effect('keeps what herdr reports when the process cannot say otherwise', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], {
        ...workConfigDir,
        pidFile: Option.none(),
      })
      const session = yield* claudeSessions.resolve(
        reportedSession('id', REPORTED_SESSION),
        Option.none(),
      )

      expect(session).toEqual(Option.some(REPORTED_SESSION))
    }),
  )

  it.effect('falls through to the pid file when herdr reports a session path', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane])
      const session = yield* claudeSessions.resolve(
        reportedSession('path', '/home/jliocsar/.claude/projects/crook/session.jsonl'),
        Option.none(),
      )

      expect(session).toEqual(Option.some(SESSION_ID))
    }),
  )

  it.effect('skips agents that are not claude', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([])
      const session = yield* claudeSessions.resolve(
        agentInfo({ agent: Option.some('codex') }),
        Option.none(),
      )

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('falls back to the pid file under the process CLAUDE_CONFIG_DIR', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.none())

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
      const session = yield* claudeSessions.resolve(agentInfo(), Option.none())

      expect(session).toEqual(Option.some(SESSION_ID))
    }),
  )

  it.effect('ignores a pid file left by an earlier process with the same pid', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], {
        ...workConfigDir,
        pidFile: Option.some(pidFile('232309271')),
      })
      const session = yield* claudeSessions.resolve(agentInfo(), Option.none())

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('finds nothing when claude wrote no pid file', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], {
        ...workConfigDir,
        pidFile: Option.none(),
      })
      const session = yield* claudeSessions.resolve(agentInfo(), Option.none())

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('finds nothing without failing when the pid file changed shape', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], {
        ...workConfigDir,
        pidFile: Option.some('{}'),
      })
      const session = yield* claudeSessions.resolve(agentInfo(), Option.none())

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('keeps the session it last knew when the pid file is caught mid-rewrite', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], tornPidFile, [LAST_KNOWN_SESSION])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.some(LAST_KNOWN_SESSION))

      expect(session).toEqual(Option.some(LAST_KNOWN_SESSION))
    }),
  )

  it.effect('lets go of the session it last knew when no pid file names it and a read failed', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([claudeInPane], tornPidFile)
      const session = yield* claudeSessions.resolve(agentInfo(), Option.some(LAST_KNOWN_SESSION))

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect(
    'keeps what herdr reports when the pid file cannot be read and it knew no session',
    () =>
      Effect.gen(function* () {
        const claudeSessions = yield* sessions([claudeInPane], tornPidFile)
        const session = yield* claudeSessions.resolve(
          reportedSession('id', REPORTED_SESSION),
          Option.none(),
        )

        expect(session).toEqual(Option.some(REPORTED_SESSION))
      }),
  )

  it.effect('keeps the session it last knew when herdr refuses the read', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([refusedWhileStopping], workConfigDir, [
        LAST_KNOWN_SESSION,
      ])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.some(LAST_KNOWN_SESSION))

      expect(session).toEqual(Option.some(LAST_KNOWN_SESSION))
    }),
  )

  it.effect('lets go of the session it last knew when herdr refuses and no pid file names it', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([refusedWhileStopping])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.some(LAST_KNOWN_SESSION))

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('prefers the session it last knew over a stale report when a read failed', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([refusedWhileStopping], workConfigDir, [
        LAST_KNOWN_SESSION,
      ])
      const session = yield* claudeSessions.resolve(
        reportedSession('id', REPORTED_SESSION),
        Option.some(LAST_KNOWN_SESSION),
      )

      expect(session).toEqual(Option.some(LAST_KNOWN_SESSION))
    }),
  )

  it.effect('lets go of the session it last knew when herdr says the agent is gone', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions(
        [scriptedRejection(PaneProcessInfoMethod, 'agent_not_found', 'agent not found')],
        workConfigDir,
        [LAST_KNOWN_SESSION],
      )
      const session = yield* claudeSessions.resolve(agentInfo(), Option.some(LAST_KNOWN_SESSION))

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('still fails when the connection to herdr is what broke', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([], workConfigDir, [LAST_KNOWN_SESSION])
      const error = yield* claudeSessions
        .resolve(agentInfo(), Option.some(LAST_KNOWN_SESSION))
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(HerdrConnectionClosed)
    }),
  )

  it.effect('keeps the session it last knew when herdr answers what crook cannot read', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([unreadableReply], workConfigDir, [LAST_KNOWN_SESSION])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.some(LAST_KNOWN_SESSION))

      expect(session).toEqual(Option.some(LAST_KNOWN_SESSION))
    }),
  )

  it.effect('finds nothing when no claude process runs in the pane', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([
        processInfo([new PaneProcess({ pid: 1232679, name: 'lx' })]),
      ])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.none())

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('keeps the session it last knew when the pane shows no foreground job', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([noForegroundJob], workConfigDir, [LAST_KNOWN_SESSION])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.some(LAST_KNOWN_SESSION))

      expect(session).toEqual(Option.some(LAST_KNOWN_SESSION))
    }),
  )

  it.effect('lets go of the session it last knew once no pid file names it', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([noForegroundJob])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.some(LAST_KNOWN_SESSION))

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('prefers the session it last knew over a stale report when no job shows', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([noForegroundJob], workConfigDir, [LAST_KNOWN_SESSION])
      const session = yield* claudeSessions.resolve(
        reportedSession('id', REPORTED_SESSION),
        Option.some(LAST_KNOWN_SESSION),
      )

      expect(session).toEqual(Option.some(LAST_KNOWN_SESSION))
    }),
  )

  it.effect('keeps what herdr reports when no job shows and it knew no session', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([noForegroundJob])
      const session = yield* claudeSessions.resolve(
        reportedSession('id', REPORTED_SESSION),
        Option.none(),
      )

      expect(session).toEqual(Option.some(REPORTED_SESSION))
    }),
  )

  it.effect('finds nothing without failing when no job shows and nothing names a session', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([noForegroundJob])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.none())

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('drops the session it last knew once the foreground shows no claude', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([
        processInfo([new PaneProcess({ pid: 1232679, name: 'lx' })]),
      ])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.some(LAST_KNOWN_SESSION))

      expect(session).toEqual(Option.none())
    }),
  )

  it.effect('finds nothing when the pane closed before herdr was asked', () =>
    Effect.gen(function* () {
      const claudeSessions = yield* sessions([
        scriptedRejection(PaneProcessInfoMethod, 'pane_not_found', 'pane not found'),
      ])
      const session = yield* claudeSessions.resolve(agentInfo(), Option.none())

      expect(session).toEqual(Option.none())
    }),
  )
})
