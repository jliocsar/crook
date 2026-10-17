# crook — ARCHITECTURE (draft v0.1)

How the code is laid out and the patterns it follows. The _what_ and _why_ of the product live in `SPEC.md`; the repo's toolchain rules live in `AGENTS.md` and win over anything here.

## 1. Shape in one picture

```
                 @crook/domain   (ids, entities, statuses — schemas only)
                       ▲
                 @crook/protocol (Effect RPC groups: AgentLink, ClientApi)
          ┌─────────────┼─────────────────┐
   @crook/agent    @crook/hub          @crook/web
     │      │
@crook/herdr  @crook/claude
```

- Arrows point at dependencies. Nothing depends on an app (`agent`, `hub`, `web`).
- `herdr` and `claude` are libraries only the agent uses. The phone never parses a transcript or talks Herdr; it receives `domain` values.
- `domain` + `protocol` are the only packages the PWA bundle pulls from the monorepo, so they stay free of Node/Bun-only imports.

## 2. Packages

All under `packages/*`, per the boilerplate. Scope renamed `@boilerplate/*` → `@crook/*` (root `package.json` name too).

```
packages/
  tsconfig/   @crook/tsconfig   shared TS base (exists)
  domain/     @crook/domain     branded ids, entities, statuses
  protocol/   @crook/protocol   RPC definitions + wire errors
  herdr/      @crook/herdr      Effect client for the Herdr socket API
  claude/     @crook/claude     Claude transcript locate/tail/parse + Ask derivation
  agent/      @crook/agent      per-machine daemon (compiled binary) + herdr plugin
  hub/        @crook/hub        exe.dev server (compiled binary, embeds web build)
  web/        @crook/web        PWA (React + Vite)
```

### 2.1 `@crook/domain`

Schemas and their types, side by side (locality rule). No services, no IO.

