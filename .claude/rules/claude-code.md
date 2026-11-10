---
paths:
  - "packages/claude/**"
  - "packages/agent/**"
---

# Claude Code

What Claude Code writes and does, read off real transcripts, pid files and probes.

- Claude Code writes a session's jsonl one entry per content block, each carrying the API message
  id, but only once the whole message has finished: over three messages of one session (Claude
  Code 2.1.309 in a TUI pane, the file polled every 10 ms) every write held whole messages. A
  text block and the tool_use after it landed in one write about 585 ms after the text's own
  timestamp, the text's line already holding the message's final `stop_reason`; a 2202-character
  answer landed as one line about 9 s after its request, 118 ms after its stamp; no write ever
  left a partial line. Nothing can stream text to the phone, so the chat reveals each landed
  batch instead of pretending to type it.
- Claude Code always says in the transcript that a turn is over. Over 60 local transcripts, 559 of
  the 569 turns that got an answer ended with a `turn_duration` system entry, an assistant entry
  whose stop reason is not `tool_use`, or an interruption, and the other 10 were still running
  (measured). `turn_duration` alone was in 549 of all 728 turns, unanswered ones included, and the
  answer's own line carries its final stop reason, so the end lands with the answer. The Working row
  therefore leaves on that evidence when it is stamped after herdr's flip to working (both stamps
  come from the laptop's clock), and stays after herdr goes idle while the turn is still open in the
  transcript. With herdr's idle flip reaching the phone before the answer, the row used to leave on
  the flip and the answer land on its own afterwards; now both change in one frame (measured in
  Chromium at 4x CPU throttling).
