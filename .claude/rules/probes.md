---
paths:
  - "tmp/**"
  - "**/tmp/**"
  - "packages/herdr/**"
  - "packages/agent/**"
---

# Probing against real data

- An agent with a long transcript to look at in a probe needs no tokens: `herdr agent start …
  --kind claude -- --resume <session>` reopens an earlier Claude session in the pane, and the chat
  tails its file (measured in the JC-101 probe).

:::tip
Checking the web app against real data, measured:

- The agent has no entrypoint yet. A probe script composes its layers and dials the hub directly
  with the two headers the proxy would add, `X-ExeDev-Email` and `X-ExeDev-Token-Ctx` carrying
  `{"machine":"<id>"}`; the token header is then not needed. Every herdr-reading layer needs
  `HerdrClient` under it, not merged beside it.
- The hub refuses to start on a `CROOK_HUB_ORIGIN` that is not https, a local one included. Any
  https name works locally, because the Vite proxy sends that same value as the socket's `Origin`.
- `pkill -f <pattern>` also matches the shell that runs it when the pattern is in its own command
  line, and kills the call. Stop what you started by its saved pid.
- A named herdr session runs headless with `herdr --session <name> server`. From inside a herdr
  pane, unset `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID` and `HERDR_ENV`, and point
  `HERDR_SOCKET_PATH` at the named session's socket, or every command lands in the user's own
  session. Never use the default one.
- `herdr pane report-agent` puts an agent with a chosen status in any shell pane, and
  `release-agent` takes it out, so a herd in every state needs no running Claude.
  `release-agent` takes the pane id before its options, `release-agent <pane> --agent claude
  --source <name>`; options first is refused. Such a fake
  takes no keys: `agent.send_keys` answers it `agent_not_ready`, so key delivery is tested
  against scripted herdr responses instead.
- The agent takes an agent's title from the pane's terminal title before herdr's own `title`. An
  OSC 0 escape sets it, and a shell prompt resets it, so hold the pane in a long `sleep` after it.
- A browser tab shows the install screen. An init script that makes `navigator.standalone` true
  gets past it.
- Bun's `fetch` goes through `HTTPS_PROXY`. A hub started with it pointing at a local listener
  that closes every connection reaches no third party: a Hark call arrives there as
  `CONNECT hark.ryan.ceo:443` and fails as `HarkUnreachable`. That is how a hub with a Hark token
  is checked without calling Hark, whose base URL is fixed.
- Vite's dev server answers a POST to `/__exe.dev/logout` with 404, so Log out fails honestly
  there; a browser route that answers it is what reaches the logged-out screen.
- The agent has no long-running entry of its own yet, so a probe composes its layers itself. It
  exits on a config error before dialing unless `CROOK_MACHINE_ID` is set. Such a script can sit in
  the agent member's own `tmp/`, which is ignored at any depth, and Bun resolves the member's
  leaves and dependencies from there.
- A herdr server started under `env -i` with only `HOME`, `PATH`, `USER`, `SHELL`, `TERM` and
  `LANG` hands none of Claude's variables to its panes. `command claude --permission-mode default`
  typed into one skips a user's shell function that turns auto mode on, and starts in manual mode,
  so a Bash command it runs asks first (measured).
- `herdr pane report-agent --agent-session-id` does not put the id where the agent reads it: `agent get` showed no `agent_session` afterwards (measured on herdr 0.9.5). A probe that needs a pane's Claude session without a real Claude runs a copy of `sleep` named `claude` in the pane with `CLAUDE_CONFIG_DIR` set, and writes `<that dir>/sessions/<pid>.json` holding the pid, the session id and the process start time from field 22 of `/proc/<pid>/stat`, which is the pid-file route the agent resolves sessions through. A file without the pid is refused with a warning in the agent's log and the chat waits on "Loading the conversation" (measured).
- The installed agent's `run` dials `CROOK_HUB_URL` (the `/rpc/agent` path included) with its token, and a local hub wants the two exe.dev headers instead, so a probe puts a small Bun WebSocket proxy between them that adds `X-ExeDev-Email` and `X-ExeDev-Token-Ctx`.
- agent-browser scrolls an element into view before it clicks it, which moves the scroll container
  around it. A scroll position read after such a click is the tool's, not the app's.
- A finger scroll in Chromium is driven over CDP with `Input.dispatchTouchEvent` (start, a run of
  moves, end) once touch emulation is on: it scrolled the thread and its momentum played out.
  `Input.synthesizeScrollGesture` with a touch source fired `touchstart` and `touchend` and never
  scrolled it (measured). One script throttles the CPU, drives the page and reads it back over a
  single CDP connection.
- herdr keeps its plugin registry under `$XDG_CONFIG_HOME/herdr`, and plugins are global to the
  user across sessions, so a plugin is linked for a probe only with `XDG_CONFIG_HOME` and `HOME`
  pointed under the worktree's `tmp/`; the user's own registry stayed untouched (measured). Never
  link or install a plugin into the default config.
- A named session's socket must fit in a Unix socket path (108 bytes): under a deep
  `XDG_CONFIG_HOME` the server exited at once with "local socket name length exceeds capacity".
  The longest name is `herdr/sessions/<name>/herdr-client.sock`, so keep the probe's
  `XDG_CONFIG_HOME` one short directory under `tmp/`.
- A fresh herdr config opens an onboarding dialog in the first client, and its second screen
  installs agent integrations on Enter. `onboarding = false` in the probe's `herdr/config.toml`
  keeps it from opening; Escape does not close it while a popup holds the focus (measured).
- `herdr plugin install` takes GitHub shorthand only, but it clones with the `git` it finds, so a
  probe points `GIT_CONFIG_GLOBAL` at a file whose `url."file:///<bare copy>/".insteadOf` is
  `https://github.com/`, and herdr installs from a local bare copy of a branch (measured). It needs
  no running server.
- A plugin action's output reaches only herdr's plugin log (`herdr plugin log list`). A plugin pane
  or popup opens only into an active workspace, so create one first, and a popup shows only in an
  attached client: attach one inside termctrl to read and drive it.
:::
