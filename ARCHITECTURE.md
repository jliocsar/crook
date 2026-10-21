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

- Branded ids: `MachineId`, `WorkspaceId`, `TabId`, `PaneId` (herdr's `w1:p1`), `GlobalPaneId` (`<machine>/<pane>`), `TerminalId` (herdr's `terminal_id`), `HerdrConnectionId` (see `HerdrLink`), `ClaudeSessionId`, `IdempotencyKey`, `TranscriptOffset`. All of them live together in `Ids`.
- Entities: `Machine`, `Workspace`, `Tab`, `Pane`, `AgentRow`, `StatusBeforeHandoff`, `AgentStatus` (`idle|working|blocked|done|unknown`), `HerdrLink`, `MachineState` (one machine's whole herd), `HerdView` (all machines + connectivity).
- `MachineState.panes` lists every pane herdr shows, agent or not, so `panePresence(state, pane)` tells `agent` (in `agents`), `noAgent` (the pane is still there: Claude exited, or it never ran one) and `gone` (the pane closed). That is the chat's end card: "Claude exited" against "This pane closed" (JC-101). An agent herdr has not re-detected yet stays `unknown`, never a status carried over from before.
- `AgentRow.terminal` is herdr's `terminal_id`. It changes on every herdr server lifetime (stop, crash, handoff; spike S6, measured on herdr 0.9.5 only) while the pane id stays, so it is what scopes a pane's `stateChangeSeq`: two sequences are comparable only under the same terminal.
- `AgentRow.beforeHandoff` (`StatusBeforeHandoff`) holds the status, `statusChangedAt`, `terminal` and `stateChangeSeq` a pane had under its previous terminal. It is set when the same agent shows up under a new terminal with a known status before, and kept while the row reads `unknown` or the status it had before; the first other status drops it. It is how a handoff's re-detection, which arrives on the same herdr connection about 3 s after the resync (spike S6), is told from a real change. A pane that was already `unknown` before the handoff gets none.
- What a real Claude reads through a handoff (measured on herdr 0.9.5, 6 handoffs of one `claude` in a probe session): first `idle` at sequence 0 for about 300 ms, then `unknown` at sequence 1 for 3.2–3.4 s, then the re-detected status at sequence 2. The 4 handoffs polled every 40–150 ms all showed the `idle`/0 read; the 2 followed through the agent's own sync first read `unknown`/1. `agent` stays `claude` and `agent_session` keeps the same id on every read, the `claude` pid is the same, and its pid file resolves the same session. A `working` agent came back `working`, an `idle` one `idle`, and a `done` one (finished in a tab nobody was viewing) came back `idle` all 3 times: the handoff loses the completion. A reconnect can therefore land on either of the first two reads. Blocked through a handoff was not measured.
- The agent therefore reads a status at sequence 0 of an agent it already listed as `unknown`: herdr bumps the sequence on every change, so sequence 0 is the value a lifetime starts with, before anything was detected. A row that carries `done` from before the handoff and is re-detected `idle` stays `done` (with the stamp and seen mark from before) until it moves on: nothing marked it seen, only the handoff dropped it.
- A row carries anything over from the previous state (`beforeHandoff`, or the `statusChangedAt` of an unchanged status) only from the same agent: the same terminal, or a new terminal whose Claude session resolves to the one the previous row had. A handoff keeps the pane's processes and herdr keeps the reported session (measured above), so its Claude resolves to the same session; a stop or crash restores the panes as fresh shells, so a Claude started in one afterwards is a new process and starts from nothing, even when the agent's cached rows from before the restart are still there. An agent whose session does not resolve on both reads carries nothing over a handoff, and its re-detection reads as a change.
- `seenMarkOf(row)` is the pane's seen identity: the `terminal` and `stateChangeSeq` of `beforeHandoff` while the row carries one, else the row's own. A state that continues through a handoff keeps the identity it had before it.
- `MachineState.herdr` (`HerdrLink`) carries the agent's side of the herdr connection: a `connection` id the agent mints whenever it re-reads after losing herdr, and `lostAt`, set while the agent cannot reach herdr and the rest of the state is the last one it read. `isResync(previous, next)` holds when two states were read over different connections, `isHerdrLost(state)` while `lostAt` is set.
- `CrookVersion`: `major.minor.patch`, compared as numbers, so the PWA can tell an agent that is behind the hub (`isBehind`). Each app reads its own `package.json` version, and the two release under one version and bump together (AGENTS.md): a hub-only bump would show "update agent" on every machine with no newer agent to install.
- `AgentPriority` (built in JC-98): the order of one machine's agents and the needs-you count, shared by the herd list and the tab badge. See "Seen and needs-you" under 2.6.
- Transcript model: `TranscriptMessage`, content blocks (`Text`, `Thinking`, `ToolUse`, `ToolResult`, `Image`), `TranscriptChunk { offset, messages }`.
- `Ask` (permission | question | unknown) with options as key sequences.
- Commands: the `Command` union (`Prompt { pane, text }`, `SendKeys { pane, keys }`) and `CommandReceipt` (`InputDelivered { pane, terminal, stateChangeSeq }`). Stop is `SendKeys` with `esc`, herdr's canonical name for Escape (`interrupt(pane)`). `hasMovedSince(receipt, row)` is the phone's "done": the pane shows a later `stateChangeSeq` than the one the agent read just before it sent, or a different terminal, since a sequence restarts at 0 in a new herdr lifetime and would otherwise read as "not yet" until it climbed past the old number.

### 2.2 `@crook/protocol`

Two `RpcGroup`s and the wire-level tagged errors. Nothing else.

- `AgentLink` — called **by the agent** on the hub (the agent dials out, so it's always the RPC client):
  - `Attach { hello }` (streaming) → `Stream<RoutedCommand>`: the hub pushes `{ id, key, command }` down this stream for as long as the connection lives. `hello` carries the agent's version as a plain string and an optional label, so a machine is never online without them. The hub reads the string as a `CrookVersion`; one it cannot read (a prerelease, say) becomes no version, which hides the update pill instead of failing the whole `Attach`.
  - `PublishState { state: MachineState, version }`
  - `CompleteCommand { id, result }`, where `result` is a `Result<CommandReceipt, AgentCommandFailure>`
  - `PublishTranscript { pane, chunk }` (only while some phone has that pane open)
- `ClientApi` — called **by the PWA** on the hub:
  - `WatchHerd` (streaming) → `Stream<HerdView>`
  - `WatchTranscript { pane, fromOffset }` (streaming) → `Stream<TranscriptChunk>`
  - `WatchScreen { pane }` (streaming) → `Stream<ScreenFrame>` (terminal fallback view)
  - `SendCommand { machine, key, command }` → `CommandReceipt`, failing with one tagged error per reason. One RPC carries every `Command` variant (`AnswerAsk`, `StartAgent`, `CreateWorktree`, `Rename`, `Close`, `Pin` join the union as their tickets land), so the hub routes them all the same way and a new variant changes no RPC.
  - `ForgetMachine { machine }`: offline machines only. `MarkSeen { machine, pane }` needs no idempotency key: marking the same state seen twice changes nothing.
  - Built so far: `WatchHerd`, `ForgetMachine`, `MarkSeen`, `SendCommand`. The refusals of `ForgetMachine` and `MarkSeen` are `MachineNotInHerd`, `MachineStillConnected`, `PaneNotInHerd` and `HubStorageFailed` (the hub's database refused the write, so nothing changed).
- Serialization: `RpcSerialization.layerNdjson` (sockets need framing).

Why "agent is always the client": Effect RPC servers listen; the agent can't (laptop behind NAT, no inbound). A server-streamed `Attach` gives the hub a push channel to the agent without reverse-RPC plumbing.

### 2.3 `@crook/herdr`

An Effect client for Herdr's socket API. Private like everything else, but kept free of crook concepts anyway: it's the cleanest seam for testing the agent.

- `HerdrClient` service: `request(method, params)` typed by a `HerdrMethod` value (params + result schema), `snapshot`, and `subscribe(subscriptions)`. `subscribe` is scoped and resolves only once Herdr acks with `subscription_started`, yielding a `Stream<HerdrEvent>`; that ordering is the recovery contract, so the caller can `subscribe` then `snapshot` and miss nothing.
- Methods are added by the ticket that first calls them; today `ping`, `session.snapshot`, `pane.process_info`, `agent.prompt` and `agent.send_keys`.
- Agent input (measured, herdr 0.9.5): `agent.prompt { target, text }` answers `agent_prompted` after 302–403 ms (6 runs: it pastes, then sends Enter); `agent.send_keys { target, keys }` answers `ok` in 0.7–2.1 ms. Both take a pane id as `target` and reject a pane that hosts no agent with `agent_not_found`, so herdr enforces the same rule as `CommandPolicy`. An unknown key name is `invalid_key`; an empty key list is accepted and does nothing. A prompt to an agent already at an approval dialog is `agent_blocked`, rejected before any input is sent (herdr's own docs).
- Error codes crook acts on get their own tagged error: `events_lost` → `HerdrEventsLost`, `pane_not_found` → `HerdrPaneNotFound` (from any request or the subscribe itself), `agent_not_found` → `HerdrAgentNotFound`. Every other code stays `HerdrRequestRejected`.
- `state_change_seq` decodes to herdr's schema default of 0 when absent, so it is a plain `Int`.
- Schemas are hand-written from `herdr api schema --json` and decode only the fields crook reads: excess keys are ignored, so `layouts`, `tokens`, `state_labels` and `scroll` are left out. Optional or nullable fields decode to `Option`. Field names stay snake_case, as on the wire; mapping to `@crook/domain` happens in the agent, not here.
- Transport: NDJSON over a Unix socket via `@effect/platform-bun`'s `BunSocket.makeNet({ path })`. **One connection per request**: Herdr answers one request line and closes the connection, a second request on it gets nothing (measured, herdr 0.9.1). A subscription connection stays open. `events_lost` is expected as an error response carrying the subscribe request's id, then a close; that shape comes from herdr's schema and was never provoked (spike S6), so nothing relies on it beyond resubscribing.
- What ends a subscription (spike S6, herdr 0.9.5): a graceful stop, a `kill -9` and a live handoff all look the same, a clean EOF with no error line (`HerdrConnectionClosed`), so the subscriber cannot tell them apart. Reconnecting then fails with `ENOENT` after a stop (socket removed), `ECONNREFUSED` after a crash (socket file left behind; a regular file at the path behaves the same, which is how the test stands it in), and `ENOENT` for under 65 ms during a handoff; all three are `HerdrUnreachable`. A subscriber that stops reading is cut off with the same plain EOF once its socket buffer fills, not with `events_lost`. Events carry no sequence number and no heartbeat is sent, so nothing can be resumed: every reconnect resyncs from `session.snapshot`.
- Across a restart or a handoff, workspace, tab and pane ids survive and are never reused; `terminal_id` changes, `revision`, `state_change_seq` and `completion_seq` restart. A stop or crash kills every pane process, so restored panes come back as shells with no agents; a handoff keeps the processes, and each agent goes through about 3 s of not being known until herdr re-detects it, announced by a `pane.agent_status_changed` and no `pane_agent_detected`, with `completion_seq` lost. The spike's fake Claude read `unknown`/0 then `idle`/1; a real Claude reads `idle`/0, `unknown`/1, then its status at 2 (see 2.1).
- Close events are incomplete (spike S6): the shell exiting in a tab's only pane sends only `pane_exited`, and the tab is gone; `tab close` sends `tab_closed` and no `pane_closed` for its panes. The agent never cascades events itself: every event is a trigger to re-read the snapshot.
- Every subscribed event shape herdr 0.9.5 sent during the spike is kept as a fixture and decoded by the test suite.
- Event wire shape (measured): a lifecycle event is `{"event":"pane_closed","data":{"type":"pane_closed",…}}` — snake_case, even though it is subscribed as `pane.closed`. The pane-scoped `pane.agent_status_changed` keeps the dotted name and carries no `data.type`.
- **Status changes need a pane-scoped subscription** (measured): `pane.agent_status_changed` requires a `pane_id`, and a lifecycle-only subscriber sees a `pane_updated` on the first detection of an agent but nothing for later working → blocked → idle moves. The agent subscribes per agent pane and resubscribes when the pane set changes (subscriptions are fixed per connection). An unknown `pane_id` rejects the whole subscribe with `pane_not_found`.
- Layers: `HerdrClient.layer` (socket path from `HERDR_SOCKET_PATH`, else `$HOME/.config/herdr/herdr.sock`), `HerdrClient.layerAt(path)`, `HerdrClient.layerTest({ responses, events, sent })`. Scripted responses are encoded lines run through the live decoder; events come from a `Queue` whose failure becomes the stream's; the optional `sent` queue receives every request line as it would go over the socket, so a test can assert what was sent and how often.

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

- The layer reads herdr once before it hands out the service, so the `SubscriptionRef` always holds a real `MachineState`; version 0 is that first read. A herdr that is down holds the layer up until it answers. That first read retries on the same backoff as the subscription.
- One loop, forked into the layer's scope: subscribe (lifecycle kinds that change `MachineState` plus one `pane.agent_status_changed` per agent pane), re-read once `subscription_started` arrives, then re-read on every event. A sliding buffer of one sits in front of the re-read, so a burst of events arriving during a read costs one more read, not one per event.
- A re-read that changes nothing keeps the version; a change bumps it by one. `statusChangedAt` is stamped by the agent at the read that first sees a status, since herdr carries no timestamp. A status herdr re-detects unchanged after a handoff keeps the stamp it had before (`beforeHandoff`), so a blocked agent that waited an hour still sorts as waiting an hour, and so does a `done` agent whose completion the handoff lost; the `unknown` row in between gets its own stamp.
- When a re-read shows a different set of agent panes, the subscription is closed and opened again with the new set. That is not a lost connection: the re-read after the new subscribe covers the gap.
- `pane_not_found` (a pane closed between the read and the subscribe) re-reads first so the next subscribe names live panes only. It is the one failure that is not a lost connection: herdr answered. A re-read that still lists the same agent panes would send the same rejected subscribe again, so that one goes down the lost path below and waits out the backoff instead (spike S6, rule 4: never retry the same pane set blindly).
- Every other end is one path, "herdr lost, state unknown" (spike S6: stop, crash, handoff and a slow reader all end as the same EOF, and `events_lost` joins them): resubscribe, re-read, replace. Herdr's sequences belong to one server lifetime, so nothing is resumed or compared across the gap.
- Backoff (built in JC-81): exponential from `HERDR_RECONNECT_BASE`, doubling, capped at `RECONNECT_CAP`, retried forever. The schedule and the health rule below are the agent's one reconnect policy, shared with HubLink; only the base differs. The base is 100 ms: a herdr server cold-starts in 101–114 ms (measured), and the socket of a live handoff was missing for under 65 ms (one handoff probed with pings 21 ms apart; a reconnect 250 ms after the EOF succeeded on all 3 handoffs). The cap reuses `AGENT_PING_INTERVAL` (5 s): a herdr that comes back is noticed no later than a hub that comes back. No jitter: jitter spreads many clients hitting one server, and each herdr server has exactly one agent.
- A connection is healthy once its first re-read after `subscription_started` succeeded and it then stayed up for one `RECONNECT_CAP`, the rule HubLink uses. A herdr that serves one snapshot and drops again (a crash loop under a supervisor) therefore keeps growing the backoff to the cap instead of being retried every 100 ms, and each cycle's lost and resync states reach the hub at most once per cap. The period is the cap itself, not a measured number: it is the longest the agent ever waits between attempts. When a healthy connection ends, the agent waits one base delay and reconnects with the backoff started over, so a handoff costs one 100 ms wait and nothing else. The wait comes first, not an immediate retry, because an immediate retry lands inside the handoff's missing-socket window. A resubscribe for a new pane set, or after an explained `pane_not_found`, is the same connection: it keeps the health it had, so a handoff right after a Claude starts or exits is still a healthy one.
- Losing herdr keeps the cached state and marks it, rather than dropping it: when a connection ends or an attempt fails before the connection was healthy, the state gets `herdr.lostAt` (once, with the version bumped, so the hub hears it). A handoff of a healthy connection never shows it, and one within a cap of connecting does, at once; a stop or crash shows it one base delay after the EOF. The first successful re-read after a loss clears it and carries a new `herdr.connection`, even when herdr shows exactly the herd it showed before, so the hub can tell a resync from a change. The id is a random safe integer from effect's `Random` (Math.random by default, so it differs across agent restarts); only inequality with the previous state's id is ever read.
- The snapshot's `panes` become `MachineState.panes`, and each agent row carries its `terminal_id`. Both feed the phone and the hub, never the agent's own logic.
- `ClaudeSessions` resolves a pane to its Claude session per S4: `agent_session` of kind `id` first, then the pid file (`pane.process_info` → the `claude` foreground process → its `CLAUDE_CONFIG_DIR` or `$HOME/.claude` from `/proc/<pid>/environ` → `sessions/<pid>.json`, kept only when its `procStart` matches `/proc/<pid>/stat` field 22). A missing file or closed pane is `None`. An unreadable or reshaped file, or a rejected or malformed `pane.process_info`, is logged as a warning and that one pane goes without a session; only transport failures abort the whole read. Herdr failures log at warning, except `HerdrUnreachable`, which repeats every interval while herdr is down and logs at debug. On the laptop 9 of 11 live agents resolve only through the pid file.
- The machine id comes from `CROOK_MACHINE_ID`.
- `MachineState` carries herdr's server version from `session.snapshot`, not the hello: herdr can be updated or restarted under a running agent whose hub link never drops, and a version in the hello would go stale until the next reconnect. A herdr update bumps the state version like any other change.
- Branch (built in JC-98): herdr records carry the pane's `cwd` and `foreground_cwd` but no branch, and `worktree.list` reports branches per repository, not per pane. `GitBranches` finds the `.git` entry above the agent's cwd (a directory, or a linked worktree's `gitdir:` file), caches a found one per cwd (`effect/Cache`, so panes sharing a cwd walk the folders once), and reads `HEAD` on every re-read, so a checkout shows up with the next herdr event. A miss is not cached: a folder that becomes a repository gets its branch at the next re-read, for a few `stat`s per re-read on panes outside git. A found directory whose `HEAD` has gone (a linked worktree removed and re-added under new metadata) is looked up once more on that read. A found directory that still has a `HEAD` is kept for the agent's lifetime: a folder resolved to an ancestor repository (a dotfiles repo in `$HOME`) that later gets its own `git init` or clone keeps showing the ancestor's branch until the agent restarts, a known limitation. A detached `HEAD`, a folder outside git and a pane without a cwd are `None`. An unreadable `.git` entry, `gitdir:` file or `HEAD` is logged as a warning and that pane goes without a branch, like an unreadable Claude session file.

HubLink (built in JC-89):

- One session per connection: build the RPC client, hold `Attach` open, and publish `MachineStateSync.changes` through a sliding buffer of one. `changes` replays the current value, so every new connection republishes the current state first, and a slow hub only ever gets the newest version.
- The session ends when `Attach` ends (`HubAttachEnded`), a call fails with `RpcClientError` (drop, refused or timed-out connect, ping timeout), the hub rejects a publish (`MachineIdMismatch`), or a call dies (`HubCallDefected`: the hub couldn't decode the payload, or its handler crashed). Defects are turned into that tagged error at the boundary, because `retry` and `forever` let a defect through and it would stop HubLink for good without a log line. Every end logs at warning and reconnects.
- A drop fails every in-flight call, because the socket protocol broadcasts the error before it consults its own retry, so `Attach` fails and the session ends. The protocol's retry is switched off (`retryPolicy: Schedule.recurs(0)`) so nothing redials inside a closing session; HubLink's schedule is the only one: exponential from `HUB_RECONNECT_BASE`, capped at `AGENT_PING_INTERVAL`.
- A connection is healthy once the hub has accepted a publish and the link stayed up for a whole ping interval after it. When a healthy connection drops, HubLink reconnects at once and the backoff starts over. The clock starts at the first accepted publish, not at connect: a hub that takes the TCP connection but never finishes the upgrade fails each attempt after the socket's 10 s open timeout, and timing from connect would call that healthy and never back off (measured).
- `HUB_RECONNECT_BASE` is 77 ms, the slowest of 9 warm HTTPS requests from the laptop to an exe.dev VM's proxy (52–77 ms; the cold first one took 626 ms). `AGENT_PING_INTERVAL` (in `@crook/protocol`, since the hub times agents out on it too) is effect's RpcClient default of 5 s, written out because the cap, the healthy period and the hub's silence timeout reuse it. S1 measured no proxy idle timeout within 900 s, so the ping exists to detect a dead hub, not to keep the proxy open.
- Config: `CROOK_HUB_URL` (the `ws`/`wss` URL of the hub's `/rpc/agent`) and `CROOK_HUB_TOKEN` (`Config.Redacted`), sent as `X-Exedev-Authorization: Bearer <token>`. `CROOK_MACHINE_LABEL` is optional; the hub labels a machine by its id without it.
- Every `Attach` sends the hello: the agent's own `package.json` version and the label. The socket's open timeout is written out as `AGENT_SOCKET_OPEN_TIMEOUT` (effect's default of 10 s), because the hub's reconnect grace is built on it.

Commands (built in JC-103):

- `HubLink` runs the commands `Attach` delivers one at a time, in arrival order, and answers each with `CompleteCommand`. Input to one pane must keep its order (Stop, then a new prompt), and the slowest command measured is one prompt (403 ms), so nothing is gained by running them side by side. A `CompleteCommand` that fails ends the session like any other call.
- `CommandPolicy` admits input only to a pane that is in the current `MachineState.agents`, i.e. a pane herdr recognizes as hosting an agent, and returns that row. The agent reads its own state, never anything the hub claims. `CommandExecutor.layer` provides it, so the executor needs only `MachineStateSync` and `HerdrClient`.
- `CommandExecutor` remembers outcomes in an effect `Cache` keyed by `{ key, command }`, with effect's own structural equality: a retry is the same key carrying the same command. It remembers exactly the outcomes after which herdr may have acted, and forgets the rest:
  - remembered: `InputDelivered`, and `CommandDeliveryUnknown` (herdr closed the connection, answered something unreadable, or did not answer within `HERDR_DELIVERY_TIMEOUT` after the request went out). A retry replays them and never sends twice.
  - forgotten: `PaneNotAgent` (policy, or herdr's `pane_not_found` or `agent_not_found`: the agent exited between the state read and the send), `HerdrRefusedCommand` (any other herdr rejection, code and detail passed through), `HerdrUnavailable` (socket would not open). Nothing was sent, so a retry runs again.
- `COMMAND_REPLAY_CAPACITY` is 1024 keys, effect's `PersistedCache` default in-memory capacity, which is the same job: remember request outcomes by key in memory. When full the oldest key goes first. Nothing is persisted, so an agent restart forgets every key.
- `execute` is uninterruptible. A pending `Cache` lookup whose every caller is interrupted is itself interrupted and dropped from the cache (measured), so a session closing mid-prompt would otherwise let the retry send the prompt again.
- Because nothing can interrupt `execute`, the herdr delivery under it carries its own bound: `HERDR_DELIVERY_TIMEOUT`, 10 times the slowest measured prompt (403 ms), the same headroom `COMMAND_TIMEOUT` has. Without it a herdr that accepts the connection and never answers would hold the session forever: no reconnect, no state publishing, every later command stuck behind it. The bound plus the slowest measured warm round trip (77 ms) stays under `COMMAND_TIMEOUT`, so the hub hears `CommandDeliveryUnknown` before it gives up. An effect timeout still interrupts its losing side inside an uninterruptible region, since `raceFirst` forks both sides interruptible (read in its source, and probed).
- Herdr's `HerdrRequestInvalid` (crook built params herdr's schema cannot encode) is a defect: every `Command` that decodes encodes.

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
- Memory stays authoritative while the hub runs; the database is what survives a restart. A write the agent link causes (attach, drop, publish) that fails is logged at error and the hub carries on from memory: failing it would drop every machine over a full disk. Each write of one link event is tried on its own: a publish whose machine save fails still deletes the seen marks it dropped, and a failed delete is logged too, leaving those marks in the table for a restart to load again. A write the phone asks for (forget, mark seen) runs before memory changes, and a failure returns `HubStorageFailed` with nothing changed.

Machine registry (built in JC-97):

- `machines` keeps id, label, last seen, forgotten, and the last agent and herdr versions, so after a hub restart every known machine is listed offline with its last seen and versions until its agent reconnects. The last state is not stored: an offline machine's agents are unknown. Last seen is written at each link event (attach, publish, drop), not while a connected machine stays quiet, so after an unclean hub stop (crash, OOM, reboot) a machine that never returns shows the time of its last link event, which can be older than its last connection.
- The label is the hello's label, else the id. It is rewritten on every attach.
- Connection is `online`, `reconnecting` or `offline`, and `connectionChangedAt` is when the machine last came online or last dropped ("Online for", "Reconnecting for"). A dropped machine is `reconnecting` for `RECONNECT_GRACE`, then `offline`. The grace is `AGENT_SOCKET_OPEN_TIMEOUT` plus `AGENT_PING_INTERVAL` (15 s): one dial can hang for the full open timeout against a hub that takes the TCP connection but never upgrades (measured, see HubLink), and HubLink never waits longer than one ping interval before the next dial. It is built from those two parts, not measured end to end against the exe.dev proxy. A machine loaded at startup is `offline`, with `connectionChangedAt` equal to its last seen.
- `ForgetMachine` hides an offline machine (online and reconnecting ones are refused); the row stays with `forgotten` set. The next `Attach` clears it, so a forgotten machine returns on its own.

Seen and needs-you (built in JC-98):

- The hub keeps, per machine and pane, the `terminal` and `state_change_seq` the user last saw. A pane is seen when both equal the pane's current ones. Equality, not "at least": herdr's sequence can restart lower, and a stale higher mark must not hide a new state.
- A mark is a `seenMarkOf(row)` (see 2.1): through a handoff the row keeps the identity of the state it continues, so a done agent the user had opened stays seen when herdr re-detects it, and one opened during the re-detection stays seen after it. `MarkSeen` records that identity, and the comparisons below are against it.
- A mark lives only while it equals the pane's current sequence: a publish that shows any other sequence for the pane, or no longer shows the pane, drops it, in memory and in the `seen` table, so a reused pane id starts unseen. Every kept mark therefore equals its pane's current sequence, and seen is just having a mark. Keeping a mark the pane has moved past would let a restarted sequence (pane ids such as `w1:p1` come back after a herdr restart, counting from 0) climb back to the old number and show a new state seen that nobody opened. The terminal closes the case equality alone left open (built in JC-81): herdr restarting while the hub hears nothing from that machine (agent disconnected, or the hub down), with the pane's first published sequence landing exactly on the old mark. Spike S6 measured on herdr 0.9.5 that `terminal_id` changes on every stop, crash and handoff while pane ids persist, so a mark from an earlier herdr lifetime never matches. A resync over the same herdr server keeps both, so it keeps the mark.
- Migration 3 recreates `seen` with a `terminal` column and drops the marks recorded without one: they cannot be checked against a lifetime. The cost is one re-open of each done agent after that deploy.
- For JC-107, the notifier diffs consecutive publishes of one machine, and the domain carries what it needs to suppress the diffs that are not transitions; the diff itself is built with the notifier. A pair with `isResync(previous, next)`, or a `next` that `isHerdrLost`, is no transition at all: a resync diff spans a gap where herdr was not followed (after a restart every agent is gone, after a handoff each one reads `unknown` before it is re-detected), and diffing it against the cached state would fire "done" or "closed" for nothing that happened. A row that reads `unknown` is not yet known: it neither raises a notification nor withdraws one. The transition is judged when herdr re-detects the agent, against `beforeHandoff.status` when the row carries one, so a blocked agent re-detected blocked does not ask twice while one re-detected `done` after being `working` still counts. A `done` agent whose completion the handoff lost is published `done` again (see 2.1), so it neither withdraws a "Finished" nobody read nor leaves needs-you. A row herdr never re-detects therefore changes nothing until herdr drops it from `agents`, which is a transition of its own ("Claude exited" or "This pane closed", by `panePresence`). The hub's first publish after its own restart has no previous state, so there is nothing to diff.
- `MarkSeen` records the pane's current sequence in the hub's last state for that machine; the phone sends it when a chat opens and again while a chat stays open on an agent that changes. Herdr focus is never called (D12): the hub has no herdr connection at all.
- Seen survives a hub restart (`seen` table). Lost marks would bring every opened done agent back as "needs you" after each deploy, inflate the tab badge, and (JC-107) notify again for what was already read. Marks are few and the table already exists, so the cost is one upsert per chat open.
- `HerdMachine.seen` lists the panes seen at their current sequence. `AgentPriority.orderAgents` sorts a machine's agents: blocked (longest waiting first), done and unseen (newest first), working, then idle and seen done, then unknown, keeping herdr's order inside the last three. Ties use `statusChangedAt`. `needsYouCount` counts blocked plus unseen done and is zero for an offline machine; `herdNeedsYouCount` sums the machines. Pins (JC-112) become one more tier in front.

CommandRouter (built in JC-103):

- Each `Attach` registers an outbox with the router for as long as it lives, alongside `Herd.hold`. A command goes to the newest `Attach` of its machine, so while a reconnect overlaps a dying connection the command reaches the live one. No `Attach` at all is `MachineOffline`, before anything is sent, and so is an outbox that shut down between the lookup and the offer. The phone sends again once the machine shows online; nothing is queued for it.
- Herd's attachment count and the router's outboxes are two registries of one fact, acquired side by side in the same `Attach` merge, so for an instant after a connect or before a disconnect the herd may show a machine online that the router answers `MachineOffline` for.
- `send` gives the command the next `CommandId` (a counter: ids only have to be unique among the commands waiting in this process), parks a `Deferred` under it and awaits `CompleteCommand` for `COMMAND_TIMEOUT`, then fails with `CommandTimedOut`. `COMMAND_TIMEOUT` lives in `@crook/protocol` beside `AGENT_PING_INTERVAL`, because the agent's delivery bound is set against it. It is `AGENT_PING_INTERVAL` (5 s), the link's own heartbeat: over 10 times the slowest measured prompt (403 ms) plus the slowest measured warm round trip to the proxy (77 ms).
- `complete` resolves the `Deferred` only if the answering connection is the machine the command was routed to; a late answer (after the timeout) or one from another machine is dropped with a debug log.
- A timed-out command may still run. The phone retries with the same key, and the agent answers with the first outcome instead of running it twice. Nothing tells the agent the hub gave up, so a command queued behind a slow one still runs late: a late `esc` can interrupt a turn started after it. Commands carry no deadline today.
- Commands are not persisted: a hub restart loses those in flight, and the phone sees them time out.

### 2.7 `@crook/web`

```
brand/                    outlines the wordmark from the font into public/wordmark.svg; icons and startup images derive from it at build
src/
  main.tsx                React root, RegistryProvider
  routes/                 TanStack Router, file-based (generated route tree): herd, machine, pane chat, new agent, settings
  navigation/             the shell: tab bar, root-list screens, pushed screens, edge-swipe back, focus handoff
  install/                install screen, shown outside a Home Screen app
  motion/                 springs, Mischief's motion tokens read from CSS, reduced-motion-aware transform strings
  csp/                    the Content-Security-Policy the hub sends
  rpc/                    RpcClient over WebSocket (browser socket layer), runtime
  atoms/                  herd, connection, transcript (family by pane), commands
  components/ui/          Mischief UI, copied in with the shadcn CLI (we own this code)
  components/             app components built from ui/ (StatusDot, press and long-press, swipe rows, AskCard, …)
  router/                 the router, with its not-found (home) and error fallbacks
  highlight/              shiki setup (JS regex engine, fine-grained langs, hast → JSX)
  sw/                     service worker: app shell cache only
```

- **A pushed screen is a child route** marked `staticData.pushed`, so its parent root list stays rendered (and inert) beneath it, and a deep link still has a parent to go back to.
- **The hub sends the CSP as a header** on every response, never a meta tag: a meta can't carry `frame-ancestors`, and Vite's dev server needs inline scripts. The policy is decided once, as `CONTENT_SECURITY_POLICY` in `@crook/web/csp/ContentSecurityPolicy`: everything `'self'`, with `default-src`, `base-uri`, `form-action` and `frame-ancestors` at `'none'`. The hub imports that leaf (JC-115) rather than restating it. `vite preview` sends the same header, so a production build is checked under it locally.
- **A push hands over its opener.** The caller passes `openedFrom(element)` as the navigation's history state, with the element that was tapped (`Pressable` and `SwipeRow` give it to `onTap`). The pushed screen reads it once, when it mounts, and returns focus there when it unmounts, falling back to whatever had focus, then to the active tab. Document focus alone can't name the opener on an iPhone, where a tap doesn't focus a button. Openers are held by weak reference and never dropped, so a screen rebuilt by Back or Forward still finds its own, and a removed element can still be collected. One element always gets the same key, and every key carries the page load's `performance.timeOrigin`, because history state outlives a reload and a counter does not. So a second tap on a row whose push is still loading asks for the location the router is already on, and the router's `navigate` drops it: pushes go through `navigate` (`Link`, `useNavigate`), never `router.history.push`, which always pushes.
- **Every pushed entry gets its own screen.** The router remounts a route whenever its params change (`defaultRemountDeps`), so a chat opened from a chat slides in, takes focus and keeps its own opener. A screen slides in only when it arrives by a push (a higher history index than the resolved location's), so one rebuilt by Back or swapped in by a replace appears in place. Two entries with the same path share one screen: when Back lands on the earlier one, the screen comes back into use rather than staying inert. Back on a screen while a navigation is still pending skips the slide and leaves at once, which cancels a push that has not landed yet.
- **The service worker never calls `skipWaiting`.** A new shell takes over once every crook window has closed, so a running page never loads chunks from a build it didn't come from.
- **The service worker answers every same-origin navigation with the cached shell.** So log in and log out can't be a same-origin navigation to a proxy path: once the shell is cached, that navigation never reaches the exe.dev proxy. They go cross-origin to exe.dev, or to a path added to the worker's `NavigationRoute` denylist once the proxy's paths are known. This binds the tickets that build login and logout, and the hub serving the build (JC-115).
- Tests run on vitest with happy-dom for components and node for pure modules.

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
- The ack is `SendCommand`'s `CommandReceipt`. For input it carries the pane's `stateChangeSeq` as the agent read it just before sending, and "done" is `hasMovedSince(receipt, row)` on the row `WatchHerd` delivers. That read is the agent's cached `MachineState`, which follows herdr events asynchronously: a status change already in flight when the input goes out moves the row past the receipt for a reason of its own, and "done" shows early. The pending action (sent, acked, done, failed) lives in a PWA atom keyed by its `IdempotencyKey`; the hub and the agent keep nothing per action beyond the agent's replay cache.

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
