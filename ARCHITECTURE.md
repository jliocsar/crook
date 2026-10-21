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

- Branded ids: `MachineId`, `WorkspaceId`, `TabId`, `PaneId` (herdr's `w1:p1`), `GlobalPaneId` (`<machine>/<pane>`), `TerminalId` (herdr's `terminal_id`), `HerdrConnectionId` (see `HerdrLink`), `ClaudeSessionId`, `SubagentId` (the hex in `agent-<id>.jsonl`), `IdempotencyKey`, `TranscriptOffset`. All of them live together in `Ids`.
- Entities: `Machine`, `Workspace`, `Tab`, `Pane`, `AgentRow`, `StatusBeforeHandoff`, `AgentStatus` (`idle|working|blocked|done|unknown`), `HerdrLink`, `MachineState` (one machine's whole herd), `HerdView` (all machines + connectivity).
- `MachineState.panes` lists every pane herdr shows, agent or not, so `panePresence(state, pane)` tells `agent` (in `agents`), `noAgent` (the pane is still there: Claude exited, or it never ran one) and `gone` (the pane closed). That is the chat's end card: "Claude exited" against "This pane closed" (JC-101). An agent herdr has not re-detected yet stays `unknown`, never a status carried over from before.
- `AgentRow.terminal` is herdr's `terminal_id`. It changes on every herdr server lifetime (stop, crash, handoff; spike S6, measured on herdr 0.9.5 only) while the pane id stays, so it is what scopes a pane's `stateChangeSeq`: two sequences are comparable only under the same terminal.
- `AgentRow.beforeHandoff` (`StatusBeforeHandoff`) holds the status, `statusChangedAt`, `terminal` and `stateChangeSeq` a pane had under its previous terminal. It is set when the same agent shows up under a new terminal with a known status before, and kept while the row reads `unknown` or the status it had before; the first other status drops it. It is how a handoff's re-detection, which arrives on the same herdr connection about 3 s after the resync (spike S6), is told from a real change. A pane that was already `unknown` before the handoff gets none.
- What a real Claude reads through a handoff (measured on herdr 0.9.5, 6 handoffs of one `claude` in a probe session): first `idle` at sequence 0 for about 300 ms, then `unknown` at sequence 1 for 3.2–3.4 s, then the re-detected status at sequence 2. The 4 handoffs polled every 40–150 ms all showed the `idle`/0 read; the 2 followed through the agent's own sync first read `unknown`/1. `agent` stays `claude` and `agent_session` keeps the same id on every read, the `claude` pid is the same, and its pid file resolves the same session. A `working` agent came back `working`, an `idle` one `idle`, and a `done` one (finished in a tab nobody was viewing) came back `idle` all 3 times: the handoff loses the completion. A reconnect can therefore land on either of the first two reads. Blocked through a handoff was not measured.
- The agent therefore reads any status at sequence 0 as `unknown`, whether or not it listed the agent before: herdr bumps the sequence on every detected change, so sequence 0 is the value a lifetime starts with, before anything was detected. A freshly launched `claude` reads `unknown` and then `idle` at sequence 1 (measured, same probe), so this only ever hides the handoff's `idle`/0 placeholder.
- What marks `done` seen in herdr (measured on herdr 0.9.5, one `claude` in a probe session, no TUI attached): its tab becoming the focused tab, whichever pane of the tab has focus. Focusing the tab while another pane of it was focused, and focusing the workspace whose active tab held it, both turned `done` into `idle`; an agent that finished while its tab was focused, even with another pane of it focused, went straight to `idle`. That `done` to `idle` left `state_change_seq` and `completion_seq` unchanged. A tab's `focused` is server-wide: one tab across all workspaces reads `true`. Every focus command emitted `workspace_focused`, `tab_focused` and `pane_focused` together, so the agent subscribes to `tab.focused` to re-read on one.
- A row that carries `done` from before the handoff and is re-detected `idle` stays `done` (with the stamp and seen mark from before) while its tab is not the focused one: the handoff dropped the completion, nothing marked it seen. Once a read shows its tab focused, it is published `idle` and drops `beforeHandoff`, since that is the event that would have turned herdr's own `done` into `idle`.
- A row carries anything over from the previous state (`beforeHandoff`, or the `statusChangedAt` of an unchanged status) only from the same agent: the same terminal, or a new terminal whose Claude session resolves to the one the previous row had. A handoff keeps the pane's processes and herdr keeps the reported session (measured above), so its Claude resolves to the same session; a stop or crash restores the panes as fresh shells, so a Claude started in one afterwards is a new process and starts from nothing, even when the agent's cached rows from before the restart are still there. An agent whose session does not resolve on both reads carries nothing over a handoff, and its re-detection reads as a change.
- `seenMarkOf(row)` is the pane's seen identity: the `terminal` and `stateChangeSeq` of `beforeHandoff` while the row carries one, else the row's own. A state that continues through a handoff keeps the identity it had before it.
- `MachineState.herdr` (`HerdrLink`) carries the agent's side of the herdr connection: a `connection` id the agent mints whenever it re-reads after losing herdr, and `lostAt`, set while the agent cannot reach herdr and the rest of the state is the last one it read. `isResync(previous, next)` holds when two states were read over different connections, `isHerdrLost(state)` while `lostAt` is set.
- `CrookVersion`: `major.minor.patch`, compared as numbers, so the PWA can tell an agent that is behind the hub (`isBehind`). Each app reads its own `package.json` version, and the two release under one version and bump together (AGENTS.md): a hub-only bump would show "update agent" on every machine with no newer agent to install.
- `Notifications` (built in JC-107): the four notification switches (`NotificationEvent`, `NotificationPrefs`, all on by default) and `NotificationSettings`, which adds whether the hub can deliver (`HarkDelivery`). Shared because the hub stores them and the phone's Settings screen shows them. `agentTitleOrPane` moved to `AgentRow` for the same reason: the herd card and the notification title name an agent the same way.
- `AgentPriority` (built in JC-98): the order of one machine's agents and the needs-you count, shared by the herd list and the tab badge. See "Seen and needs-you" under 2.6.
- Transcript model (built in JC-99), in `TranscriptMessage` and `Transcript`:
  - Messages: `User` (with `isMeta`, `origin`, `queued`), `Assistant` (API message id, model, stop reason, `isApiError`), `System`, plus `UnrecognizedEntry { entryType }` for a kind crook does not know and `Malformed { byteLength }` for bytes that are not an entry. Each carries the byte `offset` its line starts at, so the phone can key rows on it.
  - Blocks: `Text`, `Thinking`, `ToolUse` (input as JSON), `Image { mediaType, data }` (`mediaType` is `image/png` or `image/jpeg`, the only two spike 82 found), `ToolReference`, `ToolResult` (content blocks, plus the `PatchHunk`s of an edit and a `SubagentLaunch` when the result names one), and the user and system notes Claude writes as text or entries: `CompactSummary`, `TaskNotification`, `LocalCommand`, `LocalCommandOutput`, `Interruption`, `CompactBoundary` (with an optional `manual` or `auto` trigger, the two values spike 82 measured), `TurnDuration`, `Notice`. `Unrecognized { kind }` stands for a block kind crook does not know, and for an image of any other media type, so nothing unmeasured reaches an image URL.
  - `Subagent` (id, type, description, model, tool use id, parent, depth, background, finished, stopped by user). The "N running" count arrives with the chat that shows it (JC-101).
  - Stream values: `TranscriptPosition { session, offset }`, `TranscriptSource` (`PaneTranscript { pane }` or `SubagentTranscript { session, subagent }`), and `TranscriptEvent`: `TranscriptOpened { session }`, `TranscriptChunk { session, offset, nextOffset, messages }`, `SubagentsChanged { session, subagents }`. `positionAfter`, `continuesFrom` and `remainderAfter` are the one definition of where a stream stands, shared by agent, hub and phone. `remainderAfter(position, event)` is what of an event the holder of `position` does not have yet: a chunk that overlaps it is cut to the lines after it, an `Opened` for the session it is in is nothing.
- `Ask` (permission | question | unknown) with options as key sequences.
- Commands: the `Command` union (`Prompt { pane, text }`, `SendKeys { pane, keys }`, `RenameAgent { pane, label }`, `ClosePane { pane, confirmed }`) and `CommandReceipt` (`InputDelivered { pane, terminal, stateChangeSeq }`, `PaneRenamed { pane, label }`, `PaneClosed { pane }`). Stop is `SendKeys` with `esc`, herdr's canonical name for Escape (`interrupt(pane)`). `hasMovedSince(receipt, row)` is the phone's "done" for input: the pane shows a later `stateChangeSeq` than the one the agent read just before it sent, or a different terminal, since a sequence restarts at 0 in a new herdr lifetime and would otherwise read as "not yet" until it climbed past the old number. A rename is done once the row carries the receipt's label, a close once the pane is gone from the agents.
- `AgentRow.label` is the name the pane was given in herdr (`pane.rename`, by crook, by hand or by a labelling plugin), trimmed, and `None` when it has none or only whitespace; `title` stays Claude's own title. `RenameAgent.label` (`PaneLabel`) must be trimmed, non-empty and free of control characters, since herdr shows it in its own TUI: the phone turns an all-blank input into `None`, which clears the name. `AgentRow.createdByCrook` says whether the pane is in the agent's `CreatedPanes`, so the phone can word a close as the confirmation up front and send `confirmed: true` from the hold, rather than learning it from a refused round trip. `agentTitle(row)` is what a card and a chat header show: the label, else the title. `HerdMachine.pinned` lists the machine's pinned panes that are in its last state.
- `Audit` (built in JC-106): the pure half of the audit log, shared by agent and hub. `commandAudit(command)` names the operation and lists its arguments (written out per variant with `Match.tagsExhaustive`, so a new command fails to compile until it is audited); `applyAuditPolicy` redacts the named arguments whole and cuts each other argument to the limit (an array of texts shares one limit, and the last text kept carries the mark), counting characters rather than UTF-16 units, marking a cut with `…`; `auditExit(exit)` turns an outcome into `succeeded`, `failed` with the error's `name` (a tagged error's `name` is its tag, measured) or `Defect`, or `interrupted`.

