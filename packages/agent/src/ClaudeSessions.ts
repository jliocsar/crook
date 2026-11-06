import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import {
  ClaudeSessionFileUnreadable,
  ClaudeSessionFiles,
  PROC_ROOT,
  SessionFile,
  startTime,
} from '@crook/agent/ClaudeSessionFiles'
import { flatMapSome } from '@crook/agent/OptionEffect'
import { ClaudeSessionId } from '@crook/domain/Ids'
import {
  HerdrClient,
  type HerdrPaneNotFound,
  type HerdrRequestError,
} from '@crook/herdr/HerdrClient'
import { PaneProcessInfoMethod } from '@crook/herdr/Methods'
import type { AgentInfo, PaneProcess } from '@crook/herdr/Records'

const CLAUDE_AGENT = 'claude'
const CLAUDE_PROCESS_NAME = 'claude'

const reportedSession = (agent: AgentInfo) =>
  agent.agent_session.pipe(
    Option.filter((session) => session.kind === 'id'),
    Option.flatMap((session) => Schema.decodeOption(ClaudeSessionId)(session.value)),
  )

const environValue = (environ: string, key: string) =>
  Arr.findFirst(environ.split('\0'), (entry) => entry.startsWith(`${key}=`)).pipe(
    Option.map((entry) => entry.slice(key.length + 1)),
  )

const claudeRoot = (environ: string) =>
  environValue(environ, 'CLAUDE_CONFIG_DIR').pipe(
    Option.orElse(() => Option.map(environValue(environ, 'HOME'), (home) => `${home}/.claude`)),
  )

const make = (procRoot: string) =>
  Effect.gen(function* () {
    const herdr = yield* HerdrClient
    const fileSystem = yield* FileSystem.FileSystem
    const sessionFiles = yield* ClaudeSessionFiles

    const readFile = (path: string) =>
      fileSystem.readFileString(path).pipe(
        Effect.asSome,
        Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeedNone),
        Effect.mapError((cause) => new ClaudeSessionFileUnreadable({ path, cause })),
      )

    const readSessionFile = (path: string) =>
      readFile(path).pipe(
        flatMapSome((content: string) =>
          Schema.decodeEffect(SessionFile)(content).pipe(
            Effect.asSome,
            Effect.mapError((cause) => new ClaudeSessionFileUnreadable({ path, cause })),
          ),
        ),
      )

    const sessionOfProcess = (pid: number) =>
      readFile(`${procRoot}/${pid}/environ`).pipe(
        Effect.map(Option.flatMap(claudeRoot)),
        flatMapSome((root: string) => readSessionFile(`${root}/sessions/${pid}.json`)),
        flatMapSome((file: typeof SessionFile.Type) =>
          readFile(`${procRoot}/${pid}/stat`).pipe(
            Effect.map((stat) =>
              stat.pipe(
                Option.flatMap(startTime),
                Option.filter((started) => started === file.procStart),
                Option.as(file.sessionId),
              ),
            ),
          ),
        ),
        Effect.withSpan('ClaudeSessions.sessionOfProcess'),
      )

    const sessionOfPane = (paneId: string) =>
      herdr.request(PaneProcessInfoMethod, { pane_id: paneId }).pipe(
        Effect.map((result) =>
          Arr.findFirst(
            result.process_info.foreground_processes,
            (process) => process.name === CLAUDE_PROCESS_NAME,
          ),
        ),
        flatMapSome((process: PaneProcess) => sessionOfProcess(process.pid)),
        Effect.catchTag('HerdrPaneNotFound', () => Effect.succeedNone),
      )

    const resolve = Effect.fn('ClaudeSessions.resolve')(function* (agent: AgentInfo) {
      if (!Option.contains(agent.agent, CLAUDE_AGENT)) {
        return Option.none()
      }

      const reported = reportedSession(agent)
      const stillOpen = yield* Option.match(reported, {
        onNone: () => Effect.succeed(false),
        onSome: sessionFiles.holds,
      })

      return stillOpen
        ? reported
        : yield* Effect.map(
            sessionOfPane(agent.pane_id),
            Option.orElse(() => reported),
          )
    })

    return ClaudeSessions.of({ resolve })
  })

export class ClaudeSessions extends Context.Service<
  ClaudeSessions,
  {
    readonly resolve: (
      agent: AgentInfo,
    ) => Effect.Effect<
      Option.Option<ClaudeSessionId>,
      Exclude<HerdrRequestError, HerdrPaneNotFound> | ClaudeSessionFileUnreadable
    >
  }
>()('@crook/agent/ClaudeSessions') {
  static readonly layerAt = (procRoot: string) => Layer.effect(this, make(procRoot))

  static readonly layer = this.layerAt(PROC_ROOT)

  static readonly layerTest = (sessions: ReadonlyMap<string, ClaudeSessionId>) =>
    Layer.succeed(
      this,
      ClaudeSessions.of({
        resolve: (agent) => Effect.succeed(Option.fromNullishOr(sessions.get(agent.pane_id))),
      }),
    )
}