- A compaction someone typed ends its turn, and an automatic one does not. Over 48 compact boundaries in local transcripts, none of the 34 `manual` ones was followed by an assistant line (28 by a user line, 6 by nothing), and 10 of the 14 `auto` ones were (the other 4 by a user line). Before a manual boundary counted as the end, a typed `/compact` left the turn open for good: the Working row stayed after herdr went idle, beside Send, for 359 to 362 frames, until its story ran out (measured in Chromium at 4x CPU throttling).
- A Stop hook that blocks turns an answer that looked final into the middle of a turn, and only its feedback says so. Over the newest 500 main and 500 subagent transcripts of both Claude roots there were 179 blocks, all in main transcripts, each after an `end_turn` answer and each written as a meta user string opening `Stop hook feedback:`; no other meta line in the newest 200 named a hook at its start. The summary after it reads `preventedContinuation: false` on a block too, its `hookErrors` also lists a hook that only failed, and the `hook_blocking_error` attachment that sat beside all 179 was written for none of 17 blocks on a real Claude Code 2.1.318. So the feedback line is what the agent reads, and it marks the line with one optional key, rather than a new block or an origin of crook's own among Claude's. An older phone drops the key and hides it as the meta line it was, and from an agent too old to mark it the turn reads as it always did (both held by tests).
- Before this the row left on the first answer and came back only if a tool call landed. On a real Claude and herdr 0.9.5, three runs with one Claude each, herdr read working and the pid file busy through every block, so nothing but the transcript could tell, and a loop of plain answers read `done` beside Send until herdr's idle: 13304 ms over 9 blocks (replayed through the fold, not watched on a phone). Locally the next assistant line landed 817 to 199034 ms after the answer, a median of 2826 and a 90th percentile of 7509, over 176 blocks.
- The row still leaves on each answer and comes back with the feedback, at the turn's own start, so Send shows for the length of the hook. That was 224 to 284 ms behind a hook sleeping 0.2 s, 427 and 444 ms behind 0.4 s, and 3035 to 3054 ms behind 3 s on a real Claude (all measured), and 29 to 4801 ms locally, a median of 579 and a 90th percentile of 1775. Under 400 ms that reads as a flash: a story with a gap of 250 ms showed Send and `done` for 13 frames, 219 ms, and in a later count 77 of 186 local gaps sat under 400 ms and 56 under 250 (measured in Chromium at 4x CPU throttling, and read off the transcripts). A real link's mailbox may join an answer and its feedback while a message is out (reasoned, not measured). The story plays gaps of 600 ms, about that median, and no baseline accepts the shorter one, which stays open. Waiting for the turn duration on every turn was the other way to close it. It lands 19 to 21255 ms after an answer, a median of 185 and a 90th percentile of 1358 over 3013 turns of the newest 200 main transcripts, and it would part the row from the answer on all of them, where the same 200 transcripts held 162 blocks, so it stays.
- Claude Code runs the hook a ninth time and then overrides it: 8 continuations, then the ninth feedback, the summary, an `informational` notice saying it blocked 9 consecutive times, and the turn duration, all in one write, with herdr's idle 171 ms after it (measured once, with tools off so none reset the count). The loop adds no state to the activity machine, only the same two arrows again, so a test folds the real run through them. A model with tools can leave the loop by itself: one run reached a permission prompt after six blocks.
- One block of 177 had no answer and no end after it, only the user's next prompt 102 s later (its cause not found). A chat watching that would hold the Working row after herdr's idle until that prompt, as it does for any turn left open with no answer; a chat opened on it reads idle (reasoned from the fold).
- A hook's words go to Claude, not to the user, and they run long: 228 to 73993 characters, a median of 748 and a 90th percentile of 3894, 3 to 409 lines. So a block is one quiet line that folds its words away, never a bubble, and it stays a row because without it a second answer lands with nothing saying why Claude went on. The line says the hook blocked the stop rather than that Claude went back, since the ninth does not send it back.
- Who sent a prompt is on its transcript line, in `origin.kind`, `turnOrigin` and `promptSource`, and the first of the three a line carries decides: `human`, `typed`, `queued` and `suggestion_accepted` mean the user, anything else does not, and a line with none reads as the user's, which is every older Claude and every subagent's first prompt. Two lines saying `origin.kind: human` with `promptSource: sdk` read as the user's because of that order. A line nobody typed used to read as the user's own bubble. Over the newest 500 main and 500 subagent transcripts of both Claude roots, 1371 files, that was 28 plugin lines, all carrying the plugin's name in `origin.name` and 17 also in `pluginPrompt`, 58 script prompts and 12 script commands (`sdk`), and 266 scheduled commands (measured through the real parser). Scheduled fires in words, 347 of them, are meta and never showed, and each of the 613 fires writes a notice of its own. Peer messages (1140) and coordinator messages (23) are meta too, and queued ones (249 peer, 25 coordinator) never parsed into a row.
- It travels as one optional key holding the kind and any name, set only on a line that shows as a prompt. An agent too old to send it and a phone too old to read it both show the bubble as before. The kind stays a plain string: a new kind as a literal would fail to decode on an older phone, and a message that will not decode reaches every live request on the socket (reasoned from the entry on RPC failures, not measured). A kind this build has no word for reads "Not typed by you".
- A prompt nobody typed still opens a turn: all 28 plugin lines came after a `turn_duration` and all 28, like all 58 script prompts, were followed by an assistant line, a median of 3562 ms later for plugins (measured). So every check of where a turn starts goes on counting it, and only what reads a line as the user's own changes: it does not end a send's wait, where a plugin's line landing first used to take a sent prompt's row away, and it does not end the summary of finished background work, which a user's prompt ends because the user moved on.
- A plugin's words run 519 to 3197 characters, a median of 1130, most of them instructions to Claude around whatever it carries, an Inbox reply's words among them (measured). So a prompt nobody typed is one quiet line naming its sender that folds its words away, as a hook's feedback does, and a caption under a bubble was left out: the shape is what says "you", and the caption of a long bubble sits a screen below its top (reasoned, not measured). A command keeps its one line and its output, with the sender in front of its name in place of the bubble. A scheduled command's arguments ran to 4 characters and a script's to 7128, a median of 31 (measured), so a script's long one wraps; how often a phone opens a script's session is not measured. All those commands were skills (266 and 12), none a `/clear` or `/compact`, whose rows still answer a slash send's wait whoever sent them, and none of the 86 prompts held a picture, so one that did would fold to its sender's name alone (reasoned).
- A background task that finishes while Claude is busy reaches the transcript as an `attachment`
  entry of type `queued_command` whose `commandMode` and `origin.kind` are `task-notification`,
  carrying the same `<task-notification>` text a `user` entry carries when Claude was idle. A
  subagent's meta does not always get `finished`: of 31 local metas without it, 30 were
  background runs, every one had a notification for its tool use in its session's transcript,
  and 14 had it only as such an attachment (measured on the laptop). A subagent's own transcript
  does not say it ended either: 53 of 88 finished background subagents ended on a tool result,
  as one mid-run does. So the agent decides each subagent's status from its meta and the last
  notification naming its tool use anywhere in the session file, and sends that in the roster;
  the phone takes the roster's outcome before anything it infers from the lines it holds.
- Scanning a whole transcript for notifications parses only the lines that carry the tag: a
  118 MB transcript of 24363 lines took 40 to 87 ms that way and 280 to 315 ms parsing every
  line (measured in Bun on the laptop).
