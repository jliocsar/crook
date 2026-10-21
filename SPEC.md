# crook — SPEC (draft v0)

Status: planning. Nothing built yet. Last updated 2026-10-16 (v0.4: moved into the crook repo; signing dropped; Effect decided; architecture in ARCHITECTURE.md).

A realtime, mobile-first client for driving Claude Code agents that run inside Herdr, across several machines, from an iPhone. Installed as a PWA (home screen), served from an exe.dev VM.

---

## 1. Problem

Today: SSH from the phone into the laptop, attach Herdr's TUI, drive Claude through a terminal on a touchscreen. Special keys are painful, output is a scraped screen, there's no "which agent needs me" view, and remote exe.dev boxes are one more hop.

Wanted: a native-feeling chat UI (Claude Code desktop / Codex desktop style) plus the Herdr sidebar as a navigable list, organized by machine → workspace → tab → agent, with live status.

## 2. Goals / non-goals

Goals

- G1. Realtime. State changes (working → blocked → done) show on the phone in well under a second while the app is open. No polling loops for state.
- G2. Machines are first-class. Laptop + each exe.dev VM appear side by side; one machine going offline never degrades the others.
- G3. Chat, not terminal. Agent panes render as a conversation (user turns, assistant prose, collapsible tool calls, diffs), sourced from Claude's own transcript, with a terminal fallback view one tap away.
- G4. Answer agents fast. Blocked approvals / `AskUserQuestion` become tappable cards. Esc / Ctrl+C one thumb away.
- G5. Notifications when an agent blocks or finishes, while the phone is locked, via Hark: a lock-screen Live Activity for the herd, approve/deny for permission prompts, plain dismissable notifications for the rest. No tap-to-open (D16).
- G6. Lean on Herdr. Use its socket API for structure, status, input; ship the per-machine piece as a Herdr plugin where it fits.
- G7. Single user (me). Safe enough to run on a work laptop.

Non-goals (v1)

