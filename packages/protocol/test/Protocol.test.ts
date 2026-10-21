import { describe, expect, it, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as RpcTest from 'effect/rpc/RpcTest'

import {
  AnswerAsk,
  Approve,
  Choose,
  ClosePane,
  Decline,
  InputDelivered,
  PaneClosed,
  PaneRenamed,
  Prompt,
  RenameAgent,
  SendKeys,
} from '@crook/domain/Command'
import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdView } from '@crook/domain/HerdView'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  AskId,
  ClaudeSessionId,
  HerdrConnectionId,
  IdempotencyKey,
  MachineId,
  PaneId,
  TerminalId,
  TranscriptOffset,
} from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import {
  PaneTranscript,
  TranscriptChunk,
  TranscriptOpened,
  TranscriptPosition,
} from '@crook/domain/Transcript'
import { AgentLink, MachineIdMismatch } from '@crook/protocol/AgentLink'
import { ClientApi, MachineNotInHerd, PaneNotInHerd } from '@crook/protocol/ClientApi'
import {
  AskDialogUnreadable,
  AskNotPending,
  AskOptionUnavailable,
  CommandDeliveryUnknown,
  CommandId,
  DeclineMessageUndelivered,
  QuestionnaireUnsupported,
  CommandResult,
  MachineOffline,
  PaneNotAgent,
  PaneNotCreatedByCrook,
  RoutedCommand,
} from '@crook/protocol/Commands'
import {
  TranscriptDemand,
  TranscriptOutOfStep,
  TranscriptReadFailed,
  TranscriptResumeRejected,
  TranscriptWatch,
  TranscriptWatchFailed,
  TranscriptWatchId,
} from '@crook/protocol/Transcripts'

const laptop = MachineId.make('laptop')
const impostor = MachineId.make('work-vm')
const pane = PaneId.make('w1:p1')

const emptyState = (machine: MachineId) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(1),
    herdrVersion: '0.9.1',
    herdr: new HerdrLink({ connection: HerdrConnectionId.make(1), lostAt: Option.none() }),
    workspaces: [],
    tabs: [],
    panes: [],
    agents: [],
  })

const roundTrip = <Codec extends Schema.Codec<unknown, unknown>>(
  schema: Codec,
  value: Codec['Type'],
) => {
  const line = Schema.fromJsonString(Schema.toCodecJson(schema))

  return Schema.decodeSync(line)(Schema.encodeSync(line)(value))
}

const agentLinkHandlers = AgentLink.toLayer({
  Attach: () => Stream.never,
  PublishState: ({ state }) =>
    state.machine === laptop
      ? Effect.void
      : Effect.fail(
          new MachineIdMismatch({ connectedMachine: laptop, publishedMachine: state.machine }),
        ),
  CompleteCommand: () => Effect.void,
  TranscriptDemands: () => Stream.make(demand),
  PublishTranscript: ({ watch, update }) =>
    Match.value(update).pipe(
      Match.tag('TranscriptChunk', (chunk) =>
        chunk.offset === 0
          ? Effect.void
          : Effect.fail(new TranscriptOutOfStep({ watch, expected: Option.some(resumeAt) })),
      ),
      Match.orElse(() => Effect.void),
    ),
})

const session = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
const resumeAt = new TranscriptPosition({ session, offset: TranscriptOffset.make(800) })
const opened = new TranscriptOpened({ session })

const firstChunk = new TranscriptChunk({
  session,
  offset: TranscriptOffset.make(0),
  nextOffset: TranscriptOffset.make(800),
  messages: [],
})

const demand = new TranscriptDemand({
  watches: [
    new TranscriptWatch({
      id: TranscriptWatchId.make(0),
      source: new PaneTranscript({ pane }),
      from: Option.some(resumeAt),
    }),
  ],
})

const emptyHerd = new HerdView({ machines: [], hubVersion: CrookVersion.make('0.0.1') })

