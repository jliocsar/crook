---
paths:
  - "packages/herdr/**"
  - "apps/agent/**"
---

# herdr

:::warning
A new pane's shell is ready for `agent.start` only once its rc files have run, and nothing herdr
returns says when that is. herdr 0.9.5 answers `agent_pane_busy` while any child of the shell holds
the pane's foreground and accepts the moment the shell is alone there, mid-init included: with the
user's zshrc, whose start-up runs `herdr`, `jq`, `mise`, `fzf` and `wt` one after another, an
`agent.start` retried right after the setup line was first accepted 0 to 274 ms later across 20
launches (measured). A fixed retry budget sized from a bare shell's 27 ms spawn loses that race
whenever the rc work runs long. Here the one launch that lost it opened a new workspace, and every
launch into an existing workspace was accepted within 25 ms, so which launch fails is timing, not
the workspace being reused.

So a launch types its setup line with a `printf` that prints a ready mark, and waits for that mark
with `pane.wait_for_output` before it asks herdr to start the agent. The format splits the mark in
two, so the echo of the typed line never contains it and only a shell that ran the line can match.
The mark appeared 401 to 708 ms after the line was sent, over ten launches that opened a workspace
and ten that added a tab to an existing one; the slowest of each was within 5 ms of the other
(measured). After the mark the prompt hooks (`mise`'s precmd) still held the foreground for up to
58 ms, so the start is still retried while busy, for ten times that.

herdr checks `pane.wait_for_output` on a 100 ms grid: every wait ended within 8 ms after 400, 500,
600 or 700 ms (measured). A timed-out wait answers the code `timeout`. The socket API has no
`pane.run` (read in herdr's bundled API schema), so text and Enter stays `pane.send_input`, which
answers once the keys are in, at least 300 ms before the line's own output appeared (measured).
:::

:::tip
A read herdr never answers fails as a named timeout, ten times the slowest read measured. Measured
on herdr 0.9.5, an isolated session with 20 panes reporting agents, 3 runs, each read alone and as
one refresh (a snapshot, then every pane's process info and detection read at once), idle and with
8 panes printing in a loop: `session.snapshot` had a median of 104 to 119 ms and a slowest of
201 ms, with the panes printing; `pane.process_info` and `pane.read` a median of 101 to 104 ms and
a slowest of 144 ms; `events.subscribe` a median of 1 to 4 ms and a slowest of 118 ms; a whole
refresh a slowest of 270 ms. What decides between about 1 ms and about 100 ms is when a request's bytes reach a
new connection, not what came before it: herdr looks at a connection as it takes it and then on 100 ms marks
counted from the connect. Written 5, 20, 50 and 150 ms after the connect, a ping on 20 idle panes was answered
96, 81, 50 and 50 ms after its write, all 60 of each within 3 ms of that (read from the outside, not in its source). So it is a race
between the client's first write and herdr's first look. A raw client writing inside its connect callback mostly
won it, back to back on 20 panes: a median of 0.22 to 9.51 ms, with 0 to 62 of 200 calls near 100 ms. crook's client,
which writes once its socket has opened, mostly lost it, a median of 102 to 110 ms with 119 to 179 of 200 near 100 ms,
and spaced 150 ms apart a median of 4 to 13 ms with 14 to 18 of 40. A burst raises the raw client's share: 25 to 58 of
120 at eight at once. Only reads carry the timeout. A call
that legitimately waits, such as a prompt, an agent start, a wait for output or a worktree, stays
under the budget of the command around it, since timing out a call that has already acted says
nothing about whether it landed.

A refresh runs inside the state's lock, so its reads being bounded is what bounds every other state
change. When an invalidation's re-read times out the state says herdr is lost at once and the
following subscription is told, so the reconnect loop takes over and clears the mark when herdr
answers again; nothing else would, since an idle machine sends no events.

A hung herdr says nothing by itself. With herdr 0.9.5's named server under SIGSTOP, a real agent and hub and a
stand-in phone: its subscription socket stayed open and silent, 0 lines over 60 s running idle and 0 over 30 s
stopped. A new connection still opens in under 1 ms and takes a write, and no reply comes, until 4094 of them queue
and a connect is refused. herdr has no heartbeat: `ping` is a request and nothing in its API schema pushes on a
subscription, so any signal from it is a request somebody makes. Over a 40 s hang with nothing asked the phone kept
its rows, a `working` one included, and the agent logged nothing. The same subscription carried the next status flip
afterwards, so a hang nobody touched costs no resync. A pane's program stops with it: one writing to its pane moved 0
bytes over 4 s, 3 of 3 runs, and ran on at resume, so a `working` row can go on naming an agent that is held too
(reasoned: no real Claude was run).

So nothing polls, and a hang is noticed when something next asks herdr. What already asks: a pending ask from a hook
marked it lost 2074 ms later, and a pid file moving 4187 ms later, one read and one subscribe. A command used to fail on
its own and say nothing: a prompt, keys or a rename answered unknown after 4055 to 4120 ms, and 33 s of hang later the
herd still read as live. A command whose failure can be herdr's silence now asks for a re-read, whose own bound decides,
since the command's failure alone proves little: herdr's stall window for a prompt is longer than the command's
budget, and an unreadable dialog can be just that (both reasoned, not measured). The phone read lost 6082 to 6103 ms
after a prompt or keys were sent, seven runs. An answer and a launch read before they write, so they fail after 2051 to
2092 ms with nothing sent, and the phone read lost 4079 to 4124 ms after them, five runs. Each cleared 250 to 378 ms after
herdr resumed, as a resync. A chat opening asks herdr nothing, and a hub publish needs a state change first (both read
in the code), so neither would carry it on an idle machine. The word shows on the machine's card and screen.

A poll was left out on purpose, and its cost is not why. A ping through crook's client cost 1.18 to 1.68 ms of the agent's
CPU, three runs of 1000, and about 0.3 ms of herdr's in the two with nothing printing, so one per 30 s is about 0.2
CPU-seconds an hour. It would be a new interval on an idle machine, and until someone acts a hang costs a row reading as
it last did.

A test of a quiet subscription waits for the fake to answer the subscribe and the read after it before it goes silent.
Gone silent straight after the sync was built, the subscribe itself went unanswered and marked herdr lost, so the test of
a command passed with the re-read taken out, in 4418 ms (measured).

Giving up on a request does not take it back. What a client wrote to a hung herdr stays in its socket and runs on
resume, the client long gone: a `pane.send_input` from a closed connection landed 187 ms after SIGCONT, and each prompt
the phone had been told was unknown reached the pane once herdr resumed, in all five hangs read back, up to 28 s after the reply.
Two landed in the order sent in one run and reversed in the other. That is what unknown means here, so a resend after a
hang can land twice.

An agent reads herdr once as it starts, and on any failure attaches with an empty state marked lost
instead of retrying. Retrying before it attached left an agent started before herdr showing the
machine as offline (all four tests of it hung until their 20 s limit before the fix, measured). That
state says nothing about the panes, so the hub keeps the machine's seen marks and herdr version
through any lost state rather than treating its empty list as every pane gone.

`pane.process_info` leaves out `foreground_processes` and `foreground_process_group_id` when the
group holding the pane's terminal has no live process, which is a shell caught between two children.
The two go together, and the list is never sent empty (read in a newer herdr's source; on 0.9.5, none
of the reads below sent an empty list or one field without the other). Measured on herdr 0.9.5 in a
named session, reading every pane back to back for 120 s, one run under zsh and one under bash, a copy
of `sleep` named `claude` staying in the foreground showed it in 0 of 173115 reads, and a copy of
bash named `claude` running one child after another in 0 of 98922. A shell's printing loop showed it
in 8110 of 150885, a shell looping over a stand-in that lives 50 ms in 143 of 165531, an idle shell in
0 of 241421, and a stand-in stopped with SIGTSTP in 0 of 188291, where the reply lists the shell.

A real Claude was not read through that call, only through what it reports from. Seven Claudes
running under herdr on the laptop, read from `/proc` every 5.6 ms for 900 s while one of them ran a
subagent's tool calls, held the terminal in their own process group in all 161839 reads of each. Their
tool shells sit in a session of their own with no terminal (read off `ps`), so a tool call never takes
the foreground. So a pane whose foreground stays Claude does not show it, and it shows up around a
Claude that exited or a pane that was never running one.

Its absence therefore says nothing about the pane, while a list that holds no Claude does. Reading it
as no Claude would cost more than a stale name: a session missing from one read dismisses what the
hooks recorded for it, leaves its Ask to the screen alone and loses its waiting mark (read in the
code), and such a read used to do that even with herdr reporting the session, since it failed as a
changed protocol. So the row keeps the session it last held for that same terminal, as long as a pid
file still names that session, then what herdr reports. A pid file going is what ends a Claude that
stopped cleanly, so its wake cannot land on a read that keeps the session. A Claude killed outright
leaves its pid file, so that wake is herdr dropping its agent (reasoned, not measured). A session
under a Claude root the agent does not watch is never named, so it goes on such a read, as herdr's
report of it already does (read in the code). None of this reaches the wire, which only ever carries
the row's session, so older phones and hubs see nothing new.

A read of one pane that fails outright reads the same way, as not knowing: the row keeps its session while a pid file names it, then what herdr reports, and the failure goes to the log. Those failures are rare, but a session dropped for one refresh loses its hook records for good, so one bad read costs more than a stale name. What still fails the refresh is the connection itself, a timeout or a closed socket, which leaves every row as it was. An agent herdr says is gone counts as gone, as a closed pane does, though `pane.process_info` was never seen to say so.

The failure that needs nothing unusual is reading a pid file mid-rewrite. Claude Code writes it in place: its source calls `writeFile` from `fs/promises`, and on Bun 1.4.4, the Bun inside Claude Code 2.1.318, that opens without truncating, writes, then truncates to the new length (read off a stand-in's system calls), and the inode held through 120 real rewrites. So a read can see the new record with the old one's tail, or cut off at the old length. One real Claude with a dialog opened and closed 60 times, and one loop reading only its file, 53675925 reads in 125 s: at least 40 would not parse, 35 at the longer length and 5 at the shorter, where the probe stopped keeping them. A stand-in alternating 782 and 812 bytes every 5 ms, read through the agent's own decoder, failed 279 of 428404 and 286 of 381381 reads, about 7 to 8 us of wrong reads per pair of writes (reasoned from those). A record that keeps its length is safe: 0 of 440709. Status flips between `busy` and `idle` keep it, so it takes a dialog or a rename. A kept session that has really moved corrects itself, because the rewrite behind the failure wakes the agent's own read of that file (reasoned, not measured).

How often is another matter. Reading the pid files of up to 11 Claudes on the laptop as they worked, 46936513 reads and 938728 of their environment over 900 s, saw 16 rewrites and no failure. The installed agent's log from its 15 days on the laptop holds none of these warnings, on a machine with herdr's hook, where a session herdr reports and a pid file names is never read at all (read in the code). A machine without that hook reads every Claude pane on every refresh.

herdr itself only refuses while it stops. Reading 11 panes in every state above, among them a foreground of 360466 bytes of arguments, with panes opening and closing around them for 290 s: 12842 reads through crook's client and 69550 through a raw one drew nothing but `pane_not_found`. Stopping the server drew `server_unavailable`, 11 and 81 of them, and its source answers this call with nothing else but success (read in a newer herdr's source). Reading a process as it exits also fails: over 4226 stand-ins living 3 ms, each read back to back after its name showed, 5797 of 209552 reads of its environment were refused, 44 failed otherwise and 423 reads of its `stat` failed, and on a later run all but 1 of 4245 refusals came more than 2 ms after that name showed. A Claude in that state has left the pane, and a clean exit also takes its pid file.
:::

:::tip
Nothing in herdr announces a session change. Two runs of a real Claude Code 2.1.317 under herdr 0.9.5, with herdr's own `SessionStart` hook installed and, in the first, every herdr event logged:

- `/clear` moved the pid file's session id 9 to 79 ms after `agent.prompt` answered (6 of them), and the new transcript file landed 143 to 207 ms after that (3 of them). The events around it belong to the pane's title, not to the session: `pane_updated` 37 and 55 ms after the pid file, still carrying the old id, and `tab_renamed` about 240 ms after it. A `/clear` with no title left to change, such as one right after another, fired no event at all.
- The hook's report lands later than the pid file and fires no event of its own (measured there and by reporting directly), so a re-read on one of those title events read the old id and nothing followed to read the new one.
- `/resume <id>` moved the id 110 and 252 ms after `agent.prompt` answered. It does go through herdr's status, working then idle, and a `pane_updated` 82 ms after the pid file carried the new id.
- A `git switch` typed in a pane or run from outside it renames a new `HEAD` into the git directory. herdr's tab label shows the branch only until the pane has a title, so a `tab_renamed` follows 222 to 514 ms later only while it does (measured for the label, reasoned for a pane with a title).

So the agent watches one folder per Claude root, which holds the pid files, and one git directory per checkout an agent sits in, which holds `HEAD`. `HEAD` is replaced by a rename, so a watch on the file itself would die with it. An agent with one root, one checkout and one session held 4 inotify watches at rest. An event is filtered by name before anything is read, and a re-read only follows if the file now says something else: Claude rewrites its pid file on every status change, `busy`, `idle` and `waiting`, and keeps `.key` files beside it, all of which land in the same folder, while a git directory sees every lock file. A rewrite under the same session cost 0.45 to 0.95 ms of CPU, and a lock file created and renamed in a git directory 0.35 to 1.24 ms, against 10 to 220 ms for 10 s of an agent left alone (Bun on the laptop, 2000 of each, three runs; the spread is what else the laptop ran). Over one 180 s window on the laptop with Claudes running, the pid folder saw 12 events, and the main checkout's git directory 1.

From a file changing to the agent's publish leaving for the hub: 106 to 126 ms for a real Claude's `/clear` and `/resume` (4 changes, among them the second `/clear` of a pair, the kind that fires no herdr event), and over three runs with a copy of `sleep` named `claude` and a pid file written by hand, 24 to 247 ms for a session and 17 to 252 ms for a real `git switch`, 12 of each per run, most near 230 ms. The re-read's herdr calls are that time (reasoned from the 100 ms grid above, not measured apart). A pair of session changes 20 ms apart published once in 9 of 9, on the latest. A pair of switches ended on the latest as well, usually with a further publish for herdr's own tab label. Twenty rewrites under one session, two commits, a status and a switch to the branch already out published nothing.

A session change itself is dearer, re-read and publish and following the new session together: 28 to 97 ms of CPU over 100 changes, three runs. Waiting for a new session's transcript opens one watch per project folder, so with 37 folders the agent went from 4 watches to 40 and back on a change (a read every 2 ms saw 40 in 8 of 10 changes and fewer in the rest).

herdr's reported session is trusted only while a pid file names it. Trusting it first can leave a `/clear` stale: the re-read the pid file asks for can arrive before the hook reports (herdr still carried the old id 55 ms after the pid file moved), and the report wakes nothing. When it no longer holds, the pane's process is asked, which costs one more read of herdr for that one refresh, and what herdr reports is the fallback if the process cannot say. A pid file left by a dead process still counts as naming its session, so a report of that session stays trusted until the next read after the hook lands (reasoned, not measured).
:::