- Multi-user / teams / sharing.
- App Store. It's a PWA.
- Agents other than Claude Code (design so codex/pi adapters can slot in later, but don't build them).
- Editing files, running arbitrary shells from the phone (beyond what an agent pane already allows).
- Replacing the Herdr TUI.
- Phone talking to a machine directly when the hub is down. Hub down = app down.
- Multiple Herdr sessions per machine. One session per machine (the default socket).
- Voice input beyond the system keyboard. Already covered by another app.

## 3. What we already know

### 3.1 Herdr (docs v0.9.5; laptop client 0.9.4, server 0.9.1)

Transport

- Newline-delimited JSON over a **local Unix socket** only: `~/.config/herdr/herdr.sock` (named sessions: `~/.config/herdr/sessions/<name>/herdr.sock`). No TCP, no auth. Anything remote needs a bridge on the host.
- Full protocol schema from the binary: `herdr api schema --json`.

State we can read

- `session.snapshot` — one-shot bootstrap: workspaces, tabs, panes, layouts, agents, focused ids.
- `events.subscribe` — long-lived stream: `workspace.*`, `tab.*`, `pane.created/updated/closed/moved/exited/agent_detected/agent_status_changed/scroll_changed`, `layout.updated`, `worktree.*`.
- Recovery contract (from docs): subscribe first, wait for `subscription_started`, then `session.snapshot` on a second connection; treat events as invalidation, not replayable deltas. On `events_lost` the server closes the subscription → resubscribe + re-snapshot.
- Agent record fields seen live: `agent` (`claude`), `agent_status` (`idle|working|blocked|done|unknown`), `pane_id`, `tab_id`, `workspace_id`, `cwd`, `foreground_cwd`, `terminal_title_stripped` (= Claude's session title, e.g. "EX-253 Example feature"), `state_change_seq`, `revision`, `focused`, optional `agent_session` {source, agent, kind, value}, optional `tokens`.
- `done` = idle and not yet seen. Reads don't mark seen; focus commands do. Seen means the agent's tab became the focused tab, whichever pane of it has focus; an agent that finishes in the focused tab goes straight to `idle`, and `done` to `idle` leaves `state_change_seq` unchanged (measured on 0.9.5, see ARCHITECTURE 2.1).

State we can change

- `agent.prompt` (text + Enter, bracketed-paste aware, optional server-side wait), `agent.send_keys` (`esc`, `ctrl+c`, arrows…), `agent.start` (needs an existing idle shell pane), `pane.split`, `tab.create`, `workspace.create`, `worktree.create`, `agent.rename`, `pane.close`.
- `agent.read` / `pane.read` with sources `visible | recent | recent-unwrapped | detection`, text or ansi. Claude runs on the alternate screen, so scrollback from the terminal is not recoverable → transcript must come from Claude's files.
- `pane.report_metadata` / `workspace.report_metadata` — we can push display tokens back into Herdr's own sidebar (e.g. "📱 watching").

Machines

- `herdr machine list --json` on the laptop lists saved SSH profiles (today: `work-vm`, `work-vm-two` on exe.dev). Each machine runs **its own Herdr server**; IDs (`w1:p1`, agent names) are only unique per server.
- `herdr --machine <label> <cmd>` runs CLI commands remotely over SSH. Unclear whether long-lived `events.subscribe` works through it → assume no; run our own daemon on each machine.

Plugins

- `herdr-plugin.toml` manifest: `[[startup]]` hooks, `[[actions]]`, `[[events]]` hooks, `[[panes]]`, link handlers. Installable from GitHub via `herdr plugin install`. Plugins get `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`, `HERDR_PLUGIN_STATE_DIR`, etc.
- **Startup hooks are one-shot, not supervised daemons.** Docs: "A hook should restore plugin-owned state, call any required Herdr APIs, and exit" and "Plugins must stop detached background processes before their parent command or pane exits." → the long-lived bridge can't live _inside_ the plugin cleanly. The plugin is the installer/control surface; the daemon is a systemd user service (see §5.2).

Claude integration

- `herdr integration install claude` installs a `SessionStart` hook that reports Claude's session id to Herdr → shows up as `agent_session` on the agent record. That's our pane → transcript mapping.
- On the laptop the integration is **current (v10)** but `agent_session` is `null` on every live agent. Suspects: server is 0.9.1 (older than client), or those sessions started before the hook. **Spike S4.**

### 3.2 Claude Code

- Transcripts: `~/.claude/projects/<cwd-slug>/<session-id>.jsonl` (or under `CLAUDE_CONFIG_DIR`). Append-only JSONL: user turns, assistant messages, tool_use / tool_result blocks.
- Many panes share one cwd (laptop has ~8 Claude panes in `hapana-gcp`), so "newest jsonl in the cwd dir" is ambiguous. Need the session id from `agent_session`.
- Hooks (`SessionStart`, `PreToolUse`, `Notification`, `Stop`, …) can feed structured events. Possible source for structured approval requests instead of screen parsing. **Spike S5** (confirm which hook gives the pending permission payload).
- Heuristic worth testing: when Herdr says `blocked`, the last `tool_use` in the transcript without a matching `tool_result` is what's being asked.

### 3.3 exe.dev

- Every VM gets `https://<vm>.exe.xyz/` with TLS. Ports 3000–9999 also proxied (`https://<vm>.exe.xyz:<port>/`), private only.
- **Private by default**: users must log into exe.dev; the proxy injects `X-ExeDev-UserID` and `X-ExeDev-Email`. Public mode is opt-in per VM.
- **VM bearer tokens**: `ssh exe.dev ssh-key generate-api-key --vm=<vm> --label=<x>` → send as `X-Exedev-Authorization: Bearer <token>`; the proxy authenticates and strips it, forwards `X-ExeDev-Token-Ctx` (signed). Lets machines dial _in_ to the hub without the hub being public.
- Tailscale WIF integration exists if we ever want VMs on the tailnet.
- Unknown: WebSocket support through the proxy. **Spike S1.**

### 3.4 iOS PWA

- Home-screen PWAs support Web Push (iOS 16.4+), but crook doesn't use it: notifications go through Hark (D16). iOS can't open a link into an installed PWA, so no notification can land the user in crook.
- iOS suspends the PWA in the background: WebSocket dies when the app isn't foregrounded. Realtime = while open; Hark = while closed. Reconnect + resync on `visibilitychange`.
- Standalone PWAs have their own cookie jar, separate from Safari. A cross-origin login redirect (exe.dev login) may not land the cookie in the PWA. **Spike S2** — this decides the auth design.

### 3.5 Prior art: ColliePWA (github.com/AltanS/collie, MIT)

Already a Herdr mobile PWA. Audited 2026-10-16: careful security (loopback bind, 32-byte hashed pairing tokens, host allowlist, same-origin writes, argv-only shell-outs), but polling instead of realtime, one instance per machine with "crews" for multi-machine, PWA served over Tailscale, single heavily AI-written codebase moving very fast.

Worth borrowing (MIT, credit it):

- Claude transcript adapter: `bridge/journal/claude.ts`, `bridge/journal/tool-call.ts`.
- Prompt/approval detection over pane text: `web/src/lib/blocks.ts`.
- "latest reply repairs the mirror" trick: `web/src/lib/latest-reply.ts`.
- Its herdr plugin manifest: `herdr-plugin.toml`.

Where we differ on purpose: push-based realtime end to end; machines dial out to one hub (no crew protocol); exe.dev as the front door instead of `tailscale serve`.

## 4. Architecture

```
 iPhone (PWA, home screen)
   │  HTTPS + WSS (exe.dev private proxy, exe.dev login)
   ▼
 hub  ── https://<hub-vm>.exe.xyz        (exe.dev VM)
   │   serves PWA, merges machines, fans out events,
   │   relays commands, drives Hark
   ▲
   │  outbound WSS from each machine (VM bearer token + machine key)
   │
 ┌─┴──────────────┬──────────────────────┬─────────────────────┐
 agent@laptop      agent@work-vm   agent@work-vm-two
   │ unix socket     │                       │
 herdr server      herdr server            herdr server
   │                 │                       │
 claude panes      claude panes            claude panes
 + ~/.claude jsonl + ~/.claude jsonl       + ~/.claude jsonl
```

Why this shape

- Machines **dial out** → laptop needs no inbound port, no Tailscale on the phone, works behind NAT/coffee-shop wifi.
- One URL for the phone, one place holding the Hark token.
- Each agent is independent → G2.
- exe.dev's private proxy is the outer auth wall for both the phone and the agents.

Trust model

- The hub can type into every pane on every machine. That's accepted: the hub sits behind the exe.dev account, and whoever owns that account already owns the exe.dev VMs. The one machine outside exe.dev is the laptop; its agent-side policy (§7) is the guard there.

## 5. Components

### 5.1 Hub (exe.dev VM)

Responsibilities

- Serve the PWA (static) + manifest + service worker (app shell only).
- Phone WSS endpoint: `/ws/client`. Agent WSS endpoint: `/ws/agent`.
- Keep an in-memory merged view: `machines[id] → { status, snapshot, agents }`. Not durable; rebuilt from agents on reconnect.
- Relay commands phone → agent, results agent → phone. Correlate by request id.
- Hark (agent API, bearer token from `Config.redacted`, no webhook): one Live Activity summarising the herd (iOS allows one per device), updated on meaningful transitions only; permission prompts become approval interactions answered from the lock screen; `done` and non-approval questions become plain notifications with no `url`. Answers are read by long-polling the interaction (callbacks can't reach a private exe.dev VM) and routed like any other command. A notification is withdrawn and a pending interaction cancelled as soon as the observed state moves on (answered in the terminal, seen in crook). Payload = machine label + workspace label + agent title + tool name. No pane content, no transcript text.
- Persist (small, on disk): open Hark notification / interaction / activity ids, machine registry (machine id, label, last seen, forgotten flag), seen marks (per pane, so a restart doesn't bring back every opened agent as "needs you"), audit log.
- Stale machines: a machine whose agent stops connecting shows as offline with "last seen". Swipe to forget removes it from the herd; it reappears on its own if its agent ever connects again. No automatic exe.dev API lookups (the hub holds no exe.dev API token).
- Auth: see §7.

Not responsibilities: no terminal emulation, no transcript storage or cache in v1 (pure stream-through: phone opens a chat → hub asks the agent → agent reads from disk), no direct access to any Herdr socket.

Hosting: its **own exe.dev VM** (e.g. `my-hub`), nothing else on it. Smaller blast radius than co-locating with a dev box.

### 5.2 Agent (one per machine)

A small daemon, run as a **systemd user service** (`crook-agent.service`), installed and managed through a Herdr plugin.

Responsibilities

- Herdr side: one subscription connection (`events.subscribe`, lifecycle types plus one `pane.agent_status_changed` entry per agent pane) + a fresh connection per request (Herdr closes after each answer, measured). Bootstrap with `session.snapshot`; follow the docs' recovery contract on `events_lost` and on socket reconnect (Herdr server restarts/updates).
- Hub side: one outbound WSS to the hub, auto-reconnect with backoff, sends `hello` with machine id, versions, capabilities.
- Normalize Herdr records into protocol types (§6). Compose global ids: `<machine_id>/<pane_id>`.
- Transcripts: for each Claude agent with `agent_session`, locate `<claude_root>/projects/*/<session_id>.jsonl`, tail it (fs watch + offset), parse into messages, stream deltas to subscribed phones only (subscription is per-pane, opened when the chat screen is open).
- Approvals: when an agent goes `blocked`, build a structured `Ask` from (a) Claude hook payload if available, else (b) last unmatched `tool_use` in the transcript, else (c) `agent.read --source detection` + pattern parse. Always attach raw screen text as fallback.
- Execute commands: prompt, send_keys, answer ask, start agent, new tab/worktree, rename, close. Enforce local policy (§7) before touching Herdr. Commands carry an idempotency key; a retried command is not executed twice.
- Optionally write `pane.report_metadata` tokens back into Herdr (e.g. show in the TUI sidebar that the phone is attached).
- Seen: when a phone opens an agent's chat, the hub marks that pane seen at its current `state_change_seq`; a later transition makes it unseen again. Herdr's own Done badge is left alone, because its only way to mark seen is a focus command, which jumps every attached TUI to that pane (D12, S8).
- One Herdr session per machine: always the default socket (or `HERDR_SOCKET_PATH`). Named sessions are out of scope for v1.
- Config: `HERDR_SOCKET_PATH` (or default), Claude roots (comma list, default `~/.claude`, honor `CLAUDE_CONFIG_DIR`), hub URL, exe.dev VM token for the hub VM (its signed `ctx` carries the machine id), label.

The Herdr plugin (`herdr-plugin.toml`)

- `[[startup]]`: ensure the user service is running (`systemctl --user start …` / `launchctl` on macOS), then exit.
- `[[actions]]`: "Connect to hub" (asks for hub URL + token, writes config + service unit), "Crook status", "Restart crook agent".
- `[[panes]]`: small status TUI (overlay/popup).
- Install path: `herdr plugin install <github-repo>` → run "Connect to hub".
- Open question: whether to skip the plugin entirely and ship a one-liner installer. Plugin wins on discoverability inside the TUI; costs little.

### 5.3 PWA (iPhone)

Navigation: a tab bar with **Agents** (home, the herd), **Machines** and **Settings**, shown on those three root lists only. Everything else is a screen pushed over them, with an edge swipe back. The look is in `DESIGN.md`.

Screens

1. **Home / Herd** — the sidebar, mobile-shaped.
   - Top: "Needs you" section (blocked first, then done-unseen), across all machines.
   - Then grouped: Machine (online/offline/reconnecting badge) → Workspace → agents (tab as a chip on the row).
   - Row: status dot (idle/working/blocked/done/unknown), title (`terminal_title_stripped`), workspace/branch, time since last state change, machine chip when collapsed.
   - Pull to resync. Long-press: rename, close, pin.
   - Live: rows move/re-color as events arrive.
2. **Agent chat**
   - Transcript rendered as chat: user bubbles, assistant markdown, tool calls collapsed by default (name + one-line summary, expand for input/output), diffs with syntax highlight, images.
   - Live tail while `working` (streaming indicator from Herdr status; message text arrives as transcript lines are appended).
   - Ask card pinned above the composer when `blocked`: header, command/diff, buttons (Yes / Yes always / No / options from AskUserQuestion).
   - Composer: plain textarea (system dictation works), send button, key strip (Esc, Ctrl+C, ↑, ↓, Tab, Enter), slash-command shortcuts.
   - No terminal view: the chat is the only view of an agent.
3. **Machines** — one card per machine: label, connection badge, agent counts, crook agent and Herdr versions, "update agent" when the agent is older than the hub. A pushed machine screen lists its agents and its details. An offline machine can be forgotten from here (swipe, or hold to forget on its screen).
4. **New agent** — the task comes first; machine, folder and branch (or a new worktree) are defaults you can change, starting from the most recent place. Uses `workspace.create`/`worktree.create`/`tab.create` + `agent.start`, then the task as the first prompt.
5. **Settings** — notifications on/off per event type, stored on the hub so every device shares them, with a test notification; Account (the exe.dev email, log out); the hub's status, address and version.

Behavior

- One WSS to the hub while visible. On `visibilitychange` → visible: reconnect, request fresh merged snapshot, reconcile.
- Cache last snapshot in IndexedDB for instant paint (render dimmed + "syncing" until fresh).
- Service worker: app shell caching only. No push, no notification click.
- Outside a Home Screen app, an install screen shows the Add to Home Screen steps for iOS Safari and Chrome, with "Continue in browser".

## 6. Protocol

Effect RPC over WebSockets, NDJSON serialization. Two RPC groups, both defined once in `@crook/protocol` and shared by agent, hub and PWA. The shapes, the message flow and the reasons are in `ARCHITECTURE.md` §4.

Invariants that hold whatever the shapes end up being:

- Machine state travels as **whole values**, never as replayable events (Herdr's own contract: events invalidate, reads are authoritative).
- Transcripts travel as **offset-addressed appends**, so a reconnect resumes from an offset instead of refetching.
- Every command carries an **idempotency key** minted on the phone; a retry never prompts an agent twice.
- A command's success is confirmed by **observed state** (status leaves `blocked`), not just by an ack.
- Global pane id = `<machine_id>/<herdr pane id>`; machine id comes from the exe.dev token `ctx`.

## 7. Security

Threats: lost/stolen phone (exe.dev session); someone else with exe.dev access to the hub VM; malicious web page in the phone browser; other local processes on a machine; supply chain. Out of scope: exe.dev account takeover (that already owns the VMs).

Layers

1. **Outer wall: exe.dev private proxy.** Hub VM stays private. Phone authenticates via exe.dev login; agents via VM bearer tokens. Hub additionally checks `X-ExeDev-Email == <me>` on every request (defense if VM sharing is ever widened).
2. **No device pairing, no command signing** (D4). The exe.dev session is the boundary.
3. **Machine identity** comes from the exe.dev VM token's signed `ctx`, never from anything the agent claims in its own messages.
4. **Agent-side policy.** Default allowlist: prompt/keys only to panes that currently host a recognized agent; `start` only for configured kinds; no raw shell text to plain shell panes unless explicitly enabled per machine.
5. **Web hygiene.** Strict CSP, sent by the hub as a response header (the policy is in `ARCHITECTURE.md` §2.7; a meta tag can't carry `frame-ancestors`). No `innerHTML` for transcript content, sanitize markdown, same-origin checks on WSS upgrade (Origin header), no CORS.
6. **Hark payloads** carry labels only, no content: Hark is a third party.
7. **Audit log** on each agent (local) and hub: who/when/op, truncated args, configurable redaction. The agent appends JSONL per command it ran; the hub keeps an append-only SQLite table of the phone's commands, pins and forgets, keyed to the agent's lines by the idempotency key. Prompt text is redacted on the hub by default and kept on the agent, beside the transcript that already holds it (`ARCHITECTURE.md` §2.5, §2.6).
8. **Supply chain.** Few deps, lockfile committed, pinned CI action SHAs, signed release artifacts (minisign/cosign) checked by the installer and plugin update path. No auto-update.
9. Lost phone: log out of exe.dev sessions; nothing device-specific to revoke.

Accepted risks (v1): the hub sees everything agents send (transcripts, screens). The agent socket on each machine is only as safe as that user account.

## 8. Stack

TypeScript + Bun throughout so the protocol types are shared. Monorepo with Bun workspaces. Package layout and design patterns: see `ARCHITECTURE.md`.

### 8.1 PWA (`packages/web`) — decided except state

- React 19 + Vite + TypeScript, Tailwind v4.
- **UI: Mischief UI** (ui.tinkererslabs.com, MIT). shadcn registry on Base UI + Tailwind tokens. Install components with the shadcn CLI so the source is **copied into the repo** (we own it). Don't depend on the `mischief-ui` npm package: the project is small and young (4 stars, created 2026-08, last push 2026-09).
  - Components we'll use: Conversation, Message, Response, Prompt Input, Tool Call, Thinking State, Questionnaire (AskUserQuestion), Code Block, Diff View, Status Pill, Hold Button (destructive confirms), Empty State, Skeleton, Side Panel, Command Palette, Kbd, Agent Checklist (TodoWrite), Subagent Tree (Agent tool). Each is copied in by the ticket that first uses it.
- **Markdown:** Mischief's Response already uses `react-markdown` + `remark-gfm`. It renders to React elements (no `innerHTML`), which keeps the CSP strict. Transcript messages land whole from the jsonl (no token streaming), so the cost is one parse per message, memoized. Revisit (`streamdown` / `markdown-to-jsx`) only if long threads are slow.
- **Highlighting: Shiki**, wired into Code Block via Response's `renderCode` and into Diff View lines. Use `codeToHast` + `hast-util-to-jsx-runtime` (React elements, no `innerHTML`) and the **JavaScript regex engine** (no Oniguruma WASM, so no `wasm-unsafe-eval` in the CSP). Fine-grained bundle, small language set, lazy-loaded.
- **Diffs:** Diff View fed from Claude's Edit/Write/MultiEdit tool inputs (`old_string`/`new_string`), or `hunks` when we have a real patch.
- **Motion** (`motion`) for every animation: springs for gestures and pushes, Mischief's motion tokens for tweens (`DESIGN.md`).
- **TanStack:** Router with file-based routes (typed routes `/m/$machine/p/$pane`), Virtual (long transcripts), Query only if a plain HTTP endpoint ever appears (everything goes over Effect RPC today).
- **State:** Effect atoms, see §8.3.
- PWA plumbing: `vite-plugin-pwa` (injectManifest, our own service worker for the app shell), `idb-keyval` for the offline snapshot cache.
- **Manifest and install:** a `standalone` manifest (`crook`, light background, no orientation lock), linked with `crossorigin="use-credentials"` so the exe.dev proxy's cookie goes with it. The wordmark icon and per-theme startup images are generated at build time. The install screen and the Hark notification and Live Activity copy are in `DESIGN.md` (Outside the app).

### 8.2 Hub + agent — Effect v4

- Bun runtime, `bun build --compile` single binaries (linux-x64, linux-arm64, darwin-arm64).
- **Effect v4** (repo boilerplate: oxc + TypeScript 7 + `@effect/tsgo`): the agent is mostly reconnect/backoff, long-lived streams (herdr events, file tails, hub socket), scoped resources and typed errors, which is Effect's sweet spot. `@effect/platform-bun` for sockets/fs/http; Effect `Schema` for every wire type (shared with the PWA, so watch bundle size).
- Hub: `bun:sqlite`, Hark agent API over Effect `HttpClient`, static PWA embedded in the binary.
- Agent: systemd user unit; launchd later.

### 8.3 PWA state

Effect atoms end to end. See `ARCHITECTURE.md` §3.7.

## 9. Decisions

| #   | Decision                                                                                                                                   | Status                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| D1  | PWA, not native iOS                                                                                                                        | decided (no Mac, no App Store, Hark covers alerts) |
| D2  | Hub on its own exe.dev VM, machines dial out                                                                                               | decided                                            |
| D3  | Per-machine daemon as systemd user service, managed by a Herdr plugin                                                                      | proposed (startup hooks aren't daemons)            |
| D4  | No device pairing or command signing; exe.dev login is the boundary                                                                        | decided                                            |
| D5  | Transcript from Claude jsonl via `agent_session`, terminal as fallback                                                                     | proposed                                           |
| D6  | Stack: TypeScript everywhere, Bun runtime, shared protocol package (§8)                                                                    | decided                                            |
| D7  | PWA: React 19 + Vite + Tailwind v4 + Mischief UI (copied in via shadcn) + Shiki + TanStack                                                 | decided                                            |
| D13 | PWA state: Effect atoms (`@effect/atom-react`), no XState                                                                                  | decided                                            |
| D14 | Hub + agent built on Effect v4, wire protocol on Effect RPC                                                                                | decided                                            |
| D15 | Stale machines: offline badge + swipe to forget, auto-return on reconnect                                                                  | decided                                            |
| D8  | Claude only in v1, adapter seam for others                                                                                                 | proposed                                           |
| D9  | If exe.dev login doesn't work in a standalone PWA (S2), the phone joins via Tailscale instead                                              | decided                                            |
| D10 | No transcript cache in the hub (v1)                                                                                                        | decided                                            |
| D11 | One Herdr session per machine (v1)                                                                                                         | decided                                            |
| D12 | Seen is tracked by crook (hub, per pane, via `state_change_seq`), never by calling Herdr focus; Herdr's own Done badge is left alone       | decided (S8)                                       |
| D16 | Notifications via Hark's agent API; Web Push dropped; notifications never open crook, they're dismissable and the user opens crook by hand | decided (S3)                                       |

## 10. Spikes (do before M1)

| #   | Question                                                                                                                                           | How                                                                                                          | Unblocks                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| S1  | Do WebSockets work through the exe.dev proxy (browser cookie auth and `X-Exedev-Authorization` bearer)? Idle timeouts?                             | 30-line Bun WS echo on the hub VM, hit it from phone + laptop                                                | D2, whole transport                                  |
| S2  | Does exe.dev login work inside an iOS standalone PWA (cookie lands in the PWA jar, survives relaunch)?                                             | Install hub page to home screen, log in, kill app, reopen                                                    | auth design; fallback = Tailscale for the phone (D9) |
| S3  | Web Push from the hub to the iPhone PWA                                                                                                            | VAPID + `web-push`, trigger from curl                                                                        | G5                                                   |
| S4  | Why is `agent_session` null on the laptop?                                                                                                         | `herdr integration status`, server 0.9.1 vs client 0.9.4, start a fresh claude pane, check `herdr agent get` | D5                                                   |
| S5  | Structured approval payload: which Claude hook (if any) carries the pending permission? Does "last unmatched tool_use" match what the dialog asks? | Small hook that logs payloads; compare to screen                                                             | Ask cards                                            |
| S6  | Does `events.subscribe` stay healthy for hours; what do Herdr server restarts/handoffs look like to a subscriber?                                  | Run a subscriber overnight, `herdr update --handoff`                                                         | agent reconnect logic                                |
| S7  | Claude jsonl format stability, partial-line writes, compaction/`/clear` behavior (new session id?)                                                 | Tail a few live sessions                                                                                     | transcript tailer                                    |
| S8  | Does `agent.focus` from the API move an attached TUI client's view, or only mark seen?                                                             | Call it from a script while watching the TUI                                                                 | D12                                                  |

### 10.1 Spike results

**S4 — pane → Claude session (verified 2026-10-16).**

- Herdr server 0.9.1 supports `pane.report_agent_session`; `agent_session` is set from `agent start` onward and follows `/clear` to the new session id.
- The nulls came from panes running Claude with `CLAUDE_CONFIG_DIR=~/.claude-work`, whose `settings.json` has no Herdr `SessionStart` hook.
- Fallback that needs no hook: `pane.process_info` → pid of `claude` → `CLAUDE_CONFIG_DIR` from `/proc/<pid>/environ` (default `~/.claude`) → `<config>/sessions/<pid>.json` (`sessionId`, `cwd`, `procStart`, `status`, `updatedAt`) → `<config>/projects/<slug(cwd)>/<sessionId>.jsonl`. `procStart` matches `/proc/<pid>/stat` field 22, which guards against pid reuse. Also follows `/clear`.
- Decision: `agent_session` first, pid file second. Claude roots come from the process env, not only from config.

**S8 — seen (verified on a 0.9.5 test server; assumed same on 0.9.1).**

- `agent.focus` and `tab.focus` change the server-wide focus: every attached TUI jumps to that pane. They also mark the agent seen.
- Reads (`agent get/read/explain`, `pane read`) don't change seen.
- No mark-seen method exists in the schema; "seen" appears only as an `agent.view` filter/sort field.
- Decision (D12): crook tracks seen itself; focus is only called when the user explicitly asks to jump the desktop to a pane.

**S6 — `events.subscribe` across restarts, handoffs and slow readers (verified 2026-10-20 on a 0.9.5 probe session; overnight idle, `herdr update --handoff`, a 0.9.1 → 0.9.5 handoff and the `events_lost` wire shape not run).**

- Stop, `kill -9` and a live handoff all end the subscription with a clean EOF and no error line. A reader that stops reading is cut off the same way once its socket buffer fills; `events_lost` was never seen.
- Events carry no sequence and no heartbeat is sent. Workspace, tab and pane ids survive every restart and are never reused; `terminal_id` changes and `revision`, `state_change_seq` and `completion_seq` restart.
- A stop or crash leaves no agents; a handoff keeps the processes and herdr needs about 3 s to re-detect each agent. A real Claude (measured on 6 handoffs, after the spike) reads `idle`/0 for about 300 ms, `unknown`/1, then its status at 2, keeping `agent` and `agent_session` throughout; a `done` one comes back `idle`.
- Close events are incomplete: a tab can vanish with only its last pane's `pane_exited`.
- Decision: the agent never resumes, it resyncs from `session.snapshot` on every reconnect, with an exponential backoff from 100 ms to 5 s; seen marks are scoped to `terminal_id`; a state read over a new herdr connection is marked as a resync so notifications skip it (ARCHITECTURE §2.5, §2.6).

**S1 — WebSockets through the exe.dev proxy (partly verified).**

- WSS upgrade works with a VM bearer token in `X-Exedev-Authorization`; the upgrade request carries `X-ExeDev-Token-Ctx`.
- A token's signed `ctx` (`{"machine":"spike-laptop"}`) arrives verbatim, so machine identity via `ctx` works.
- Client-supplied `X-ExeDev-Email`, `X-ExeDev-UserID` and `X-ExeDev-Token-Ctx` are overwritten by the proxy: they can't be spoofed through it.
- No proxy idle timeout within 15 minutes: an idle connection and ones ticking every 20s and 55s all stayed open for 900s and closed cleanly with 1000.
- Browser-cookie WSS works from iOS Safari and iOS Chrome; the upgrade carries `X-ExeDev-Email` and no ctx.
- A backgrounded page loses its socket (1006), so the PWA resyncs on `visibilitychange`.

**S2 — exe.dev login in the installed PWA (verified by hand, 2026-10-17).**

- Logging in to exe.dev from the home-screen app works and stays logged in after force-quitting and reopening it.
- The spike page's own report never logged a standalone load, so this rests on the user's check, not the server log.
- D9's Tailscale fallback isn't needed.

**S3 — notifications (resolved by replacing Web Push with Hark, 2026-10-17).**

- Web Push was never exercised: every iPhone load was a browser tab, where `Notification` doesn't exist.
- Hark's agent API delivers to the iPhone (`POST /api/agent/notifications` → `accepted: 1`, received).
- Tapping a Hark notification opens its URL in the default browser (Chrome), never the home-screen PWA. Hark web apps (`appId`) also opened in Chrome. iOS offers no way to open a link into an installed PWA.
- Hark callbacks need a public URL and the exe.dev proxy is private, so answers come from long-polling `GET /api/agent/interactions/:id/wait`.
- harkctl 0.4.3, the latest on npm, lags the docs: no `apps` command, and its default login lacked `apps:*` scopes.
- Decision (D16).

## 11. Milestones

- **M0 — spikes** S1–S8. Output: notes appended to this spec, decisions flipped to decided.
- **M1 — read-only herd, one machine.** Agent on laptop → hub → PWA home screen with live statuses. Protocol v0 frozen.
- **M2 — machines.** Agents on both exe.dev VMs, online/offline handling, merged "Needs you".
- **M3 — chat read.** Transcript rendering, live tail, terminal fallback view.
- **M4 — act.** Commands with idempotency keys, prompt, key strip, answer Ask cards.
- **M5 — notifications.** Hark: herd Live Activity, approve/deny for permission prompts, plain notifications for done and questions, withdraw on seen, per-event prefs.
- **M6 — create.** New agent / tab / worktree from the phone.
- **M7 — package.** Herdr plugin, installer, signed releases, docs.

## 12. Open questions

Nothing open right now besides the stack (D6).

Resolved in review round 1

- Q8 name → **crook**.
- Q1 hub placement → own VM (D2).
- Q2 S2 fallback → Tailscale (D9).
- Q3 direct phone → machine → no (non-goal).
- Q4 hub transcript cache → none (D10).
- Q5 mark seen → crook tracks it itself; Herdr focus would yank the desktop view (D12, S8).
- Q6 named sessions → one session per machine (D11).
- Q7 voice → skip (non-goal).