- A whole-file read for notifications and background work cost a chat twice on every phone unlock,
  since the chat's roster and its background watch each read from byte 0 again: on the 118 MB
  transcript 1057 to 1175 ms of CPU, 550 to 619 ms of wall time and a peak of 143 to 144 MB, on a
  process that idles at 54 MB. Their markers are one set, so one read per session feeds both, and
  the running count already keeps that read alive for every Claude pane. A chat arriving at it
  then cost 7 to 25 ms of CPU and 3 to 13 ms of wall time, reading nothing (three runs of five
  arrivals each). With no count holding it, one arrival reads the file once: 292 to 718 ms of
  CPU, a peak of 129 to 137 MB. Searching a line's bytes for the markers rather than decoding it
  first took the two old reads from 1057 to 1175 ms to 737 to 800 ms, and left the peak alone;
  neither `--smol` nor reads of 64 or 256 KiB lowered the peak (all measured in Bun on the laptop).
  The price lands on the running count, which now carries the whole scan for every Claude pane
  once per agent start or session: on the 118 MB transcript, its first read went from 451 to 475 ms
  of CPU to 571 to 691 ms, on an otherwise quiet laptop. Run side by side at a load average near 18, the
  count's own markers alone took 729 to 747 ms and the whole scan 1159 to 1239 ms, at 118 MB, 476 to
  527 and 758 to 782 at 32 MB, and 42 to 46 and 41 to 56 at 0.4 MB, with the peak the same at each.
  So one chat opened per agent start already pays for it (reasoned from those numbers).