### 2.2 `@crook/protocol`

Two `RpcGroup`s and the wire-level tagged errors. Nothing else.

- `AgentLink` — called **by the agent** on the hub (the agent dials out, so it's always the RPC client):
  - `Attach { hello }` (streaming) → `Stream<RoutedCommand>`: the hub pushes `{ id, key, command }` down this stream for as long as the connection lives. `hello` carries the agent's version as a plain string and an optional label, so a machine is never online without them. The hub reads the string as a `CrookVersion`; one it cannot read (a prerelease, say) becomes no version, which hides the update pill instead of failing the whole `Attach`.
  - `PublishState { state: MachineState, version }`
  - `CompleteCommand { id, result }`, where `result` is a `Result<CommandReceipt, AgentCommandFailure>`
  - `TranscriptDemands` (streaming) → `Stream<TranscriptDemand>`: the whole set of transcript watches the hub wants from this machine, each `{ id, source, from }`, re-sent whenever a watch starts or ends. Like `Attach`, it is the hub's push channel, kept apart from `Attach` so commands and transcripts do not share a stream.
  - `PublishTranscript { watch, update }` → `void`, failing with `TranscriptOutOfStep { watch, expected }` when the update does not continue where that watch stands. `update` is a `TranscriptEvent` or `TranscriptWatchFailed { failure }`.
- `ClientApi` — called **by the PWA** on the hub:
  - `WatchHerd` (streaming) → `Stream<HerdView>`
  - `WatchTranscript { machine, source, from }` (streaming) → `Stream<TranscriptEvent>`, failing with `MachineNotInHerd`, `PaneNotInHerd`, `TranscriptReadFailed`, `TranscriptResumeRejected` or `TranscriptSessionRejected`. `from` is the `{ session, nextOffset }` of the last chunk the phone holds, or null for the start.
  - `WatchScreen { pane }` (streaming) → `Stream<ScreenFrame>` (terminal fallback view)
  - `SendCommand { machine, key, command }` → `CommandReceipt`, failing with one tagged error per reason. One RPC carries every `Command` variant (`RenameAgent` and `ClosePane` joined in JC-112; `AnswerAsk`, `StartAgent` and `CreateWorktree` join as their tickets land; pinning is not a command but the hub-only `SetPinned` below, since it never reaches an agent), so the hub routes them all the same way and a new variant changes no RPC.
  - `ForgetMachine { machine }`: offline machines only. `MarkSeen { machine, pane }` needs no idempotency key: marking the same state seen twice changes nothing.
  - `SetPinned { machine, pane, pinned }` (JC-112): one RPC for pin and unpin, idempotent like `MarkSeen`, so it needs no key. Pinning wants the pane among the agents of the machine's last state; unpinning does not, so a stale pin can always be dropped.
  - `WatchNotificationSettings` (streaming) → `Stream<NotificationSettings>`: the four switches (`approvals`, `questions`, `finished`, `liveActivity`) and whether the hub can deliver at all (`delivery`: `ready`, or `noToken` while `CROOK_HUB_HARK_TOKEN` is unset). `SetNotificationPref { event, enabled }` fails only with `HubStorageFailed`. `SendTestNotification` fails with `HarkNotConfigured`, `HarkRefused`, `HarkRateLimited`, `HarkServerFailed`, `HarkStillProcessing`, `HarkUnreachable` (a timeout included), `HarkAnswerUnreadable`, or `HarkReachedNoDevice` when Hark took it but no phone did (built in JC-107, for JC-110's screen). Not audited: they change no machine.
  - Built so far: `WatchHerd`, `ForgetMachine`, `MarkSeen`, `SetPinned`, `SendCommand`, `WatchTranscript`, `WatchNotificationSettings`, `SetNotificationPref`, `SendTestNotification`. The refusals of `ForgetMachine`, `MarkSeen` and `SetPinned` are `MachineNotInHerd`, `MachineStillConnected`, `PaneNotInHerd` and `HubStorageFailed` (the hub's database refused the write, so nothing changed).
  - The agent's own refusals (`AgentCommandFailure`) are `PaneNotAgent`, `PaneNotCreatedByCrook`, `HerdrRefusedCommand`, `HerdrUnavailable` and `CommandDeliveryUnknown`.
- Serialization: `RpcSerialization.layerNdjson` (sockets need framing).

Why "agent is always the client": Effect RPC servers listen; the agent can't (laptop behind NAT, no inbound). A server-streamed `Attach` gives the hub a push channel to the agent without reverse-RPC plumbing.

### 2.3 `@crook/herdr`

An Effect client for Herdr's socket API. Private like everything else, but kept free of crook concepts anyway: it's the cleanest seam for testing the agent.

- `HerdrClient` service: `request(method, params)` typed by a `HerdrMethod` value (params + result schema), `snapshot`, and `subscribe(subscriptions)`. `subscribe` is scoped and resolves only once Herdr acks with `subscription_started`, yielding a `Stream<HerdrEvent>`; that ordering is the recovery contract, so the caller can `subscribe` then `snapshot` and miss nothing.
- Methods are added by the ticket that first calls them; today `ping`, `session.snapshot`, `pane.process_info`, `agent.prompt`, `agent.send_keys`, `pane.rename` and `pane.close`.
- Rename and close (measured on a herdr 0.9.5 probe session; the 0.9.1 binary carries the same method and param names, read from its strings, not run): `pane.rename { pane_id, label }` answers `pane_info` carrying the whole pane record, label set, and a `null` label clears it. It sends **no event** to any subscriber, lifecycle or otherwise, so nothing re-reads after it unless the caller asks. `agent.rename` is not a display name: it takes a handle matching `[a-z][a-z0-9_-]{0,31}` and rejects anything else with `invalid_agent_name`. `pane.close { pane_id }` answers `ok` and emits `pane_closed`; closing the only pane of a tab closes the tab too, with no `tab_closed`. Both answer `pane_not_found` for a pane herdr does not know.
- A pane label is what herdr's own views name a pane by, and plugins write it too: the auto-title plugin on the laptop names every pane after its work twice a second and leaves alone a pane renamed by hand, handing it back when the name is cleared (its README). So a pane's label can change with no event, and crook shows such a change at the next re-read.
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

Built in JC-99, against the spike-82 captures and the laptop's own transcripts. Every module takes its roots or file as a value; nothing here reads herdr. Paths go through effect's `Path` service, so the services need `FileSystem` and `Path` from the entry point.

- `claudeRoots`: `CROOK_CLAUDE_ROOTS` (comma list) when set, else `$HOME/.claude`, plus `CLAUDE_CONFIG_DIR` when set, deduplicated. A root that is not an absolute path is `ClaudeRootNotAbsolute`, at startup: nothing expands `~` in a systemd unit or a plist, and a relative root would make the locator wait forever under the agent's cwd, since a missing `projects` folder is a normal state. A list that ends up naming no folder (`CROOK_CLAUDE_ROOTS=,` with no `CLAUDE_CONFIG_DIR`) is `ClaudeRootsEmpty`, at startup too, for the same reason: zero roots is a locator that waits forever and logs nothing. `HOME` is read only on the default branch.
- `FileWatch`: `watchReady(path)` (a ready signal, then the name of each changed entry) and `awaitPath(path)` (wait for a path, watching the nearest folder that exists), shared by the three services below.
- `TranscriptLocator`: `locate(session)` globs `<root>/projects/*/<session>.jsonl` over every root and never rebuilds the folder name from the cwd. `await(session)` watches each root's `projects` folder and its project folders until the file appears: Claude writes nothing before the first prompt (spike 82), so a session with no file is a normal state, not an error. `awaitSubagent` does the same for `<session>/subagents/agent-<id>.jsonl`. A session id is only looked up when it is letters, digits and dashes (`TranscriptSessionInvalid` otherwise), so a phone cannot walk a path out of the roots.
- `TranscriptTail`: `follow(file, from)` and `drain(file, from)` → `Stream<TranscriptChunk>`. A read is 64 KiB (effect's `FileSystem.stream` default chunk size). Only complete lines are parsed; the bytes after the last newline wait for the next read, because Claude's appends land in 4096-byte pieces and a reader can see half a line (spike 82). One chunk per read that completes at least one line, so a chunk is never empty of progress. `from` must be at most the file's size and right after a newline (`TranscriptOffsetBeyondEnd`, `TranscriptOffsetMidLine`); a file that shrinks under the tail is `TranscriptShrank`. `follow` re-reads on every watch event through a sliding buffer of one.
- `SubagentRoster.watch(file)`: the session's `subagents/agent-<id>.meta.json` files as a sorted `Subagent` list, re-read on every change and emitted only when it differs. A meta without `agentType`, `description` or `spawnDepth`, keys spike 82 found in every meta, is skipped with a warning rather than given a made-up value. Workflow subagents (`subagents/workflows/<runId>/`, 2139 agent files against 828 flat ones in spike 82) are not listed and cannot be watched yet; the JC-101 subagent tree needs them.
- `parseLine(bytes, offset)`: pure, one JSONL line's bytes → `readonly TranscriptMessage[]`; a blank line is no message. It takes bytes, not a decoded string, because a tear can split a multi-byte character and the decoder turns each dangling byte into U+FFFD, which re-encodes as 3 bytes: offsets counted on the string would land past the real ones.
  - Metadata Claude keeps for itself (24 entry types, the `stop_hook_summary` and `agents_killed` system subtypes, 45 attachment types, all seen in spike 82 or the laptop's transcripts) maps to nothing. Anything else unknown becomes `UnrecognizedEntry` (`system/<subtype>`, `attachment/<type>`, or the entry type), never dropped silently.
  - A human prompt queued while Claude works exists only as a `queued_command` attachment with `commandMode: "prompt"`, never as a user entry (0 of 262 on the laptop), so that attachment becomes `User { queued: true }`. One without `origin.kind: "human"` is skipped: it is not known who wrote it.
  - A line that is not JSON is salvaged. Spike 82 found 55 records in the history cut mid-string with the next record glued on, no newline between (cause not proven). The parser tries each `{"parentUuid"` or `{"type"` byte offset in order and emits `Malformed` for the bytes before the first one that parses, then the recovered entry at its own offset.
  - An image is stored twice per tool result (in the message and in `toolUseResult`); only the message copy is kept.
- Fixtures live in `packages/claude/test/fixtures`, copied from the spike-82 captures with the session's own ids.
- Not built yet: `deriveAsk(lastMessages, screenText)` (Ask cards).

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
  CreatedPanes.ts         the panes crook created, persisted, so Close knows what needs confirming
  AuditLog.ts             append-only JSONL audit of every command this machine ran
  StateDirectory.ts       where the agent keeps its files ($XDG_STATE_HOME/crook)
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
- Backoff (built in JC-81): exponential from `HERDR_RECONNECT_BASE`, doubling, capped at `RECONNECT_CAP`, retried forever. The schedule (`reconnectBackoff`) and the health rule below (`stayedHealthy`) live in `@crook/protocol/AgentLink`, beside `AGENT_PING_INTERVAL` and `RECONNECT_CAP`: they are the one reconnect policy of herdr, the agent's HubLink and the phone's hub link, and only the base differs. The base is 100 ms: a herdr server cold-starts in 101–114 ms (measured), and the socket of a live handoff was missing for under 65 ms (one handoff probed with pings 21 ms apart; a reconnect 250 ms after the EOF succeeded on all 3 handoffs). The cap reuses `AGENT_PING_INTERVAL` (5 s): a herdr that comes back is noticed no later than a hub that comes back. No jitter: jitter spreads many clients hitting one server, and each herdr server has exactly one agent.
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
- `HUB_RECONNECT_BASE` (in `@crook/protocol`, with `hubReconnectSchedule` built on it from `reconnectBackoff`, since the phone's link reconnects the same way) is 77 ms, the slowest of 9 warm HTTPS requests from the laptop to an exe.dev VM's proxy (52–77 ms; the cold first one took 626 ms). `AGENT_PING_INTERVAL` (in `@crook/protocol`, since the hub times agents out on it too) is effect's RpcClient default of 5 s, written out because the cap, the healthy period and the hub's silence timeout reuse it. S1 measured no proxy idle timeout within 900 s, so the ping exists to detect a dead hub, not to keep the proxy open.
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

Rename and close (built in JC-112):

- `RenameAgent` is herdr's `pane.rename`, the name herdr's own views show, never `agent.rename` (a handle, see 2.3). `label: None` clears the name, which hands the pane back to whatever names it otherwise. The `PaneRenamed` receipt carries the label from herdr's `pane_info` reply, read the way the mapping reads it, so it states what herdr stored rather than what was asked. Because herdr sends no event for a rename, the executor asks `MachineStateSync.invalidate` for a re-read once the rename succeeded. The re-read is forked into the sync's scope rather than awaited, so the delivery bound against `COMMAND_TIMEOUT` still holds; a failed re-read is logged, and the next herdr event re-reads anyway.
- Close never touches a pane crook did not create unless the user confirmed it: `ClosePane { confirmed: false }` on a pane outside `CreatedPanes` fails with `PaneNotCreatedByCrook` before anything is sent, and the phone resends with `confirmed: true` under a new key once the user says so. The policy check stays on the agent, which reads its own record, never the hub's claim. Rename and close, like input, go only to panes in the current `MachineState.agents`.
- `CreatedPanes` is a JSON array of pane ids at `CROOK_CREATED_PANES_PATH` (default `$XDG_STATE_HOME/crook/created-panes.json`, `$HOME/.local/state` when unset, per the XDG base directory spec). Pane ids are the key because they survive herdr restarts, crashes and handoffs and are never reused within a session, while `terminal_id` changes on all three (spike-81). One set per machine suffices since crook drives one herdr session per machine (D11). Writes go to a temporary file renamed over the record, so a crash never leaves half a file; a missing or unreadable file starts the set empty, which only means more confirmations. An unreadable file is moved to the same path with `.unreadable` appended before anything can write over it, so the old record stays there to inspect (a later unreadable file replaces it). Any read failure but a missing file moves it, a passing one (`EIO`, `EMFILE`) included, so an intact record can end up set aside: leaving it in place would let the next change write over it with only the new pane, losing the record outright, while setting it aside costs extra confirmations and keeps every id recoverable; only when that move fails does the next change write over the file, and the warning says so. StartAgent (JC-111) is what calls `remember`; a successful close calls `forget`. `MachineStateSync` reads the set on every re-read and follows its changes, re-marking `createdByCrook` on the rows it already holds without asking herdr, under the same lock as a re-read, so a `remember` racing a re-read is never lost. Panes closed outside crook stay in the record, which is harmless while ids are not reused. The residual case: deleting a herdr session and starting a fresh one may restart its id counters (inferred, not measured), and a stale id could then match a pane crook did not create.

Audit log, agent side (built in JC-106):

- Every `CommandExecutor.execute` appends one line to `CROOK_AUDIT_LOG_PATH` (default `$XDG_STATE_HOME/crook/audit.jsonl`), replays and refusals included: when, the machine id (who, on this side: the hub vouched for the routed command, the machine is the one that ran it), the idempotency key (the same key the hub's audit records, which joins the two), the operation, its arguments after the policy, and the outcome. The file is written `0600` in a `0700` directory, the modes Claude Code gives its own transcripts (measured on 200 transcripts in `~/.claude/projects`).
- The line is written after the outcome, in `execute`'s uninterruptible region. A write that fails is logged at error and the command's answer stands: by then herdr has acted, and refusing to answer would only make the hub time out and the phone retry.
- Policy, one `auditPolicyConfig` in `@crook/domain/Audit` that agent and hub both read: `CROOK_AUDIT_ARGUMENT_LIMIT` characters per argument (default 200: decided, not measured; long enough to recognise a prompt by its opening, short enough that a pasted file does not land in the log). A string past it keeps that many characters and gains `…`; an array of strings (`keys`) spends one limit across its texts, and the last text it keeps gains the `…`, so a cut never reads as an extra key. `CROOK_AUDIT_REDACT` is a comma list, no spaces, of argument names written as `[redacted]`, or `none` to redact nothing (default none: the full prompt already sits in Claude's transcript on the same machine, at the same file mode). The names form a closed set: `pane`, `text`, `keys`, `label`, `confirmed`, `pinned`. A misspelt or padded name fails at startup rather than silently logging what it meant to hide.
- No rotation and no retention limit yet.

Transcripts (built in JC-100):

- `TranscriptStreams.serve(link)` runs inside each HubLink session, beside `Attach` and the state publisher. It reads `TranscriptDemands` and keeps exactly the demanded watches running in a `FiberMap` keyed by watch id: a new id starts a fiber, a missing one interrupts it. A tail runs only while a phone watches it.
- A pane watch follows the pane's `claudeSession` in `MachineStateSync`. It emits `TranscriptOpened`, waits for the file, then merges the tail with the subagent roster. When the session changes (`/clear` makes a new session and file at once, spike 82), it switches: whatever the old file gained since the last chunk is drained first, then the new session opens from 0. `/compact` appends to the same file, so it needs nothing.
- A resume (`from`) in the current session continues at that offset. A resume naming another session drains that session from the offset, then opens the current one: the phone does not lose the end of a conversation it was reading when someone cleared it.
- A subagent watch emits `TranscriptOpened` for the parent session, then follows `agent-<id>.jsonl` once it exists.
- Every event goes out as `PublishTranscript` and waits for the hub's answer, so a slow phone slows its own watch, not the others. `TranscriptOutOfStep` restarts the watch from the position the hub expects. A library error (locate, tail, roster) is sent as `TranscriptWatchFailed` with its wire form, and the watch ends. A defect ends it the same way, as `TranscriptReadFailed` with the pretty cause, so the phone's stream fails visibly instead of hanging open. An `RpcClientError` ends it quietly, since the session is ending too.

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
  PinnedAgents.ts         sqlite: pinned panes per machine
  AuditTrail.ts           sqlite: append-only audit of the phone's commands and state-changing RPCs
  TranscriptRelay.ts      one watch per WatchTranscript; demands to agents, cursor per watch
  HarkClient.ts           Hark agent API over HttpClient: send, withdraw, request spacing; disabled without a token
  HarkNotifier.ts         herd transitions → Hark (plain notifications today; Live Activity and approvals later)
  NotificationPlan.ts     pure: which publishes raise a notification, which states keep one, the next Hark call
  NotificationStore.ts    sqlite: notification switches, sent notifications awaiting withdrawal
  Database.ts             @effect/sql-sqlite-bun client + migrations
  AgentLinkHandlers.ts    AgentLink.toLayer(...)
  ClientApiHandlers.ts    ClientApi.toLayer(...)
```

Server, identity and Herd (built in JC-90):

- Four GET routes, whose paths live in `@crook/protocol/HubRoutes` because the agent and the phone dial them too: `/health` (no headers needed), `/rpc/agent`, `/rpc/client`, and `/*` for the static PWA from `CROOK_WEB_ROOT` with the SPA fallback (an extensionless path that accepts HTML gets `index.html`). The RPC handlers sit in `HttpRoutes` for now rather than in the two handler modules above.
- Every rejection is a tagged error that answers itself as a 403 carrying its `message` (`HttpServerRespondable`), so the router's access log records why.
- exe.dev sends the minter's email with every VM-token request, alongside the token's `ctx` (exe.dev docs, "What your server receives"). So the email alone can't tell the phone from an agent:
  - `/rpc/agent` wants the owner's email and a `ctx` with a machine id.
  - The phone routes want the owner's email and no `ctx` at all. Without that, a leaked agent token could watch the herd.
  - `/rpc/client` also wants `Origin` to equal `CROOK_HUB_ORIGIN`, which must be `https` (anything else fails at startup: a scheme-less value parses to origin `"null"`, which sandboxed pages send).
  - A token minted without a `ctx` looks exactly like a browser login. Only the owner can mint one, which is outside the threat model.
- Machine identity is read once, at the agent's upgrade, and each agent connection gets its own RPC server whose handlers close over that machine id. Handler `headers` can't be trusted for it: per-call headers override the upgrade's (AGENTS.md).
- The phone's login is bound the same way (JC-106): `admitPhoneSocket` returns the `X-ExeDev-Email` it admitted, and each phone connection gets its own `ClientApi` server whose handlers audit under that email. Today that email always equals `CROOK_OWNER_EMAIL`, since nobody else is admitted; it is recorded anyway so the log stays right if access ever widens.
- `Herd` holds one entry per machine: the number of live `Attach` streams, `lastSeenAt` and the last `MachineState`. Online means at least one `Attach` is open; counting lets a reconnect overlap the old connection without a false offline. Offline keeps the last state. `WatchHerd` is `SubscriptionRef.changes` behind a sliding buffer of one, so it emits the current view first and a slow phone only gets the newest. Machines are listed by id.
- A dead agent socket that never closes is caught by Bun's `idleTimeout`, set to `SOCKET_SILENCE_TIMEOUT` (two `AGENT_PING_INTERVAL`s, the same rule effect's RpcClient uses to call a hub dead). Bun's own pings are off (`sendPings: false`): through the proxy the proxy would answer them and keep a dead agent online. The agent's RPC pings are data frames, so a healthy agent stays up. A silent agent showed as dropped after 11.8–11.9 s against the 10 s timeout (5 runs, measured before JC-97, when a drop meant offline); a kill closes the socket and showed as dropped at once. Since JC-97 a dropped machine is `reconnecting` first and turns `offline` after `RECONNECT_GRACE`. The timeout is server-wide, so the PWA's client must ping within it too.
- Shutdown uses a `gracefulShutdownTimeout` of zero: sockets never finish on their own, so a grace period would only ever be waited out in full, and agents reconnect anyway.
- Config: `CROOK_HUB_PORT`, `CROOK_OWNER_EMAIL` (compared exactly), `CROOK_HUB_ORIGIN`, `CROOK_WEB_ROOT`, `CROOK_HUB_DATABASE_PATH`, and the optional `CROOK_HUB_HARK_TOKEN` (redacted).

Database (built in JC-97, shared by every later table):

- One SQLite file through `@effect/sql-sqlite-bun`, at `CROOK_HUB_DATABASE_PATH`. `Database.layer` builds the client and runs the migrations before anything reads, and `main.ts` provides it once; `Database.layerAt(":memory:")` is the test database.
- Every table comes from a numbered migration in the one migration record in `Database`, never from the module that reads it: migrations are history, and an `ALTER` belongs to no single repository. A later ticket appends the next number. So far: `1_machines`, `2_seen`, `3_seen_terminal`, `4_pins`, `5_audit`, `6_notifications`.
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
- Migration `3_seen_terminal` recreates `seen` with a `terminal` column and drops the marks recorded without one: they cannot be checked against a lifetime. The cost is one re-open of each done agent after that deploy.
- For JC-107, the notifier diffs consecutive publishes of one machine, and the domain carries what it needs to suppress the diffs that are not transitions; the diff itself is built with the notifier. A pair with `isResync(previous, next)`, or a `next` that `isHerdrLost`, is no transition at all: a resync diff spans a gap where herdr was not followed (after a restart every agent is gone, after a handoff each one reads `unknown` before it is re-detected), and diffing it against the cached state would fire "done" or "closed" for nothing that happened. A row that reads `unknown` is not yet known: it neither raises a notification nor withdraws one. The transition is judged when herdr re-detects the agent, against `beforeHandoff.status` when the row carries one, so a blocked agent re-detected blocked does not ask twice while one re-detected `done` after being `working` still counts. A `done` agent whose completion the handoff lost is published `done` again (see 2.1), so it neither withdraws a "Finished" nobody read nor leaves needs-you; its tab coming into view on the laptop publishes it `idle`, and that is a transition like herdr's own `done` to `idle`, which withdraws it. A row herdr never re-detects therefore changes nothing until herdr drops it from `agents`, which is a transition of its own ("Claude exited" or "This pane closed", by `panePresence`). The hub's first publish after its own restart has no previous state, so there is nothing to diff.
- `MarkSeen` records the pane's current sequence in the hub's last state for that machine; the phone sends it when a chat opens and again while a chat stays open on an agent that changes. Herdr focus is never called (D12): the hub has no herdr connection at all.
- Seen survives a hub restart (`seen` table). Lost marks would bring every opened done agent back as "needs you" after each deploy, inflate the tab badge, and (JC-107) notify again for what was already read. Marks are few and the table already exists, so the cost is one upsert per chat open.
- `HerdMachine.seen` lists the panes seen at their current sequence. `AgentPriority.orderAgents` sorts a machine's agents: blocked (longest waiting first), done and unseen (newest first), working, then idle and seen done, then unknown, keeping herdr's order inside the last three. Ties use `statusChangedAt`. `needsYouCount` counts blocked plus unseen done and is zero for an offline machine; `herdNeedsYouCount` sums the machines. Pinned agents come before all of them, ordered among themselves by the same tiers (the prototype's order); a pin never counts toward needs-you.

Pins (built in JC-112):

- Pinning is per user view, not a herdr concept, so it lives on the hub: the `pins` table keyed by `(machine, pane)`, loaded at startup, written before memory changes like every phone write. The pane id is the key because it survives herdr restarts and handoffs and is never reused (spike-81); `terminal_id` changes on every restart.
- A pin is not dropped when its pane leaves the published state. `HerdMachine.pinned` only lists pinned panes that are in the last state, so a pin whose agent exited shows again when an agent returns to that pane ("Start Claude in this pane" keeps its pin, as in the prototype). Since ids are never reused, a pin left behind by a closed pane never lands on another pane; it costs one row. The same residual as `CreatedPanes`: a deleted and recreated herdr session may reuse ids.

Audit log, hub side (built in JC-106):

- The `audit` table holds one row per audited phone action: when, the login (`actor`), the operation, the machine, the arguments after the policy as JSON, the idempotency key for commands, and the outcome with the failure's name. Two triggers abort any `UPDATE` or `DELETE` on it, so append-only is the database's rule, not just this code's habit.
- Audited: every `SendCommand` (the command's own operation and arguments, so `Prompt`, `SendKeys`, `RenameAgent`, `ClosePane`), `SetPinned` and `ForgetMachine`. Not audited: `MarkSeen`, sent at every chat open and again while a chat stays open on a changing agent. It changes no machine, only which badges show, and logging it would turn the audit log into a reading history that outnumbers every action in it. Watches change nothing.
- The row is written when the handler exits, interruptions included (`interrupted`: the phone dropped mid-command). A row that fails to write is logged at error and the phone's answer stands, like the agent's.
- Policy: the agent's, read from `CROOK_HUB_AUDIT_ARGUMENT_LIMIT` (default 200, the same decided default) and `CROOK_HUB_AUDIT_REDACT` (default `text`; `none` turns the default off, and an unknown name fails at startup). The hub redacts prompt text by default where the agent does not, because the hub keeps no transcript content anywhere else (D10): storing prompts in its database would put them on a machine that otherwise never holds them, while on the agent the full prompt already sits in Claude's transcript beside the log.
- No retention limit yet, as on the agent: the table grows by one row per audited action, and the triggers that make it append-only also block pruning. A later ticket that adds retention needs a migration that drops and recreates the `DELETE` trigger.

CommandRouter (built in JC-103):

- Each `Attach` registers an outbox with the router for as long as it lives, alongside `Herd.hold`. A command goes to the newest `Attach` of its machine, so while a reconnect overlaps a dying connection the command reaches the live one. No `Attach` at all is `MachineOffline`, before anything is sent, and so is an outbox that shut down between the lookup and the offer. The phone sends again once the machine shows online; nothing is queued for it.
- Herd's attachment count and the router's outboxes are two registries of one fact, acquired side by side in the same `Attach` merge, so for an instant after a connect or before a disconnect the herd may show a machine online that the router answers `MachineOffline` for.
- `send` gives the command the next `CommandId` (a counter: ids only have to be unique among the commands waiting in this process), parks a `Deferred` under it and awaits `CompleteCommand` for `COMMAND_TIMEOUT`, then fails with `CommandTimedOut`. `COMMAND_TIMEOUT` lives in `@crook/protocol` beside `AGENT_PING_INTERVAL`, because the agent's delivery bound is set against it. It is `AGENT_PING_INTERVAL` (5 s), the link's own heartbeat: over 10 times the slowest measured prompt (403 ms) plus the slowest measured warm round trip to the proxy (77 ms).
- `complete` resolves the `Deferred` only if the answering connection is the machine the command was routed to; a late answer (after the timeout) or one from another machine is dropped with a debug log.
- A timed-out command may still run. The phone retries with the same key, and the agent answers with the first outcome instead of running it twice. Nothing tells the agent the hub gave up, so a command queued behind a slow one still runs late: a late `esc` can interrupt a turn started after it. Commands carry no deadline today.
- Commands are not persisted: a hub restart loses those in flight, and the phone sees them time out.

Transcript relay (built in JC-100):

- One watch per `WatchTranscript` call, with an id from a counter. Two phones on the same pane are two watches and two tails: sharing one would need a cache to give the later phone what the first already got, and D10 says no cache. JC-100's "start a tail on the first subscriber, stop it on the last" is read as one subscriber per watch; this awaits the owner's sign-off.
- `WatchTranscript` asks the herd first, through the same membership rule `MarkSeen` uses (`Herd.requirePane`, `Herd.requireMachine`): the machine must be in the herd and, for a pane, the pane in its last published state (`MachineNotInHerd`, `PaneNotInHerd`). A subagent watch needs only the machine; the agent validates the session.
- The relay keeps, per watch, the machine, the source and a cursor (`TranscriptPosition`), never the messages. `demands(machine)` is the current set with each cursor, re-sent when the set of ids changes. An agent that reconnects therefore restarts every watch from where its phone stands, and the phone's stream survives the drop with no line repeated or lost.
- `publish` passes a chunk on only if it starts at the cursor (`continuesFrom`), else answers `TranscriptOutOfStep { expected }`. A `TranscriptOpened` for another session moves the cursor to its start. Delivery per watch is serialised, so two overlapping agent connections cannot interleave.
- The phone's side of the inbox keeps its own position, of what it was handed, and lets through only `remainderAfter` it. The cursor moves after the inbox takes an event, as a second step, so a publish interrupted between the two (the agent's socket drops while the phone takes the event) leaves the cursor behind the phone; the reconnecting agent then resends lines the phone has, and this filter drops them. The same filter swallows the `TranscriptOpened` a restarted watch sends for the session the phone is already in, so a restart is invisible to the phone. The window is narrow in effect 4.0.5, which resumes a parked offerer synchronously inside the taker (`Queue` resumes it through `Effect.callback`, which calls `fiber.evaluate` in place), so no relay test can open it on demand; `remainderAfter` is tested on its own instead.
- The phone's inbox holds one event, so `PublishTranscript` only returns once the previous event left for the phone: backpressure runs from the phone to the agent's tail. `TranscriptWatchFailed` removes the watch and fails the phone's stream after what was already queued (effect's `Queue.fail` delivers buffered items first, probed). An update for a watch that is gone, or that belongs to another machine, is dropped with a debug log.
- Sizes, measured by draining 7 laptop transcripts (the 3 largest and 5 with images, 1468 chunks) and encoding each chunk as it goes on the wire: p50 12,527 B, p90 35,140 B, p99 421,705 B, max 732,560 B. The 95.5 MB transcript of a long orchestrator session became 910 chunks and 23.7 MB on the wire, drained in 612 ms on the laptop without the network. Bun's default WebSocket `maxPayloadLength` is 16 MiB (`bun-types`), over 20 times the largest chunk.
- `from: null` means byte 0, so a phone opening a long chat cold downloads and parses all of it: that 23.7 MB, for the largest transcript on the laptop. Known cost for JC-101, not solved here; one way is a `from` that asks for the last N bytes, aligned to a line start.
- Images travel inline as base64 in the chunk. Across 908 images on the laptop the base64 was p50 82,668 B, p99 518,524 B, max 671,428 B, and the most base64 in one line 727,536 B, all far under the payload limit, while a fetch RPC would need a hub-to-agent request path of its own. The phone decodes the base64 into a `Blob` and renders it from an object URL, which needs `img-src 'self' blob:` in the CSP (2.7): a `blob:` URL names only bytes the page made itself, with the media type it chose from the two the parser admits, where `data:` would let any inline image through. The CSP change lands with the first image the chat renders (JC-101), not before.

Notifications (built in JC-107):

- Hark's agent API, `POST /api/agent/notifications` and `POST /api/agent/notifications/:id/withdraw`, with `Authorization: Bearer` from `CROOK_HUB_HARK_TOKEN` (`Config.Redacted`, needs the `notifications:send` scope). Without the variable the hub starts anyway: `HarkClient` logs one warning naming the variable, its `delivery` reads `noToken` (which the settings stream carries to the phone), every call fails with `HarkNotConfigured`, and the notifier never subscribes to the herd, so nothing queues up for a token that may never come.
- Copy, from TEMP_DESIGN_EXPLORATION ("Outside the app"): the title is the agent's title (its label, else herdr's title, else the pane id), so each agent threads on its own in Hark; the body is a verb and where it runs, `Finished · laptop / crook` or `Has a question · desk / notes` (machine label, then workspace label). Every notification goes to one `crook` project, with no `url` (D16) and no `imageUrl` (Hark needs a public URL; the hub is private). Labels only: nothing Claude wrote. The title is cut to Hark's 80, never splitting a UTF-16 surrogate pair.
- What raises one: a publish whose agent row turns `done` (Finished) or `blocked` (Questions) from another known status, or shows that same status under another `seenMarkOf` identity, judged as in "Seen and needs-you" above: no raise across `isResync`, while `isHerdrLost`, from `unknown`, for a pane the previous state did not list, or for a row that still carries `beforeHandoff` (it reads `unknown` or the status it had before). The same-status case is the withdraw rule's mirror: herdr bumps the sequence on every detected change (2.1), so a new identity under the same status means a state in between that the hub never saw, because the agent publishes through a sliding buffer of one and a reconnect sends only the latest state. Without it, blocked at 5 then blocked at 7 would withdraw the first question for its moved identity and raise nothing for the second. A switch that is off sends nothing, and turning it off does not withdraw what is already out. Until approvals (JC-109) tell a permission prompt from a question, every `blocked` is a question.
- What keeps one: a notification is out while its agent would still be needs-you for that same state. It is withdrawn when the pane is seen in crook (`MarkSeen`, or a publish whose `seen` lists it), when the row leaves `agents`, when its status is no longer the one it announced, or when its `seenMarkOf` identity moves on, and every notification of a machine goes when the machine is forgotten (`ForgetMachine`). The status check is what withdraws Finished on the laptop: herdr's `done` to `idle` on focus leaves `state_change_seq` unchanged (2.1). A row reading `unknown` keeps it, and so does a lost state, whose rows are the last ones read. A resync is judged like any other state: after a herdr stop or crash the agents are gone, and so is their needs-you.
- Shape: `Herd` publishes a `HerdChange` (`MachinePublished` with both states, the machine's label and the seen panes, `PaneSeen`, and `MachineForgotten` once the forget is saved) on an unbounded `PubSub`; the notifier subscribes while its layer builds, so no publish is missed. It folds changes into the notifications it wants (`NotificationPlan.afterPublish`, `afterSeen`, `afterForgotten`, pure), and one fiber reconciles them with what Hark holds, one call at a time (`nextStep`: withdraw what is no longer wanted, then send what is). Because it compares the latest wants at each step, a Finished seen before its turn is never sent, and a burst costs at most one call per pane. The switches apply in one place, the step: a wanted notification whose switch is off becomes a `Drop`, which removes it from the wants only while it is still the one the step looked at, since the herd fiber may have replaced it meanwhile.
- A bug never stops the notifier. A defect while sending or withdrawing one notification is logged at error and that notification is given up on like a refusal, so one bad notification cannot block the rest; a defect anywhere else in a step is logged and the loop pauses `PAUSE_AFTER_HUB_BUG` before its next step, and a defect while folding a herd change is logged and that change skipped. That pause is `HARK_REQUEST_SPACING`, not the outage pause, because a bug is not Hark having trouble and has nothing to wait out: it only keeps a bug that repeats on every step from spinning, and at the request spacing such a loop runs no faster than a working one that calls Hark on every step. A send and the record of what it sent run uninterruptibly, so a hub shutting down mid-send still remembers a notification Hark created and can withdraw it after the restart.
- Rate: Hark allows 60 requests per minute per service on the free plan and counts an agent-token connection "like a service" (Hark docs, "Rate limits", and harkctl's "Send a notification"), over a rolling 60 s window. `HarkClient` sends one request at a time and starts each at least `HARK_REQUEST_SPACING` (60 s / 60 = 1 s) after the previous one finished, so no window holds more than 60 arrivals. A `429` with `Retry-After` waits what it says, then retries with the same `Idempotency-Key`; the header is read as seconds or as an HTTP date, rounded up to whole seconds and capped at the 60 s window, since a rolling 60-second window frees within one window and Hark itself sends `Retry-After: 60`. The cap keeps an absurd hint (`1e16`, a date in the year 9999) from sleeping the notifier for good or overflowing the schema's safe integer, and one the hub cannot read counts as no hint. A `429` without a hint is the monthly allowance, given up on like any refusal: logged at error, never retried, and forgotten once the state moves on. A `202` (Hark's "an identical request is still processing", documented for its webhook route) retries on the next turn. A withdrawal that fails for good is dropped; Hark answers 502 when no device took the removal, and that 502 is final.
- Outages: a transport failure, a request Hark does not answer within `HARK_REQUEST_TIMEOUT`, or any other 5xx is Hark having trouble (`HarkUnreachable`, `HarkServerFailed`), not a refusal: the notifier waits `HARK_OUTAGE_PAUSE` and retries with the same key, for sends and withdrawals alike, so an outage loses no notification and leaves no stale one on the lock screen. The pause is 60 s because the only wait Hark ever names is its `Retry-After: 60`; it documents no backoff for an outage. 400, 401, 403, 404 and 409 stay final.
- The timeout bounds the one request in flight, response body included, so a Hark that accepts the connection and never answers cannot hold the request permit and stall every later call and the phone's `SendTestNotification`. Without it Bun 1.4.3's own `fetch` gave up on a server that never answered after 360.4 s (measured, once). Twenty unauthenticated `POST /api/agent/notifications` from the laptop answered `401` in 137–471 ms, p50 about 140 ms (measured); an authenticated send also waits for Expo to take the push, which needs a token to measure. The 10 s is a choice made against those numbers, about twenty times the slowest round trip, and is to be re-measured once the token exists.
- The idempotency key is `crook/<machine>/<pane>/<terminal>/<state_change_seq>/<event>` (Hark keeps keys per service, up to 200 characters; a longer one goes without), so a retry never pushes twice.
- Sent notifications are kept in `hark_notifications` (one per pane) until withdrawn, and a restarted hub starts out wanting exactly those, so the first publish of each machine judges them: still done and unseen keeps one, anything else withdraws it. Notifications wanted but not yet sent are not kept. A stored notification of a machine no longer in the herd is not wanted at startup, and neither is one whose pane carries a stored seen mark with the same identity (a `MarkSeen` saved just before the hub stopped, its withdrawal not yet made), so the first step withdraws both. One whose state moved on while the hub was down can only be judged once that machine publishes: the hub does not store machine states. The switches live in `notification_prefs` (a missing row is on), loaded at startup and written before memory changes like every phone write, so every device shares them. All four default to on: setting the token is the opt-in.
- `SendTestNotification` sends title `crook` with a fixed labels-only body through the same client and spacing, and fails with `HarkReachedNoDevice` when Hark answers `accepted: 0`.

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
  rpc/                    the hub link: RpcClient over the browser WebSocket, page signals, the session check
  atoms/                  the hub runtime and the atoms over it: link state, connection, herd, needs-you, seen
  cache/                  the last herd snapshot in IndexedDB
  connection/             what the link state means on screen: banner, logged-out screen, the gate
  herd/                   the Agents tab: layout model, machine sections, cards, empty states, pull to resync
  chat/                   the agent chat (JC-93 builds its header only)
  newagent/               New agent (JC-93 builds its header only)
  time/                   elapsed-time formatting and a ticking clock
  components/ui/          Mischief UI, copied in with the shadcn CLI (we own this code)
  components/             app components built from ui/ (StatusDot, press and long-press, swipe rows, AskCard, …)
  router/                 the router, with its not-found (home) and error fallbacks
  highlight/              shiki setup (JS regex engine, fine-grained langs, hast → JSX)
  sw/                     service worker: app shell cache only
```

- **A pushed screen is a child route** marked `staticData.pushed`, so its parent root list stays rendered (and inert) beneath it, and a deep link still has a parent to go back to.
- **The hub sends the CSP as a header** on every response, never a meta tag: a meta can't carry `frame-ancestors`, and Vite's dev server needs inline scripts. The policy is decided once, as `CONTENT_SECURITY_POLICY` in `@crook/web/csp/ContentSecurityPolicy`: everything `'self'`, with `default-src`, `base-uri`, `form-action` and `frame-ancestors` at `'none'`. Transcript images add `blob:` to `img-src` when the chat starts rendering them (2.6, JC-101). The hub imports that leaf (JC-115) rather than restating it. `vite preview` sends the same header, so a production build is checked under it locally.
- **A push hands over its opener.** The caller passes `openedFrom(element)` as the navigation's history state, with the element that was tapped (`Pressable` and `SwipeRow` give it to `onTap`). The pushed screen reads it once, when it mounts, and returns focus there when it unmounts, falling back to whatever had focus, then to the active tab. Document focus alone can't name the opener on an iPhone, where a tap doesn't focus a button. Openers are held by weak reference and never dropped, so a screen rebuilt by Back or Forward still finds its own, and a removed element can still be collected. One element always gets the same key, and every key carries the page load's `performance.timeOrigin`, because history state outlives a reload and a counter does not. So a second tap on a row whose push is still loading asks for the location the router is already on, and the router's `navigate` drops it: pushes go through `navigate` (`Link`, `useNavigate`), never `router.history.push`, which always pushes.
- **Every pushed entry gets its own screen.** The router remounts a route whenever its params change (`defaultRemountDeps`), so a chat opened from a chat slides in, takes focus and keeps its own opener. A screen slides in only when it arrives by a push (a higher history index than the resolved location's), so one rebuilt by Back or swapped in by a replace appears in place. Two entries with the same path share one screen: when Back lands on the earlier one, the screen comes back into use rather than staying inert. Back on a screen while a navigation is still pending skips the slide and leaves at once, which cancels a push that has not landed yet.
- **The service worker never calls `skipWaiting`.** A new shell takes over once every crook window has closed, so a running page never loads chunks from a build it didn't come from.
- **The service worker answers every same-origin navigation with the cached shell.** So log in and log out can't be a same-origin navigation to a proxy path: once the shell is cached, that navigation never reaches the exe.dev proxy. They go cross-origin to exe.dev, or to a path on the worker's `NavigationRoute` denylist. The proxy's paths are known now: exe.dev's docs put login at `/__exe.dev/login?redirect={path}` and logout at a POST to `/__exe.dev/logout`, so the whole `/__exe.dev/` prefix is denylisted, and "Log in with exe.dev" is a plain navigation there with the current path as `redirect`.
- Tests run on vitest with happy-dom for components and node for pure modules.

## 3. Patterns

### 3.1 State is a value, events are triggers

Herdr says its events invalidate and its reads are authoritative. So:

- The agent keeps one `MachineState` in a `SubscriptionRef`. A Herdr event (or a reconnect) triggers a re-read; the result **replaces** the value.
- The agent publishes the whole `MachineState` with a monotonically increasing `version` whenever it changes (coalesced so a burst of events is one publish).
- The hub keeps the latest value per machine and emits a fresh `HerdView` to phones. The phone replaces, never patches.
- No event log, no replay, no ordering bugs. If whole-state messages turn out large (measure in M1), switch the hub → phone leg to per-machine replacement first, diffs last.

### 3.2 Append-only streams with offsets

Transcripts are append-only files, so they travel as `TranscriptChunk { session, offset, nextOffset, messages }`. The phone remembers the `{ session, nextOffset }` of the last chunk; reconnect = `WatchTranscript { from }`. Nothing is cached in the hub (D10): the hub keeps a cursor per watch, asks the agent to start a tail when a phone subscribes and stops it when that phone leaves. A new session (after `/clear`) arrives as `TranscriptOpened`, which is the phone's cue for the "conversation cleared" divider.

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
- The two header names live in `@crook/protocol/ExeDevHeaders`, because the hub reads them and the dev proxy (§5) writes one.
- Agent-side `CommandPolicy` is the last guard: input only to panes hosting a recognized agent; `StartAgent` only for allowed kinds.

### 3.7 PWA state

- Effect in the browser too: `RpcClient` over WebSocket, `@effect/atom-react` for state. Streaming RPCs map straight onto atoms (`WatchHerd` → herd atom, `WatchTranscript` → an atom family keyed by pane).
- The connection lifecycle is an Effect retry schedule surfaced as a `connection` atom. The banner's timing (the quiet second, a cold start's dim, "Back online") rides on a small tagged status beside it, because those depend on what the link just went through, which a schedule doesn't know. The status is data with pure transitions, not a machine that drives anything: the schedule and the page signals decide when to dial.
- No XState. Multi-step flows (Ask → answer → confirm, command sent → acked → observed) are atoms holding a tagged state value, driven by `Atom.fn` effects.
- UI-local state stays in React.
- **Who owns what (JC-93).** Server state lives in atoms over one `Atom.runtime` built from the `HubLink` layer; components take values and callbacks and never read an atom; a screen reads the atoms and composes components. What only the screen cares about, such as a collapsed section, is React state. Tests swap the runtime's layer for a fake link with `Atom.initialValue`, so the real route tree renders without a socket.
- **One hub link per page.** `HubLink` holds a `SubscriptionRef` of `{ status, herd }`, where `herd` is the last `HerdSnapshot` (the view and when it arrived) and `status` is Dialing, Live, Unreachable, Offline or Expired. Every derived atom reads that one value, so the banner, the dim, the disabled actions and the badge can't disagree.
- **The cache paints first.** The last snapshot is saved to IndexedDB on every emission and loaded before the first dial, so a cold start shows the herd at once, dimmed until the hub sends a fresh one. A cache that fails to decode, such as one from an older build, is logged and ignored.
- **The socket follows the page.** The link runs only while the page is visible and the browser says it is online: hiding the page closes the socket, and showing it dials a fresh one, which is the resync on `visibilitychange`. Offline is read from `navigator.onLine` and its events, and needs no dial to detect.
- **Reconnects** back off exponentially from the agent's 77ms base, capped at the ping interval (5s). A connection that stayed live for a ping interval counts as healthy, and its drop redials at once. The schedule and the healthy rule are the agent's own, shared from `@crook/protocol/AgentLink` rather than copied. The socket pings every 5s, inside the hub's 10s silence timeout.
- **A failed dial asks whether the session expired.** It fetches `/health` with `redirect: 'manual'`: the exe.dev proxy redirects an unauthenticated request to its login, and a manual redirect comes back as an opaque response with status 0 (the Fetch standard). Status 0 shows the logged-out screen and stops dialing until the page is shown again; anything else is "hub unreachable". How the proxy answers an expired session hasn't been measured against the real proxy yet. The check is bounded by `SESSION_CHECK_TIMEOUT`, which reuses the socket's open timeout (effect's default of 10 s, not measured for this): it goes through the same proxy to the same hub right after a dial that failed, and a check that times out reads as unreachable, which is what the banner already says. The quiet second covers the dial and this check together, so a dial refused at once but checked slowly still raises the banner and the dim after a second.
- **Resync is a fresh socket**, not a second subscription: pull to resync redials and resolves once the link is live with a newer snapshot, or has failed.
- **Hub calls fail fast when not live.** `MarkSeen` (and every action after it) fails with `HubNotConnected` instead of waiting, which is the "no send queue" rule in code. The calls of a session are handed out only once its first herd has arrived: before that the socket may still be opening, and effect's browser socket holds a write until it opens, which is a send queue by another name.
- **A hub call that dies is a failed dial.** A chunk this build can't decode (a newer hub's new status, say) or a crashed hub handler reaches the client as a defect, not an error. `HubCallDefected` names it in the calls' error union, so the link shows the hub unreachable, logs why and keeps retrying, instead of freezing with no banner. A defect anywhere else in the link fails its change stream, so the app's error screen shows it.

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

Phone opens a chat

```
phone WatchTranscript{machine, pane, from} ──▶ hub TranscriptRelay: new watch, cursor = from
  ──▶ TranscriptDemands (whole set) ──▶ agent TranscriptStreams starts the watch
agent ── PublishTranscript{watch, Opened | Chunk} ──▶ hub: continues the cursor? ──▶ phone
                                                     └── no: TranscriptOutOfStep{expected} ──▶ agent restarts there
agent reconnects ──▶ TranscriptDemands carries each cursor ──▶ tails resume, phone stream unbroken
phone leaves ──▶ watch removed ──▶ TranscriptDemands without it ──▶ agent interrupts the tail
```

## 5. Build, run, ship

- Agent and hub: `bun build --compile` per target; the hub embeds `@crook/web`'s build output.
- Agent runs as a systemd user unit (`crook-agent.service`), installed by `crook-agent install-service` or the plugin's "connect" action.
- Hub runs as a systemd unit on its own exe.dev VM.
- Releases from CI with actions pinned by SHA and signed artifacts.
- Locally, the web app talks to a real hub through Vite's dev server: with `CROOK_DEV_HUB_URL`, `CROOK_OWNER_EMAIL` and `CROOK_HUB_ORIGIN` set, `bun run dev` proxies `/rpc/client` and `/health` to that hub, and `bun run preview` does the same so a production build runs under the CSP against it. On the socket it adds the `X-ExeDev-Email` and `Origin` the exe.dev proxy would send, and only when the upgrade's `Host` is a loopback name (`localhost`, `127.0.0.1`, `[::1]`) and its `Origin` is that same host and port: browsers let any page open a WebSocket to localhost, and a proxy that vouched for every upgrade would walk a stranger's page past the hub's Origin check as the owner. Matching `Origin` to `Host` alone is not enough, since a DNS-rebound page sends both under its own name, and Vite's `allowedHosts` does not cover a proxied upgrade. A refused upgrade is still forwarded, bare, and the hub answers it with 403. `/health` gets no headers, since the hub needs none there. It is dev tooling in the Vite config only; nothing in the app knows about it. The hub needs no local mode for it.

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