const clientApiHandlers = ClientApi.toLayer({
  WatchHerd: () => Stream.make(emptyHerd, emptyHerd),
  ForgetMachine: ({ machine }) => Effect.fail(new MachineNotInHerd({ machine })),
  MarkSeen: ({ machine, pane: markedPane }) =>
    Effect.fail(new PaneNotInHerd({ machine, pane: markedPane })),
  SetPinned: ({ machine, pane: pinnedPane, pinned }) =>
    pinned ? Effect.void : Effect.fail(new PaneNotInHerd({ machine, pane: pinnedPane })),
  SendCommand: ({ machine, command }) =>
    machine === laptop
      ? Effect.succeed(
          new InputDelivered({
            pane: command.pane,
            terminal: TerminalId.make('term_1'),
            stateChangeSeq: 0,
          }),
        )
      : Effect.fail(new MachineOffline({ machine })),
  WatchTranscript: ({ machine }) =>
    machine === laptop
      ? Stream.make(opened, firstChunk)
      : Stream.fail(new TranscriptReadFailed({ detail: 'EACCES' })),
})

layer(agentLinkHandlers)('AgentLink', (rpc) => {
  rpc.effect('accepts state for the connected machine', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AgentLink)

      yield* client.PublishState({ state: emptyState(laptop) })
    }),
  )

  rpc.effect('fails with MachineIdMismatch for another machine', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AgentLink)
      const mismatch = yield* client.PublishState({ state: emptyState(impostor) }).pipe(Effect.flip)

      expect(mismatch).toBeInstanceOf(MachineIdMismatch)
      expect(mismatch.message).toContain('"work-vm"')
    }),
  )

  rpc.effect('streams transcript demands and refuses a chunk that is out of step', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AgentLink)
      const watch = TranscriptWatchId.make(0)
      const demands = yield* client.TranscriptDemands().pipe(Stream.runCollect)
      const late = new TranscriptChunk({
        session,
        offset: TranscriptOffset.make(10),
        nextOffset: TranscriptOffset.make(800),
        messages: [],
      })
      const outOfStep = yield* client.PublishTranscript({ watch, update: late }).pipe(Effect.flip)

      yield* client.PublishTranscript({ watch, update: firstChunk })
      yield* client.PublishTranscript({
        watch,
        update: new TranscriptWatchFailed({
          failure: new TranscriptResumeRejected({ detail: 'mid-line' }),
        }),
      })

      expect(demands).toEqual([demand])
      expect(outOfStep).toEqual(new TranscriptOutOfStep({ watch, expected: Option.some(resumeAt) }))
    }),
  )
})

layer(clientApiHandlers)('ClientApi', (rpc) => {
  rpc.effect('streams every HerdView the hub emits', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(ClientApi)
      const views = yield* client.WatchHerd().pipe(Stream.runCollect)

      expect(views).toHaveLength(2)
    }),
  )

  rpc.effect('carries the reason a forget or a mark-seen was refused', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(ClientApi)
      const forgetFailure = yield* client.ForgetMachine({ machine: laptop }).pipe(Effect.flip)
      const markFailure = yield* client.MarkSeen({ machine: laptop, pane }).pipe(Effect.flip)

      expect(forgetFailure).toEqual(new MachineNotInHerd({ machine: laptop }))
      expect(markFailure).toEqual(new PaneNotInHerd({ machine: laptop, pane }))
    }),
  )

  rpc.effect('carries a pin and the reason one was refused', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(ClientApi)

      yield* client.SetPinned({ machine: laptop, pane, pinned: true })
      const refused = yield* client
        .SetPinned({ machine: laptop, pane, pinned: false })
        .pipe(Effect.flip)

      expect(refused).toEqual(new PaneNotInHerd({ machine: laptop, pane }))
    }),
  )

  rpc.effect('answers SendCommand with a receipt or a tagged failure', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(ClientApi)
      const command = new Prompt({ pane, text: 'continue' })
      const key = IdempotencyKey.make('action-1')
      const receipt = yield* client.SendCommand({ machine: laptop, key, command })
      const offline = yield* client
        .SendCommand({ machine: impostor, key, command })
        .pipe(Effect.flip)

      expect(receipt).toEqual(
        new InputDelivered({ pane, terminal: TerminalId.make('term_1'), stateChangeSeq: 0 }),
      )
      expect(offline).toEqual(new MachineOffline({ machine: impostor }))
    }),
  )

  rpc.effect('streams transcript events, or the reason the agent could not read them', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(ClientApi)
      const source = new PaneTranscript({ pane })
      const events = yield* client
        .WatchTranscript({ machine: laptop, source, from: Option.none() })
        .pipe(Stream.runCollect)
      const failure = yield* client
        .WatchTranscript({ machine: impostor, source, from: Option.some(resumeAt) })
        .pipe(Stream.runCollect, Effect.flip)

      expect(events).toEqual([opened, firstChunk])
      expect(failure).toEqual(new TranscriptReadFailed({ detail: 'EACCES' }))
    }),
  )
})