- Claude Code 2.1.312 names background work in the transcript like this (measured in local
  transcripts and a probe session). A background Bash's tool result opens with `Command running
  in background with ID: <id>. Output is being written to: <…>/tasks/<id>.output`, and its
  `toolUseResult` carries `backgroundTaskId`; one moved there by its timeout opens with `Command
  did not complete within its 120s timeout and was moved to the background (ID: <id>)`. A
  Monitor's result opens with `Monitor started (task <id>, expires in …`, with `taskId`,
  `timeoutMs` and `persistent` in `toolUseResult` (18 such results locally, none persistent). A
  successful TaskStop answers `{"message":"Successfully stopped task: <id> (<command>)", …}`. A
  shell started from a plugin's tool call has no Bash tool use in the transcript: only its result
  text and its notice name it. Each Monitor event arrives as a `<task-notification>` carrying the
  task id, a summary and an `<event>`, with no tool-use id and no status; the notice that ends it
  carries a status like a shell's. Every launch text opens its tool result, so a match anywhere
  else is a quote, such as a Read of a transcript.
- A running background Bash is a child of the Claude process, found through
  `/proc/<pid>/task/*/children`, and its standard output is the task's output file; a Monitor's
  process holds no such file. One liveness check from the session's pid file to the open output
  files took 0.32 ms of wall time and 1.17 ms of CPU (measured on the laptop). A kernel without
  those `children` files cannot say which shells run, so their absence means unknown, not gone
  (reasoned, not measured). The agent calls a shell gone only once its first miss is a full
  recheck old, so a shell that exits normally is not flagged in the moment before Claude's
  notice lands, however often its other work changes.
- Which process runs a session is read from the pid files the agent already follows, only the ones naming that session, rather than from the whole folder at every look. A pane's process is the exception: its environment names its root, which nothing may be following, so its one pid file is read directly. Decoding a pid file and holding its start time against the process sit together for both. A look that lands before the watch has read a new file reads as not knowing, which the shell check already answers for a process it cannot name, and its next look settles it (reasoned, not measured).
- The agent counts the running subagents of every Claude pane all the time, not only while a chat
  is open: it follows each session's subagent roster, settled by its notices the same way the
  chat's roster is, and puts the count on the agent's row only when it changes, so a roster change
  that leaves the count alone sends no herd update. On the 118 MB transcript a watch took 210 to
  260 ms (406 to 517 ms of CPU) to its first count, and 1.9 to 2.9 ms of CPU per line appended,
  at 2.8 KB a line on average (measured in Bun on the laptop, 200 appends, four runs). The count
  is an optional key on the wire, so a row from an agent too old to send it decodes as not knowing
  it, and its card shows none.
- A background run outlives Claude's turn, so an idle session does not end it; it only stops the
  run's elapsed time, since nothing then says the run is still going.
- The transcript says which of `/clear` and `/resume` changed a pane's session. Measured on a real
  Claude Code 2.1.317, the pid file's session id changing within 5 s of either: `/clear` starts a
  new file holding a meta caveat, a `user` entry `<command-name>/clear</command-name>` and an empty
  `local_command` output; `/resume <id>` keeps that id and file, with no fork, and appends only
  bookkeeping (`last-prompt`, `session-owner`, `atis-latch`, `cost-state`), no command line and no
  user line. Over 151 local main transcripts all 9 `/clear` entries are `user` entries at line 3 or
  4, near 1.2 KB, so any tail of a short new session holds one. A session that itself began with
  `/clear` keeps that row at the top whenever a read reaches its start, a resume or a cold open
  alike (reasoned, not measured). A bare `/resume` that is cancelled writes a `local_command` entry
  reading `Resume cancelled`, and changes nothing.

- The composer's `/` list comes from the folders Claude Code documents, read by the agent, not from
  the transcript. Claude writes a `skill_listing` attachment into a session's transcript, but only
  together with the first prompt (6 of 7 crook sessions on the laptop had one, at lines 12 to 25;
  the seventh had only run `/clear`), and it lists what the model may invoke: every skill marked
  `disable-model-invocation`, which is what a user types `/` for, was missing, and it carries no
  scope or argument hint (measured). The agent reads the managed folder, the personal folder of
  the Claude root the session's transcript lives in, `.claude/skills` from the checkout root down
  to the pane's folder (a worktree without one falls back to its main checkout's), the
  `commands` folders and the enabled plugins, honours `user-invocable: false` and
  `skillOverrides` `off`, and sends the list on the pane's transcript watch right after the
  session opens, so only an open chat pays for it: crook's list read in about 13 ms (measured).
  Claude Code's bundled skills and claude.ai synced ones are not on disk and stay out; the
  composer adds only the built-ins that work over a PTY.
- Claude Code's Read tool result numbers its lines as `1	…` today and `     1→…` in older
  transcripts (measured in local transcripts). Strip either only when every line carries it.

:::tip
A prompt herdr types into a Claude that is writing text or compacting queues exactly as one typed
at the keyboard does (measured on Claude Code 2.1.309 and herdr 0.9.5, one Claude, three cases; a
prompt typed during a tool call went unmeasured, see below): the pane lists
it above the input with "ctrl+enter to send now", and Claude takes it when the turn or the
compaction ends, as a user entry of its own whose `promptSource` is `queued`. Nothing was dropped or
merged: two prompts typed 0.3 s apart became two turns in the order sent, the second queued behind
the first. So the agent delivers a prompt the moment it is sent and holds nothing back, and the
phone labels one sent while Claude works as queued, one row per send, until the transcript holds it.

While a prompt waits in that queue the transcript holds only a `queue-operation` enqueue entry, and
the one written during a compaction carries no text (measured), so nothing in the transcript names
a queued prompt reliably before Claude takes it; the phone keeps its own row until then. Right
after `/compact` was typed herdr still read the agent as idle, and as working 1.3 s later.

The case of a prompt typed during a tool call went unmeasured: Claude Code refuses a standalone
foreground `sleep` with a `Blocked: standalone sleep` tool error and reruns it in the background,
so a probe cannot hold a tool call open with one. The background command's completion then starts
a turn of its own, enqueued as a task notification.
:::

:::tip
What a bare picker does on real Claude Code 2.1.317 over herdr 0.9.5's `agent.prompt` (three probe runs of one Claude each, every command named here sent once, all measured). Each opened a dialog, the pid file's status said `waiting`, and no line reached the transcript within 3 s. herdr keeps reading idle for `/cost`, `/status`, `/usage`, `/stats`, `/help`, `/config`, `/permissions`, `/hooks`, `/plugin`, `/theme`, `/tasks`, `/bashes`, `/export`, `/add-dir`, `/rewind`, `/sandbox`, `/privacy-settings`, `/feedback`, `/resume` and `/model`, and `agent.prompt` is accepted; it reads blocked for `/mcp`, `/memory`, `/release-notes`, `/effort` and `/fast`, which refuse the next prompt with `agent_blocked` until Escape writes "Cancelled". What the next prompt does was tried on three of the idle ones. Into `/cost` and `/help` it was accepted, reached no transcript, and left the dialog open (one run each). Into bare `/model` its text and Enter land in the picker, which answers "Set model to Opus 5.5 and saved as your default for new sessions": the prompt is lost and a default has changed. The other seventeen were not tried, so that they eat a prompt is extrapolated from those three.

An argument does not always keep a dialog away. `/model opus` on the model already set, `/effort high`, `/effort status`, `/fast on`, `/fast off`, `/rename x` and `/resume <unknown id>` answered with no dialog, and `/theme dark` opened one. `/model sonnet` is the trap: on a fresh session it sets the model directly (2 runs), and with a conversation behind it asks "Switch model?", where the next prompt's text and Enter confirmed the switch and the prompt reached no transcript (2 of 2). So the composer refuses only the bare commands measured to open a dialog and `/theme` with its argument, keeps `/model <name>` working and leaves the rest to the note below, since refusing what works is its own bug. A session's skill of the same name is not refused. `/login`, `/logout`, `/exit` and `/init` were never run, and they go through.

`/context`, `/agents`, `/output-style`, `/color`, `/copy`, `/ide` and a bare `/rename` ran with no dialog. A command Claude does not know writes a `system/informational` entry reading `Unknown command: …`.

A command's first line reached the transcript 344 to 2082 ms after the send (`/rename`, which generates a name, is the slowest; the next are 1208 ms and 992 ms), and the prompt call itself answered in about 302 to 318 ms. Every command with no line in 3 s was in a dialog, except `/effort high` sent during a turn, which wrote no line at all and took effect (its footer showed it). So a slash send's Sent row gives up after 6 s, a margin chosen at about three times the slowest, and the composer says the command may have opened a dialog that would take the next message. The row cannot tell a dialog from a command that writes nothing, and says "may" because of that. Only a command's own line, its output, or the unknown-command notice ends the wait: an interruption or a notice about something else says nothing about the command.
:::

:::tip
The pid file says when Claude would hand the next prompt to a dialog, which herdr cannot say for a slash command's. Read in Claude Code 2.1.317's binary, `status` is `waiting` whenever `waitingFor` is set: an elicitation says `input needed`, a dialog its own reason with `permission prompt` as the default, a local command's screen `dialog open`. On a real 2.1.318 with herdr 0.9.5, one Claude per run (all measured): `/model sonnet` with a conversation behind it wrote `waiting` and `dialog open` 9 and 63 ms after `agent.prompt` answered, and herdr read idle throughout. Escape wrote `idle` 62 ms after the keys answered, and an answer 100 ms. A permission prompt's `waiting` came 143 ms before herdr's `blocked`, an Ask's 69 ms. `/effort status` wrote `waiting` for 28 ms with no dialog on screen, and `/context` and `/rename` wrote none.

The reason is not what tells them apart: the row does. An open Ask sends an answer, blocked without an Ask already disables the composer, and only a plain prompt is ever refused, so an answer, keys, a decline's follow-up and a launch all still go. The phone refuses on the press and keeps the draft, as a bare picker's refusal does, and shows nothing before it: a line up ahead would flash for the gap before each `blocked` and for that 28 ms. What it shows is worked out from the words refused and the current row, so nothing has to clear it and it cannot outlive the wait.

A change reached a phone over a local socket, through real herdr, agent and hub with a stand-in's pid file, in 207 to 226 ms going to waiting, with one at 108 ms, and 206 to 213 ms coming back (three runs of 12 each way, measured; a real network adds its own). The agent reads the file again right before it types a prompt, 0.04 ms of wall time and about 0.09 ms of CPU for the file and its `/proc` check (2000 reads, three runs, measured), so a phone that has not heard yet is refused there. What is left is a prompt whose read lands in the 9 to 63 ms before the file says so, or a dialog opening while the prompt is being typed, whose call takes 310 to 323 ms (reasoned from those numbers, not measured).

A pid file can outlive its Claude. `kill -9` left it saying `waiting`, while SIGTERM took it away in 53 ms and closing the pane in 7 ms, so a status counts only while a process with that pid and start time runs. herdr dropped the real Claude's agent 399 ms after the kill, and a stand-in's kill reached the phone as no longer waiting in 283 ms (one run of each, measured). Where `/proc` is missing nothing can vouch for a status, so it reads as not waiting, and the composer behaves as it did before this (reasoned, not measured).

The key is optional, so an agent too old to send it reads as not knowing and its prompts go as they always did. An older phone drops the key and is still refused at the agent. The refusal is the command failure herdr's own refusals use, with a code of its own: a new failure class would not decode on an older phone or hub, and a message that will not decode reaches every live request on the socket (reasoned from the entry on RPC failures, not measured). An older phone shows it as a generic refusal.
:::

:::tip
The pid file has a fourth status. `shell` is what Claude writes when a session goes idle with a background Bash alive (read in Claude Code 2.1.318's binary, and seen on a real one the moment its turn ended, the shell running), and `waitingFor` also takes `goal proposal` and `sandbox request` (read in the same binary). Only `waiting` counts as Claude waiting, so a row reads `shell` as not waiting (measured: the row stayed that way through it), and nothing here lists the others.

A current agent's row ends a slash send's wait sooner than its 6 s. Measured on a real Claude Code 2.1.318 and herdr 0.9.5, through a real agent and hub to a phone client, every command sent once unless counted. `/model sonnet`, `/cost`, `/help`, `/status`, `/mcp`, `/memory` and `/config` wrote `waiting` 1 to 31 ms after the prompt call answered, and the row said so 12 to 224 ms after that. Six sends of `/effort status` wrote `waiting` for 13 to 21 ms, then their line 81 to 104 ms later, and the row carried it in 1 of 6, for 217 ms; `/effort high` wrote it for 43 ms and the row never did. So a row that says Claude waits for the link notice's second, a hold reused rather than measured anew and over four times that 217 ms, ends the Sent row with the same note, about 1.2 s after the send (reasoned from those numbers). An agent too old to say, or a command that writes nothing with Claude not waiting, keeps the 6 s, and a row saying so beside an open ask does too, since the dock already says what Claude waits for.

A dialog closing need not say so in the transcript. Escape wrote `idle` 13 to 19 ms after the keys answered, `/config` needing a second one, and the row let go 14 to 320 ms after that. `/model` and `/memory` wrote a line as they closed, while `/cost`, `/help`, `/status`, `/mcp` and `/config` wrote nothing, which left the note up until the next answer. A note up when the row stops saying Claude waits now goes with it.

The re-read 380 ms after an answer stays, and at that length. The pid file does not replace it, because the case it exists for changes nothing in the pid file: over 28 answers with another dialog queued behind, from two or three parallel Reads outside the project, the file stayed `waiting`, herdr sent no event, and the next dialog was on screen within 103 ms of the keys answering (the screen read every 100 ms or so). Where the row moved onto it, from the keys answering, one Claude per run: with Claude's hooks and the re-read 204 to 514 ms over 10 moves; with the hooks and no re-read 354 to 465 ms, 5 of 5, moved by the first call's `PostToolUse`; with the re-read and no hooks 603 to 742 ms, 5 of 5; with neither it stayed on the answered ask for the whole 10 s watched, 5 of 5, until a second tap re-read it. The hooks are merged in by hand, so a machine can lack them, and a first call that runs long would hold back that `PostToolUse` (reasoned, not measured).

Its length holds too. Over 32 answers that ended the dialogs, the pid file left `waiting` within 51 ms of the keys answering, and herdr's status followed 8 to 331 ms behind the file, at most 332 ms after the keys. So a re-read sooner than that lands before herdr's flip, which is what the pid file's own re-read does: in 16 of the 32 the row read blocked over a screen with no dialog, an `UnknownAsk` where the answered ask had been, for 199 to 231 ms before it left blocked.

A dialog closing keeps the row's ask until herdr moves or a second has passed. The pid file leaves `waiting` first, which wakes a re-read, and that read can meet herdr's blocked over a screen with no dialog. It used to publish that as an unreadable ask, or as a permission with no options where a hook still named the call. On a real Claude Code 2.1.318 and herdr 0.9.5, through a real hub to a phone client on one machine, that was 11 of 16 answers, the laptop's own keys among them, for 119 to 244 ms. Over an emulated 300 ms round trip on the phone's socket it was 6 of 10, for 302 to 306 ms, so a slower link shows it for longer: the two updates reach the phone a round trip apart, which fits the hub waiting on each acknowledgement (reasoned from the RPC entries). In a story the swap read 9 frames over 128 ms and 0.0268 of layout shift, with a Decline live over a dialog already gone, whose Esc would land on the turn just approved (read in the code, not pressed). The notification plan also reads that swap as a new question and raises `Has a question` for a dialog already answered (run through the plan's own function, with no Hark). With the hold it was 0 of 16, and a real `/mcp`, which nothing can read, still read as unreadable with the file saying `waiting`.

Refusing to read a screen as a dialog whenever the file says not waiting was the first idea, and it can hide a real one. Where `/proc` is missing every status reads as not waiting, so an unreadable dialog on such a machine would simply not exist, and a screen the file does not cover, such as one shown before a session starts, would go the same way (reasoned, not measured). So the hold needs the file seen moving from `waiting` to another status, and it ends on its own. That move comes from the watch alone, so it reads the same with no `/proc`. A file that never said `waiting`, one with no status, a half-written one until it can be read, a killed Claude's, which never moves and keeps the hold off for its whole session, a screen that could not be read and a row with no ask yet in that blocked episode all read as they did. A dialog on the screen always wins, and the file saying `waiting` again ends the hold.

The second is a guard: from the file moving to the row leaving blocked took 213 to 590 ms over those 16 answers, and 281 to 791 ms with the phone's own 150 ms in it. The hold wakes a re-read when it ends, since an idle herdr sends nothing. So being wrong costs an unreadable dialog that opens within that second without the file saying `waiting`, which shows a second late at most; every dialog whose file has been read so far wrote `waiting`. A hook naming a next call during the hold changes nothing until the file says `waiting` or its dialog is on the screen, whichever is first (read in the code, not measured). The ask kept is the one the row already showed, rather than none, because a blocked row with no ask says it is waiting for Claude's question, which is its own flash. A tap during the hold meets the check of the screen against the ask's dialog, and is refused as already answered (read in the code, not measured). A story plays the rows and cannot run the hold, so the same story fails on the old rows and passes on the new, and the real runs above are what hold the agent. The unreadable ask carries a mark of its own, since the dock's own mark stayed up through the swap and the frame tool read nothing.

Parallel calls' permission requests reach the agent in either order, since each hook runs as a process of its own, while Claude's dialogs keep the order of the calls. A row used to pick a request by its place in the queue, so a swapped pair named the second call over the first call's dialog. Approving answered the dialog on screen, the next dialog then matched the ask the row already held, so the row did not move, and every tap on it was refused as already answered until the laptop answered it. With every hook's arrival logged at the agent, on a real 2.1.318 running Haiku, two parallel Reads outside the project: 16 rounds, 5 with the requests swapped, 1 to 42 ms apart, and those same 5 named the wrong file and stuck (measured). An earlier count read 2 of 17, and none of 10 without the hooks.

So a row names the request whose call the dialog shows, whichever landed first. Over 28 rounds, 25 of two Reads and 3 of three, 15 had the requests swapped, and none named the wrong file or refused a tap, the row moving on after each answer (measured). A place in the queue now only tells apart calls of one tool and input, whose dialogs read the same, so each still gets an ask of its own and the lock screen a prompt of its own. The lock screen reads the same row's ask, and its prompt names only the tool, so it had the same fault: an Approve there answered the dialog on screen under the other call's id, and the next dialog raised no prompt (read in the code, not measured).

Where two different calls both fit the dialog, such as one path inside another or one file at two offsets, or the input holds nothing the dialog could show, the row names no call and reads the dialog. That says what is on screen by construction and still answers, and shows less on the phone: no patch and no parsed input. None of the 28 rounds needed it. With no dialog to read yet, two different requests name nothing either. With no hooks a row has only the transcript's oldest call with no result, which can be one already answered, so past the first dialog of a queue it reads the dialog too. Over 6 rounds with no hooks none named a wrong file or refused a tap, the second dialog reading the screen in all 6 (measured). Two Edits of one file both fit their dialog, so with hooks they read it as well; a position would say which, but a position is what swapped. The match is by text, so a call whose whole input sits inside what another dialog shows can pass for it until that dialog's own request lands, when the two become ambiguous (reasoned, not measured).

A tool with no header of its own needs this most, since nothing else ties it to the dialog: that is how a declined call's details could show over the next dialog. A tool's input is on screen for what was measured, one real run of each: every string of an MCP call, quoted, escaped, and laid out over `│` lines, 682 characters uncut, and a Read's path whether or not a symlink adds a line. A decline fired no hook in 2 of 3 runs and left no pending behind in any of them: the row reaching idle dropped it, and declining the first dialog of a batch ended the whole batch.

A Read outside the project under a Claude started with no permission mode has the header `Read outside the working directories`, with no counter (measured, one run).

A permission dialog need not carry an `Esc to cancel` line. A fetch ends on an answer marked `(esc)` and a plan approval on `ctrl+g to edit in <editor>` (measured, one run of each on a real 2.1.318), and the network dialogs' `Deny (esc)` ends the same way (read in its binary). Each used to read as no dialog: on a real fetch the row carried no options and the phone drew only No, and an Approve sent anyway was refused as unreadable with nothing typed. Either ending counts only as the screen's last line, because Claude's input box sits under anything it says, so a conversation quoting one is still no dialog. That leaves a wrapped label working, since the marker ends the line it wrapped to. Over real dialogs through a real agent and hub, from a phone's call: a fetch's Approve, Always and Decline left the ask 600, 250 and 250 ms after the answer, a read outside the project's Approve and Decline 650 and 350 ms, and a plan's Decline 650 ms, each polled every 50 ms, one run of each.

Options fall in with what a button does. A one-time yes is `Yes`, `Allow` or `Yes, but ask again next time`, the last of which moves the cursor down three lines on a read outside the project, where it comes fourth (measured, its next read asked again). A no is what Esc does, since the phone's No presses Esc: `No`, any label marked `(esc)`, and `No, and ask again next time`, whose answer is the same denial Esc gives that dialog (read in the binary). An answer selects by the whole label, wrapped lines included, the same text its class was read from.

What no button answers, the dock names as offered on the laptop only: a mode switch such as `Yes, and switch to auto mode`, `No, and block reads outside the working directories from now on`, a second lasting option beside the one Always presses, and all three of a plan approval's, which has no plain yes. Choosing by label stays a question's alone, so a tap cannot change a session's permission mode, and an answer to any of these still has to name the dialog on screen. The classes on the wire did not change. An older phone hides the same options it always did and answers what it can through the agent, and an agent too old for this sends `Yes, but ask again next time` as other, which a current phone lists as a laptop option rather than offering a Yes that would be refused.

A plan's text sits above the rule that starts the part of the screen read as the dialog, so the header alone ties a plan approval to its call, and the fingerprint does not cover the plan. Only one plan can wait at a time (reasoned, not measured), and only Decline can land on one from the phone. The lock screen still offers Approve on a dialog with no plain yes, where the answer is refused and the pane reads needs you (read in the code, not measured).

An answered ask is remembered with the dialog it carried, so one id over a new dialog is a new answer, and only the same dialog is refused.
:::

:::tip
What a slash command writes, counted over 152 local main transcripts holding 1517 non-meta user text lines, Claude Code of mixed versions (measured). A skill's line opens with `<command-message>`, and 67 of 67 were followed by a meta line holding the skill's body, so it starts a turn. A built-in's opens with `<command-name>`, and 71 of 71 were followed by output: 57 as a user line of `<local-command-stdout>`, 14 as a system `local_command` entry. All 138 carry their tags at the very start of a plain string, with no text before them, so tags are read only there: a prompt quoting a tag stays a prompt. A further 8 system `local_command` entries carry a `<command-name>` of their own (`/cd`, `/resume`, `/login`), which reading only user lines used to drop.

A typed `/compact` also writes a plain user string before anything else. Of 35 such lines, 34 sit right before a manual compact boundary (32 exact, 2 with an argument), all 34 manual boundaries have one, and the other had a caveat and the next prompt after it with no command line. The line's stamp and the boundary's sit 8.3 to 73.5 s apart, so it is read as meta from the line alone, and it cannot wait for the boundary. `Compacted (ctrl+o to see full summary)` followed 34 of 34. The only other plain lines starting with a slash were 4 paths and 1 typo, which stay prompts. On an empty session `/compact` writes its caveat and command with `<local-command-stderr>Error: No messages to compact`, in place of a summary, and that one is shown.

A real `/compact` (Claude Code 2.1.317, one run): the plain line 422 ms after the send, herdr working at 476 ms, then the boundary, summary, caveat, command and output in one write at 8961 ms, idle at 8971 ms. A skill the probe wrote for itself: working at 462 ms, its line and its body at 495 ms, then an answer.

A `!cmd` typed in Claude writes `<bash-input>…</bash-input>`, then `<bash-stdout>…</bash-stdout><bash-stderr></bash-stderr>` with stderr merged into stdout, or `(Bash completed with no output)`, and it starts a real turn: 3 of 3 with herdr working and Claude answering. Locally only 1 such pair exists.

`(no content)` is what a dialog command writes when it closes: 1 local line, from `/plugin`, and `/plugin` and `/feedback` in a probe. The phone shows nothing for it. Backticks in an output carry a name to show as code (4 local lines, all `/model`), and `/context` writes an ANSI grid in system entries, which the row leaves to its own scrolling box.

All of it reuses the local command blocks on the wire, with one optional key saying the line opens a turn. A new block class would decode as unknown on every older phone, where a key it does not know is dropped and `! kill 1` reads as the note it always was. An agent too old to send the key still gets a command's bubble and output, with no turn start, and a plain `/compact` and raw bash lines stay as they were until it updates, since only the agent reads the file.

A command's bubble holds its size and place as its output lands, read per frame in Chromium at 390x844 and 4x CPU throttling: 44 px tall and 4 px below its row's top through Sent, the command and the output, at speeds 1, 2 and 4. In a thread too short to scroll it stays at one position throughout. In a following thread at the end of 120 lines, output landing in a later batch grows the row from 52 to 89 px and glides the bubble up those 37 px over about 500 ms. Giving way to a row with no Sent line drops a bubble in one frame in a following thread, since the row truly gets shorter: 20 px on a command at the end of 120 lines, 20 of 20 runs in the log and in pictures, and it stays there; with its output in the same batch a command moves 0 to 5 px. A real command and its output arrived in the same write, 5 of 5 pairs the probes logged, so that batch is the usual one.
:::
