import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

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
const PROC_ROOT = '/proc'
const STAT_COMM_TERMINATOR = ') '
const STAT_START_TIME_INDEX = 19

export class ClaudeSessionFileUnreadable extends Schema.TaggedError<ClaudeSessionFileUnreadable>()(
  'ClaudeSessionFileUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read ${this.path} while looking up a Claude session. Check that crook runs as the same user as Claude, and that the file still has the shape crook expects.`
  }
}

const SessionFile = Schema.fromJsonString(
  Schema.Struct({ sessionId: ClaudeSessionId, procStart: Schema.String }),
)

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

const startTime = (stat: string) =>
  Arr.get(
    stat.slice(stat.lastIndexOf(STAT_COMM_TERMINATOR) + STAT_COMM_TERMINATOR.length).split(' '),
    STAT_START_TIME_INDEX,
  )

const flatMapSome =
  <Value, Next, Failure, Requirements>(
    next: (value: Value) => Effect.Effect<Option.Option<Next>, Failure, Requirements>,
  ) =>
  <SelfFailure, SelfRequirements>(
    self: Effect.Effect<Option.Option<Value>, SelfFailure, SelfRequirements>,
  ) =>
    Effect.flatMap(self, Option.match({ onNone: () => Effect.succeedNone, onSome: next }))

const make = (procRoot: string) =>
  Effect.gen(function* () {
    const herdr = yield* HerdrClient
    const fileSystem = yield* FileSystem.FileSystem

    const readFile = (path: string) =>
      fileSystem.readFileString(path).pipe(
        Effect.map(Option.some),
        Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeedNone),
        Effect.mapError((cause) => new ClaudeSessionFileUnreadable({ path, cause })),
      )

    const readSessionFile = (path: string) =>
      readFile(path).pipe(
        flatMapSome((content: string) =>
          Schema.decodeEffect(SessionFile)(content).pipe(
            Effect.map(Option.some),
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

      return yield* Option.match(reportedSession(agent), {
        onNone: () => sessionOfPane(agent.pane_id),
        onSome: Effect.succeedSome,
      })
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