- Branded ids: `MachineId`, `WorkspaceId`, `TabId`, `PaneId` (herdr's `w1:p1`), `GlobalPaneId` (`<machine>/<pane>`), `ClaudeSessionId`, `IdempotencyKey`, `TranscriptOffset`.
- Entities: `Machine`, `Workspace`, `Tab`, `AgentRow`, `AgentStatus` (`idle|working|blocked|done|unknown`), `MachineState` (one machine's whole herd), `HerdView` (all machines + connectivity).
- Transcript model: `TranscriptMessage`, content blocks (`Text`, `Thinking`, `ToolUse`, `ToolResult`, `Image`), `TranscriptChunk { offset, messages }`.
- `Ask` (permission | question | unknown) with options as key sequences.

### 2.2 `@crook/protocol`

Two `RpcGroup`s and the wire-level tagged errors. Nothing else.

- `AgentLink` — called **by the agent** on the hub (the agent dials out, so it's always the RPC client):
  - `Attach` (streaming) → `Stream<Command>`: the hub pushes commands down this stream for as long as the connection lives.
  - `PublishState { state: MachineState, version }`
  - `CompleteCommand { commandId, result }`
  - `PublishTranscript { pane, chunk }` (only while some phone has that pane open)
- `ClientApi` — called **by the PWA** on the hub:
  - `WatchHerd` (streaming) → `Stream<HerdView>`
  - `WatchTranscript { pane, fromOffset }` (streaming) → `Stream<TranscriptChunk>`
  - `WatchScreen { pane }` (streaming) → `Stream<ScreenFrame>` (terminal fallback view)
  - `Prompt`, `SendKeys`, `AnswerAsk`, `StartAgent`, `CreateTab`, `CreateWorktree`, `Rename`, `Close`, `MarkSeen` — each with an `IdempotencyKey`
  - `ForgetMachine`
- Serialization: `RpcSerialization.layerNdjson` (sockets need framing).

Why "agent is always the client": Effect RPC servers listen; the agent can't (laptop behind NAT, no inbound). A server-streamed `Attach` gives the hub a push channel to the agent without reverse-RPC plumbing.

### 2.3 `@crook/herdr`

An Effect client for Herdr's socket API. Private like everything else, but kept free of crook concepts anyway: it's the cleanest seam for testing the agent.

- `HerdrClient` service: `request(method, params)` with schemas per method, `subscribe(subscriptions)` → `Stream<HerdrEvent>`, `snapshot()`.
- Schemas mirror Herdr's own records (generated or hand-written from `herdr api schema --json`); mapping to `@crook/domain` happens in the agent, not here.
- Transport: NDJSON over a Unix socket. One long-lived connection for the event subscription, one for requests (Herdr closes a subscription connection on `events_lost`).
- Layers: `HerdrClient.layer` (socket path from `Config`, default `~/.config/herdr/herdr.sock`), `HerdrClient.layerTest` (scripted responses + event queue).
- Open: whether `@effect/platform-bun` exposes a Unix-socket client `Socket`; otherwise wrap `Bun.connect({ unix })` with `Socket.make` / `Socket.fromTransformStream`.

### 2.4 `@crook/claude`

- `TranscriptLocator`: session id → file path, searching configured roots (`~/.claude`, `CLAUDE_CONFIG_DIR`, comma list).
- `TranscriptTail`: `tail(sessionId, fromOffset)` → `Stream<TranscriptChunk>` (fs watch + read from offset, splits on complete lines only).
- `parseLine` / `parseChunk`: pure, JSONL → `TranscriptMessage`. Unknown entry types become an explicit `Unrecognized` block, never dropped silently.
- `deriveAsk(lastMessages, screenText)`: pure. Last unmatched `ToolUse` first, screen pattern second, `unknown` with raw screen last.
- This is the package that gets the heaviest tests: fixtures captured from real sessions.

### 2.5 `@crook/agent`

```
src/
  main.ts                 runMain; CLI root (effect/cli)
  Cli.ts                  commands: run, status, install-service, uninstall-service
  AgentConfig.ts          Config: hub url, exe.dev token (redacted), claude roots, policy
  MachineStateSync.ts     herdr snapshot + events → SubscriptionRef<MachineState>
  HubLink.ts              RpcClient over WebSocket, reconnect schedule, Attach loop
  CommandExecutor.ts      policy check → idempotency cache → herdr calls → result
  CommandPolicy.ts        what a command may touch (agent panes only, allowed kinds)
  TranscriptStreams.ts    open/close per-pane tails on hub demand
plugin/
  herdr-plugin.toml       startup hook ensures the service; actions: connect, status, restart
```

### 2.6 `@crook/hub`

```
src/
  main.ts                 runMain; BunHttpServer
  HttpRoutes.ts           static PWA, /rpc/agent (ws), /rpc/client (ws), health
  ExeDevIdentity.ts       reads X-ExeDev-Email / X-ExeDev-Token-Ctx; rejects anything else
  Herd.ts                 SubscriptionRef<Map<MachineId, MachineEntry>> + HerdView stream
  MachineRegistry.ts      sqlite: machines, last seen, forgotten
  CommandRouter.ts        commandId → Deferred; routes to the right Attach stream; timeouts
  SeenTracker.ts          MarkSeen: per-pane seen against state_change_seq, never Herdr focus (D12)
  TranscriptRelay.ts      fan out PublishTranscript to WatchTranscript subscribers
  HarkNotifier.ts         herd transitions → Hark (Live Activity, approvals, notifications); long-polls answers into CommandRouter
  Database.ts             @effect/sql-sqlite-bun client + migrations
  AgentLinkHandlers.ts    AgentLink.toLayer(...)
  ClientApiHandlers.ts    ClientApi.toLayer(...)
```

### 2.7 `@crook/web`

```
src/
  main.tsx                React root, RegistryProvider
  routes/                 TanStack Router, file-based (generated route tree): herd, machine, pane chat, terminal, new agent, settings
  rpc/                    RpcClient over WebSocket (browser socket layer), runtime
  atoms/                  herd, connection, transcript (family by pane), screen, commands
  components/ui/          Mischief UI, copied in with the shadcn CLI (we own this code)
  components/             app components built from ui/ (AgentRow, AskCard, KeyStrip, …)
  highlight/              shiki setup (JS regex engine, fine-grained langs, hast → JSX)
  sw/                     service worker: app shell cache only
```

## 3. Patterns

### 3.1 State is a value, events are triggers

Herdr says its events invalidate and its reads are authoritative. So:

- The agent keeps one `MachineState` in a `SubscriptionRef`. A Herdr event (or a reconnect) triggers a re-read; the result **replaces** the value.
- The agent publishes the whole `MachineState` with a monotonically increasing `version` whenever it changes (coalesced so a burst of events is one publish).
- The hub keeps the latest value per machine and emits a fresh `HerdView` to phones. The phone replaces, never patches.
- No event log, no replay, no ordering bugs. If whole-state messages turn out large (measure in M1), switch the hub → phone leg to per-machine replacement first, diffs last.

### 3.2 Append-only streams with offsets

Transcripts are append-only files, so they travel as `TranscriptChunk { offset, messages }`. Every consumer remembers the last offset; reconnect = `WatchTranscript { fromOffset }`. Nothing is cached in the hub (D10): the hub asks the agent to start a tail when the first phone subscribes and stops it when the last leaves.

### 3.3 Commands: idempotent, confirmed by state

- The phone mints an `IdempotencyKey` per user action and reuses it on retry.
- Hub: `CommandRouter` gives the command an id, pushes it down that machine's `Attach` stream, awaits `CompleteCommand` with a timeout.
- Agent: `CommandExecutor` checks a bounded cache of recent keys → replays the stored result instead of re-executing.
- The UI shows "sent" on ack and "done" only when `MachineState` shows the effect (status leaves `blocked`, a new pane appears). Lost acks never cause double prompts.

### 3.4 Effect conventions (from `effect-best-practices` + `AGENTS.md`)

- Services: `Context.Service<X>()("crook/X", { make })` + a hand-written `static layer`; deps resolved with `yield*` inside `make`.
- Every method is `Effect.fn("X.method")` (automatic spans).
- One `Schema.TaggedErrorClass` per failure reason, with a full-sentence `message`. Library errors (`HerdrSocketClosed`, `TranscriptNotFound`, …) are mapped to wire errors in `@crook/protocol` at the RPC boundary, never leaked raw.
- Branded ids everywhere; `Option` for absence; no `_tag` reads.
- `Config` for every knob, `Config.redacted` for the exe.dev token.
- Each service exports a test layer next to its live one; apps compose layers once in `main.ts`.

### 3.5 Resilience

- Every long-lived connection (agent → Herdr, agent → hub, phone → hub) is a scoped resource retried with an exponential `Schedule` capped at a maximum, reset after a healthy period.
- On any reconnect the consumer re-reads authoritative state first (Herdr snapshot, `WatchHerd` first emission, transcript from last offset).
- The hub marks a machine offline when its `Attach` stream ends; it never guesses.

### 3.6 Identity and trust

- Phone: exe.dev session cookie → proxy injects `X-ExeDev-Email`; hub checks it against `CROOK_OWNER_EMAIL`.
- Agent: exe.dev VM token for the hub VM, minted with `ctx = { machine: "<id>" }`; the proxy verifies and forwards `X-ExeDev-Token-Ctx`. The hub takes `MachineId` from there only.
- Agent-side `CommandPolicy` is the last guard: input only to panes hosting a recognized agent; `StartAgent` only for allowed kinds.

### 3.7 PWA state

- Effect in the browser too: `RpcClient` over WebSocket, `@effect/atom-react` for state. Streaming RPCs map straight onto atoms (`WatchHerd` → herd atom, `WatchTranscript` → an atom family keyed by pane).
- The connection lifecycle is an Effect retry schedule surfaced as a `connection` atom, not a hand-built machine.
- No XState. Multi-step flows (Ask → answer → confirm, command sent → acked → observed) are atoms holding a tagged state value, driven by `Atom.fn` effects.
- UI-local state stays in React.

## 4. Message flows

Startup (agent)

```
agent ── Herdr: subscribe events ──▶ then snapshot ──▶ MachineState v1
agent ── hub: Attach (ws, VM token) ◀── hub marks machine online
agent ── hub: PublishState v1 ──▶ hub ── WatchHerd ──▶ phones
```

Agent goes blocked

```
Herdr event pane.agent_status_changed ──▶ agent re-reads ──▶ MachineState v(n+1) with Ask
  ──▶ PublishState ──▶ hub: Herd updated ──▶ WatchHerd ──▶ open phones
                               └──▶ HarkNotifier (blocked) ──▶ Hark approval ──▶ lock screen
```

Approved from the lock screen

```
Hark interaction /wait resolves ──▶ HarkNotifier ──▶ CommandRouter (AnswerAsk, idempotency key = interaction id)
  ──▶ Attach ──▶ agent: CommandPolicy ──▶ send-keys ──▶ Herdr status moves on ──▶ PublishState ──▶ HarkNotifier ends the prompt
```

Answer from phone

```
phone AnswerAsk{key} ──▶ hub CommandRouter ── Attach stream ──▶ agent CommandExecutor
  ──▶ policy ──▶ herdr agent.send_keys ──▶ CompleteCommand ──▶ hub ──▶ phone "sent"
Herdr status leaves blocked ──▶ PublishState ──▶ phone "done"
```

## 5. Build, run, ship

- Agent and hub: `bun build --compile` per target; the hub embeds `@crook/web`'s build output.
- Agent runs as a systemd user unit (`crook-agent.service`), installed by `crook-agent install-service` or the plugin's "connect" action.
- Hub runs as a systemd unit on its own exe.dev VM.
- Releases from CI with actions pinned by SHA and signed artifacts.

## 6. Testing

- Pure modules (`claude` parser, `deriveAsk`, domain mapping) get fixture-driven tests from captured real sessions.
- Services are tested against their `layerTest` siblings; RPC handlers with `RpcTest` (in-memory).
- One end-to-end check per milestone: fake Herdr (test layer) → real agent → real hub → headless RPC client.

## 7. Decisions (review round 1)

- Tests: `vitest` + `@effect/vitest` (`it.effect`, `it.layer`, `TestClock`). Every member's `test` script is `vitest run`.
- PWA state: Effect atoms only, no XState.
- House lint rules apply to `@crook/web` unchanged.
- `effect` bumped to stable `4.0.5` (in the boilerplate first, then here).
- Everything stays private; no package is published.
- TanStack Router with file-based routes.

## 8. Open questions

- None yet. Next up: spikes (SPEC §10), then M1.
