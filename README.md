# crook

Drive the Claude Code agents running on your machines from your phone.

crook turns the Claude Code panes inside [herdr](https://herdr.dev) into a mobile chat app. You see
every agent on every machine in one list, sorted by who needs you. You open one to read its
conversation as a chat rather than a scraped terminal, send it a prompt, answer its permission
prompts and questions with a tap, and hit Esc when it goes off the rails. When the app is closed,
an agent that blocks or finishes reaches your lock screen, and a permission prompt can be approved
from there.

It is a personal tool, built for one person driving their own agents. It is not a hosted service,
and it has no accounts or teams.

## How it fits together

```
 iPhone (installed PWA)
   │  HTTPS + WebSocket, behind exe.dev's login
   ▼
 hub            one small server on an exe.dev VM: serves the app,
   │            merges the machines, relays commands, sends notifications
   ▲
   │  each machine dials out to the hub, so none needs an open port
   │
 agent ── herdr ── Claude Code panes        one agent per machine:
 agent ── herdr ── Claude Code panes        a laptop, a dev VM, …
```

- **agent** runs on every machine with agents on it. It follows herdr's socket for panes and
  statuses, tails Claude's transcript files, reads permission prompts from a Claude Code hook, and
  types into panes when you ask it to. It runs as a user service and is managed from a herdr
  plugin.
- **hub** runs on its own [exe.dev](https://exe.dev) VM. exe.dev's private proxy is the outer wall:
  the phone signs in with your exe.dev login, each agent with a VM token, and the hub also checks
  the signed-in email against yours. It embeds the web app and keeps a small SQLite file.
- **web** is the app itself, a React PWA you add to your home screen.
- Lock-screen notifications and the Live Activity go through [Hark](https://hark.ryan.ceo), and
  carry labels only, never a conversation's text. Without a Hark token the hub runs without them.

## Requirements

- herdr 0.9.5 or newer on each machine, with Claude Code running in its panes.
- Linux or macOS for the agent (x64 or arm64 on Linux, arm64 on macOS).
- An exe.dev account and a VM for the hub.
- An iPhone for the app. Any phone browser loads it, but it is designed and tested for iOS.
- Optionally, a Hark account for notifications.

## Install

Releases are compiled binaries, signed in CI with cosign. The installer checks the signature
before it installs anything and puts the binaries in `~/.local/bin` (set `CROOK_INSTALL_DIR` to
change that). Nothing updates on its own: run it again to update.

```sh
curl -fsSLO https://github.com/jliocsar/crook/releases/latest/download/install.sh
sh install.sh            # the agent
sh install.sh hub        # the hub
sh install.sh --version 0.0.13 agent hub
```

### The hub

Run `crook-hub` on the hub VM, configured through its environment:

| Variable                  | What it is                                                |
| ------------------------- | --------------------------------------------------------- |
| `CROOK_HUB_PORT`          | The port exe.dev proxies to the hub                       |
| `CROOK_HUB_ORIGIN`        | The hub's https origin, such as `https://my-hub.exe.xyz`  |
| `CROOK_OWNER_EMAIL`       | Your exe.dev email; every other signed-in user is refused |
| `CROOK_HUB_DATABASE_PATH` | Where the hub keeps its SQLite file                       |
| `CROOK_HUB_HARK_TOKEN`    | Optional. Turns on lock-screen notifications through Hark |

Then open the hub's address on your phone, sign in to exe.dev, and add it to your home screen.

### An agent

Install the herdr plugin on the machine, then run its connect action from inside herdr:

```sh
herdr plugin install jliocsar/crook/packages/agent/plugin
```

"crook: connect to hub" asks for the hub's address, an exe.dev token for the hub VM minted with
this machine's name, and the name itself. It installs and starts the agent as a systemd user
service, or a launchd agent on macOS, and keeps the token in an owner-only file. The plugin also has
status, restart and update actions.

To answer permission prompts from the phone with the call's full details, add the Claude Code hook
that `crook-agent hook-settings` prints to your Claude settings. crook never edits them itself.
Without it, crook reads prompts off the screen and the transcript, which works for most of them.

The agent reads `~/.claude` by default. Set `CROOK_CLAUDE_ROOTS` to a comma-separated list of
absolute paths if you keep Claude Code in more than one config directory.

## Security

The hub can type into every Claude pane on every connected machine, so it is only as safe as your
exe.dev account. Each agent refuses anything but prompts and keys to panes that currently run a
recognised agent, and keeps an audit log of every command it ran. The hub keeps its own audit
trail, with prompt text redacted by default. The app is served under a strict Content Security
Policy, and conversation text is never rendered as HTML.

## Development

crook is a Bun and TypeScript monorepo built on [Effect](https://effect.website) v4.

```
packages/
  domain/          ids, entities and statuses, as schemas
  protocol/        the RPC groups between agent, hub and phone
  herdr/           a client for herdr's socket API
  claude/          Claude Code transcripts, hooks and screens
  state-machine/   the shape every state machine follows, and the walker that tests them
  agent/           the per-machine daemon and its herdr plugin
  hub/             the server, which embeds the web build
  web/             the PWA: React, Vite, TanStack Router, Effect atoms
  release/         per-target compiles, the version check and the installer
  frames/          frame-by-frame checks of the app's stories, run by hand
  tsconfig/        the shared TypeScript base
```

```sh
bun install          # also points git at .githooks and patches the lint binaries
bun run typecheck && bun run lint && bun run test && bun run fmt:check
bun run stories      # every screen and state of the real app, at phone width
```

Linting is oxlint with the type-aware Effect rules from `@effect/tsgo` and the house rules from
[`@jliocsar/begone-slop`](https://github.com/jliocsar/begone-slop); formatting is oxfmt; the
compiler is TypeScript 7. The git hooks format, lint and typecheck on commit, and on push run the
whole lint and the tests your commits can reach.

Further reading:

- [`SPEC.md`](SPEC.md): what crook is for, the decisions behind it and what was measured first.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): how the code is laid out and the patterns it follows.
- [`DESIGN.md`](DESIGN.md): how the app looks and moves.
- [`AGENTS.md`](AGENTS.md) and [`.claude/rules`](.claude/rules): the conventions, invariants and
  measured facts that coding agents work from.