describe('Command wire shapes', () => {
  it('carries a routed command through JSON', () => {
    const routed = new RoutedCommand({
      id: CommandId.make(7),
      key: IdempotencyKey.make('action-1'),
      command: new SendKeys({ pane, keys: ['esc'] }),
    })

    expect(roundTrip(RoutedCommand, routed)).toEqual(routed)
  })

  it('carries both sides of a command result through JSON', () => {
    const delivered = Result.succeed(
      new InputDelivered({ pane, terminal: TerminalId.make('term_1'), stateChangeSeq: 14162 }),
    )
    const refused = Result.fail(new PaneNotAgent({ pane }))
    const unknown = Result.fail(new CommandDeliveryUnknown())

    expect(roundTrip(CommandResult, delivered)).toEqual(delivered)
    expect(roundTrip(CommandResult, refused)).toEqual(refused)
    expect(roundTrip(CommandResult, unknown)).toEqual(unknown)
  })

  it('carries a rename, a close and their receipts through JSON', () => {
    const rename = new RoutedCommand({
      id: CommandId.make(8),
      key: IdempotencyKey.make('action-2'),
      command: new RenameAgent({ pane, label: Option.some('Payments') }),
    })
    const close = new RoutedCommand({
      id: CommandId.make(9),
      key: IdempotencyKey.make('action-3'),
      command: new ClosePane({ pane, confirmed: false }),
    })
    const renamed = Result.succeed(new PaneRenamed({ pane, label: Option.none() }))
    const closed = Result.succeed(new PaneClosed({ pane }))
    const notOurs = Result.fail(new PaneNotCreatedByCrook({ pane }))

    expect(roundTrip(RoutedCommand, rename)).toEqual(rename)
    expect(roundTrip(RoutedCommand, close)).toEqual(close)
    expect(roundTrip(CommandResult, renamed)).toEqual(renamed)
    expect(roundTrip(CommandResult, closed)).toEqual(closed)
    expect(roundTrip(CommandResult, notOurs)).toEqual(notOurs)
  })

  it('carries every answer to an ask, and every way it can fail, through JSON', () => {
    const ask = AskId.make('toolu_01XXC3')
    const answers = [
      new Approve({}),
      new Decline({ message: Option.some('use printf') }),
      new Decline({ message: Option.none() }),
      new Choose({ answer: 'Green' }),
    ].map(
      (answer, index) =>
        new RoutedCommand({
          id: CommandId.make(10 + index),
          key: IdempotencyKey.make(`answer-${index}`),
          command: new AnswerAsk({ pane, ask, answer }),
        }),
    )
    const failures = [
      new AskNotPending({ pane, ask }),
      new AskDialogUnreadable({ pane }),
      new AskOptionUnavailable({ pane, option: 'Purple' }),
      new QuestionnaireUnsupported({ pane }),
      new DeclineMessageUndelivered({ pane, reason: 'herdr did not confirm the prompt in time' }),
    ].map((failure) => Result.fail(failure))

    expect(answers.map((routed) => roundTrip(RoutedCommand, routed))).toEqual(answers)
    expect(failures.map((result) => roundTrip(CommandResult, result))).toEqual(failures)
  })
})
