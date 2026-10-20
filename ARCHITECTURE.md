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

Schemas and their types, side by side (locality rule), plus the pure functions over them that more than one app needs. No services, no IO.

- Branded ids: `MachineId`, `WorkspaceId`, `TabId`, `PaneId` (herdr's `w1:p1`), `GlobalPaneId` (`<machine>/<pane>`), `ClaudeSessionId`, `IdempotencyKey`, `TranscriptOffset`.
- Entities: `Machine`, `Workspace`, `Tab`, `AgentRow`, `AgentStatus` (`idle|working|blocked|done|unknown`), `MachineState` (one machine's whole herd), `HerdView` (all machines + connectivity).
- `CrookVersion`: `major.minor.patch`, compared as numbers, so the PWA can tell an agent that is behind the hub (`isBehind`). Each app reads its own `package.json` version, and the two release under one version and bump together (AGENTS.md): a hub-only bump would show "update agent" on every machine with no newer agent to install.
- `AgentPriority` (built in JC-98): the order of one machine's agents and the needs-you count, shared by the herd list and the tab badge. See "Seen and needs-you" under 2.6.
- Transcript model: `TranscriptMessage`, content blocks (`Text`, `Thinking`, `ToolUse`, `ToolResult`, `Image`), `TranscriptChunk { offset, messages }`.
- `Ask` (permission | question | unknown) with options as key sequences.

### 2.2 `@crook/protocol`

Two `RpcGroup`s and the wire-level tagged errors. Nothing else.

- `AgentLink` — called **by the agent** on the hub (the agent dials out, so it's always the RPC client):
  - `Attach { hello }` (streaming) → `Stream<Command>`: the hub pushes commands down this stream for as long as the connection lives. `hello` carries the agent's version as a plain string and an optional label, so a machine is never online without them. The hub reads the string as a `CrookVersion`; one it cannot read (a prerelease, say) becomes no version, which hides the update pill instead of failing the whole `Attach`.
  - `PublishState { state: MachineState, version }`
  - `CompleteCommand { commandId, result }`
  - `PublishTranscript { pane, chunk }` (only while some phone has that pane open)
- `ClientApi` — called **by the PWA** on the hub:
  - `WatchHerd` (streaming) → `Stream<HerdView>`
  - `WatchTranscript { pane, fromOffset }` (streaming) → `Stream<TranscriptChunk>`
  - `WatchScreen { pane }` (streaming) → `Stream<ScreenFrame>` (terminal fallback view)
  - `Prompt`, `SendKeys`, `AnswerAsk`, `StartAgent`, `CreateTab`, `CreateWorktree`, `Rename`, `Close` — each with an `IdempotencyKey`
  - `ForgetMachine { machine }`: offline machines only. `MarkSeen { machine, pane }` needs no idempotency key: marking the same state seen twice changes nothing.
  - Built so far: `WatchHerd`, `ForgetMachine`, `MarkSeen`. Their refusals are `MachineNotInHerd`, `MachineStillConnected`, `PaneNotInHerd` and `HubStorageFailed` (the hub's database refused the write, so nothing changed).
- Serialization: `RpcSerialization.layerNdjson` (sockets need framing).

Why "agent is always the client": Effect RPC servers listen; the agent can't (laptop behind NAT, no inbound). A server-streamed `Attach` gives the hub a push channel to the agent without reverse-RPC plumbing.

### 2.3 `@crook/herdr`

An Effect client for Herdr's socket API. Private like everything else, but kept free of crook concepts anyway: it's the cleanest seam for testing the agent.

- `HerdrClient` service: `request(method, params)` typed by a `HerdrMethod` value (params + result schema), `snapshot`, and `subscribe(subscriptions)`. `subscribe` is scoped and resolves only once Herdr acks with `subscription_started`, yielding a `Stream<HerdrEvent>`; that ordering is the recovery contract, so the caller can `subscribe` then `snapshot` and miss nothing.
- Methods are added by the ticket that first calls them; today `ping`, `session.snapshot` and `pane.process_info`.
- Error codes crook acts on get their own tagged error: `events_lost` → `HerdrEventsLost`, `pane_not_found` → `HerdrPaneNotFound` (from any request or the subscribe itself). Every other code stays `HerdrRequestRejected`.
- `state_change_seq` decodes to herdr's schema default of 0 when absent, so it is a plain `Int`.
- Schemas are hand-written from `herdr api schema --json` and decode only the fields crook reads: excess keys are ignored, so `layouts`, `tokens`, `state_labels` and `scroll` are left out. Optional or nullable fields decode to `Option`. Field names stay snake_case, as on the wire; mapping to `@crook/domain` happens in the agent, not here.
- Transport: NDJSON over a Unix socket via `@effect/platform-bun`'s `BunSocket.makeNet({ path })`. **One connection per request**: Herdr answers one request line and closes the connection, a second request on it gets nothing (measured, herdr 0.9.1). A subscription connection stays open; `events_lost` arrives as an error response carrying the subscribe request's id, then Herdr closes it.
- Event wire shape (measured): a lifecycle event is `{"event":"pane_closed","data":{"type":"pane_closed",…}}` — snake_case, even though it is subscribed as `pane.closed`. The pane-scoped `pane.agent_status_changed` keeps the dotted name and carries no `data.type`.
- **Status changes need a pane-scoped subscription** (measured): `pane.agent_status_changed` requires a `pane_id`, and a lifecycle-only subscriber sees a `pane_updated` on the first detection of an agent but nothing for later working → blocked → idle moves. The agent subscribes per agent pane and resubscribes when the pane set changes (subscriptions are fixed per connection). An unknown `pane_id` rejects the whole subscribe with `pane_not_found`.
- Layers: `HerdrClient.layer` (socket path from `HERDR_SOCKET_PATH`, else `$HOME/.config/herdr/herdr.sock`), `HerdrClient.layerAt(path)`, `HerdrClient.layerTest({ responses, events })`. Scripted responses are encoded lines run through the live decoder; events come from a `Queue` whose failure becomes the stream's.

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

MachineStateSync (built in JC-88, verified against a live herdr 0.9.1):

- The layer reads herdr once before it hands out the service, so the `SubscriptionRef` always holds a real `MachineState`; version 0 is that first read. A herdr that is down holds the layer up until it answers.
- One loop, forked into the layer's scope: subscribe (lifecycle kinds that change `MachineState` plus one `pane.agent_status_changed` per agent pane), re-read once `subscription_started` arrives, then re-read on every event. A sliding buffer of one sits in front of the re-read, so a burst of events arriving during a read costs one more read, not one per event.
- A re-read that changes nothing keeps the version; a change bumps it by one. `statusChangedAt` is stamped by the agent at the read that first sees a status, since herdr carries no timestamp.
- When a re-read shows a different set of agent panes, the subscription is closed and opened again with the new set. `events_lost` resubscribes at once; `pane_not_found` (a pane closed between the read and the subscribe) re-reads first so the next subscribe names live panes only; every other herdr failure waits `HERDR_RECONNECT_INTERVAL` (100 ms, from a measured 101–114 ms cold start of a herdr server) and retries forever. A local socket connect is cheap, so the herdr leg uses a fixed interval rather than §3.5's exponential schedule.
- `ClaudeSessions` resolves a pane to its Claude session per S4: `agent_session` of kind `id` first, then the pid file (`pane.process_info` → the `claude` foreground process → its `CLAUDE_CONFIG_DIR` or `$HOME/.claude` from `/proc/<pid>/environ` → `sessions/<pid>.json`, kept only when its `procStart` matches `/proc/<pid>/stat` field 22). A missing file or closed pane is `None`. An unreadable or reshaped file, or a rejected or malformed `pane.process_info`, is logged as a warning and that one pane goes without a session; only transport failures abort the whole read. Herdr failures log at warning, except `HerdrUnreachable`, which repeats every interval while herdr is down and logs at debug. On the laptop 9 of 11 live agents resolve only through the pid file.
- The machine id comes from `CROOK_MACHINE_ID`.
- `MachineState` carries herdr's server version from `session.snapshot`, not the hello: herdr can be updated or restarted under a running agent whose hub link never drops, and a version in the hello would go stale until the next reconnect. A herdr update bumps the state version like any other change.
- Branch (built in JC-98): herdr records carry the pane's `cwd` and `foreground_cwd` but no branch, and `worktree.list` reports branches per repository, not per pane. `GitBranches` finds the `.git` entry above the agent's cwd (a directory, or a linked worktree's `gitdir:` file), caches a found one per cwd for the agent's lifetime (`effect/Cache`, so panes sharing a cwd walk the folders once), and reads `HEAD` on every re-read, so a checkout shows up with the next herdr event. A miss is not cached: a folder that becomes a repository gets its branch at the next re-read, for a few `stat`s per re-read on panes outside git. A detached `HEAD`, a folder outside git and a pane without a cwd are `None`. An unreadable `HEAD` is logged as a warning and that pane goes without a branch, like an unreadable Claude session file.

HubLink (built in JC-89):

- One session per connection: build the RPC client, hold `Attach` open, and publish `MachineStateSync.changes` through a sliding buffer of one. `changes` replays the current value, so every new connection republishes the current state first, and a slow hub only ever gets the newest version.
- The session ends when `Attach` ends (`HubAttachEnded`), a call fails with `RpcClientError` (drop, refused or timed-out connect, ping timeout), the hub rejects a publish (`MachineIdMismatch`), or a call dies (`HubCallDefected`: the hub couldn't decode the payload, or its handler crashed). Defects are turned into that tagged error at the boundary, because `retry` and `forever` let a defect through and it would stop HubLink for good without a log line. Every end logs at warning and reconnects.
- A drop fails every in-flight call, because the socket protocol broadcasts the error before it consults its own retry, so `Attach` fails and the session ends. The protocol's retry is switched off (`retryPolicy: Schedule.recurs(0)`) so nothing redials inside a closing session; HubLink's schedule is the only one: exponential from `HUB_RECONNECT_BASE`, capped at `AGENT_PING_INTERVAL`.
- A connection is healthy once the hub has accepted a publish and the link stayed up for a whole ping interval after it. When a healthy connection drops, HubLink reconnects at once and the backoff starts over. The clock starts at the first accepted publish, not at connect: a hub that takes the TCP connection but never finishes the upgrade fails each attempt after the socket's 10 s open timeout, and timing from connect would call that healthy and never back off (measured).
- `HUB_RECONNECT_BASE` is 77 ms, the slowest of 9 warm HTTPS requests from the laptop to an exe.dev VM's proxy (52–77 ms; the cold first one took 626 ms). `AGENT_PING_INTERVAL` (in `@crook/protocol`, since the hub times agents out on it too) is effect's RpcClient default of 5 s, written out because the cap, the healthy period and the hub's silence timeout reuse it. S1 measured no proxy idle timeout within 900 s, so the ping exists to detect a dead hub, not to keep the proxy open.
- Config: `CROOK_HUB_URL` (the `ws`/`wss` URL of the hub's `/rpc/agent`) and `CROOK_HUB_TOKEN` (`Config.Redacted`), sent as `X-Exedev-Authorization: Bearer <token>`. `CROOK_MACHINE_LABEL` is optional; the hub labels a machine by its id without it.
- Every `Attach` sends the hello: the agent's own `package.json` version and the label. The socket's open timeout is written out as `AGENT_SOCKET_OPEN_TIMEOUT` (effect's default of 10 s), because the hub's reconnect grace is built on it.

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

Server, identity and Herd (built in JC-90):

- Four GET routes: `/health` (no headers needed), `/rpc/agent`, `/rpc/client`, and `/*` for the static PWA from `CROOK_WEB_ROOT` with the SPA fallback (an extensionless path that accepts HTML gets `index.html`). The RPC handlers sit in `HttpRoutes` for now rather than in the two handler modules above.
- Every rejection is a tagged error that answers itself as a 403 carrying its `message` (`HttpServerRespondable`), so the router's access log records why.
- exe.dev sends the minter's email with every VM-token request, alongside the token's `ctx` (exe.dev docs, "What your server receives"). So the email alone can't tell the phone from an agent:
  - `/rpc/agent` wants the owner's email and a `ctx` with a machine id.
  - The phone routes want the owner's email and no `ctx` at all. Without that, a leaked agent token could watch the herd.
  - `/rpc/client` also wants `Origin` to equal `CROOK_HUB_ORIGIN`, which must be `https` (anything else fails at startup: a scheme-less value parses to origin `"null"`, which sandboxed pages send).
  - A token minted without a `ctx` looks exactly like a browser login. Only the owner can mint one, which is outside the threat model.
- Machine identity is read once, at the agent's upgrade, and each agent connection gets its own RPC server whose handlers close over that machine id. Handler `headers` can't be trusted for it: per-call headers override the upgrade's (AGENTS.md).
- `Herd` holds one entry per machine: the number of live `Attach` streams, `lastSeenAt` and the last `MachineState`. Online means at least one `Attach` is open; counting lets a reconnect overlap the old connection without a false offline. Offline keeps the last state. `WatchHerd` is `SubscriptionRef.changes` behind a sliding buffer of one, so it emits the current view first and a slow phone only gets the newest. Machines are listed by id.
- A dead agent socket that never closes is caught by Bun's `idleTimeout`, set to `SOCKET_SILENCE_TIMEOUT` (two `AGENT_PING_INTERVAL`s, the same rule effect's RpcClient uses to call a hub dead). Bun's own pings are off (`sendPings: false`): through the proxy the proxy would answer them and keep a dead agent online. The agent's RPC pings are data frames, so a healthy agent stays up. A silent agent showed as dropped after 11.8–11.9 s against the 10 s timeout (5 runs, measured before JC-97, when a drop meant offline); a kill closes the socket and showed as dropped at once. Since JC-97 a dropped machine is `reconnecting` first and turns `offline` after `RECONNECT_GRACE`. The timeout is server-wide, so the PWA's client must ping within it too.
- Shutdown uses a `gracefulShutdownTimeout` of zero: sockets never finish on their own, so a grace period would only ever be waited out in full, and agents reconnect anyway.
- Config: `CROOK_HUB_PORT`, `CROOK_OWNER_EMAIL` (compared exactly), `CROOK_HUB_ORIGIN`, `CROOK_WEB_ROOT`, `CROOK_HUB_DATABASE_PATH`.

Database (built in JC-97, shared by every later table):

- One SQLite file through `@effect/sql-sqlite-bun`, at `CROOK_HUB_DATABASE_PATH`. `Database.layer` builds the client and runs the migrations before anything reads, and `main.ts` provides it once; `Database.layerAt(":memory:")` is the test database.
- Every table comes from a numbered migration in the one migration record in `Database`, never from the module that reads it: migrations are history, and an `ALTER` belongs to no single repository. A later ticket appends the next number.
- Columns are snake_case. The client maps names camelCase ↔ snake_case both ways, so `sql.insert({ lastSeenAt })` writes `last_seen_at` and rows come back as `lastSeenAt`. Raw SQL text is not mapped.
- Each table has one schema, used both ways through `effect/sql/SqlSchema`: writes encode a record with it, reads decode rows with it. A row that does not decode is `StoredRowInvalid` and stops the hub at startup rather than serving a half-read herd. A record that does not encode is a defect: the record was built from that same schema.
- Memory stays authoritative while the hub runs; the database is what survives a restart. A write the agent link causes (attach, drop, publish) that fails is logged at error and the hub carries on from memory: failing it would drop every machine over a full disk. A write the phone asks for (forget, mark seen) runs before memory changes, and a failure returns `HubStorageFailed` with nothing changed.

Machine registry (built in JC-97):

- `machines` keeps id, label, last seen, forgotten, and the last agent and herdr versions, so after a hub restart every known machine is listed offline with its last seen and versions until its agent reconnects. The last state is not stored: an offline machine's agents are unknown. Last seen is written at each link event (attach, publish, drop), not while a connected machine stays quiet, so after an unclean hub stop (crash, OOM, reboot) a machine that never returns shows the time of its last link event, which can be older than its last connection.
- The label is the hello's label, else the id. It is rewritten on every attach.
- Connection is `online`, `reconnecting` or `offline`, and `connectionChangedAt` is when the machine last came online or last dropped ("Online for", "Reconnecting for"). A dropped machine is `reconnecting` for `RECONNECT_GRACE`, then `offline`. The grace is `AGENT_SOCKET_OPEN_TIMEOUT` plus `AGENT_PING_INTERVAL` (15 s): one dial can hang for the full open timeout against a hub that takes the TCP connection but never upgrades (measured, see HubLink), and HubLink never waits longer than one ping interval before the next dial. It is built from those two parts, not measured end to end against the exe.dev proxy. A machine loaded at startup is `offline`, with `connectionChangedAt` equal to its last seen.
- `ForgetMachine` hides an offline machine (online and reconnecting ones are refused); the row stays with `forgotten` set. The next `Attach` clears it, so a forgotten machine returns on its own.

Seen and needs-you (built in JC-98):

- The hub keeps, per machine and pane, the `state_change_seq` the user last saw. A pane is seen when that number equals the pane's current one. Equality, not "at least": herdr's sequence can restart lower, and a stale higher mark must not hide a new state.
- `MarkSeen` records the pane's current sequence in the hub's last state for that machine; the phone sends it when a chat opens and again while a chat stays open on an agent that changes. Herdr focus is never called (D12): the hub has no herdr connection at all.
- A publish drops the marks of panes no longer in the state, so a reused pane id starts unseen.
- Seen survives a hub restart (`seen` table). Lost marks would bring every opened done agent back as "needs you" after each deploy, inflate the tab badge, and (JC-107) notify again for what was already read. Marks are few and the table already exists, so the cost is one upsert per chat open.
- `HerdMachine.seen` lists the panes seen at their current sequence. `AgentPriority.orderAgents` sorts a machine's agents: blocked (longest waiting first), done and unseen (newest first), working, then idle and seen done, then unknown, keeping herdr's order inside the last three. Ties use `statusChangedAt`. `needsYouCount` counts blocked plus unseen done and is zero for an offline machine; `herdNeedsYouCount` sums the machines. Pins (JC-112) become one more tier in front.

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
- One `Schema.TaggedError` per failure reason, with a full-sentence `message`. Library errors (`HerdrSocketClosed`, `TranscriptNotFound`, …) are mapped to wire errors in `@crook/protocol` at the RPC boundary, never leaked raw.
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
