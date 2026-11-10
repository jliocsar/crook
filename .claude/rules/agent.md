---
paths:
  - "packages/agent/**"
  - "packages/claude/**"
---

# Agent

:::tip
What the agent costs over an hour, measured on the laptop, which decided what got changed.

Claude Code runs a hook command three times per tool call: 33 hook runs for 11 calls in a real
session (pre, post and batch). The busiest recent hour held 292 tool calls and the median active
hour 19, against 6.1 CPU-seconds an hour for the whole running agent, watched for 600 s beside
three busy Claudes. A hook that started the whole compiled agent took 125 ms of CPU and a peak
of 52 MB per run, so hook processes were the largest cost by far: 110 CPU-seconds in that busiest
hour. Bun parses what a binary imports at its start, so only parsing less helps. Bytecode reached
68 ms, a lazy import without splitting 47 ms, Effect's core with splitting 17 ms, and a forwarder
importing nothing with splitting 4.4 ms of CPU, 4.2 ms of wall time and 19.7 MB, with 30 of 30
payloads delivered.

A real Claude's 22 s turn of 12 tool calls made herdr send 4 events: two status flips, one title
change and one tab rename. A title set by escape code sends one `pane_updated` per change, and
printing output sent 1 in 20 s, so nothing a working Claude does floods the subscription. The
last week's transcripts held a median of 4 turns per active hour, a 90th percentile of 26 and at
most 40. A re-read of 8 Claude panes and 15 recent places cost 20 to 38 ms of the agent's CPU and
4 to 20 ms of herdr's, about 10 CPU-seconds at the busiest and under one in a median hour, so the
re-read stayed as it is. Waiting for a session's file costs 16.95 ms of CPU against a look's 1.92 ms
across 37 project folders, about 0.17 CPU-seconds an hour at 11 sessions, so that stayed too.
:::

:::tip
Bun, measured on 1.4.3, for a client that writes to a Unix socket:

- `socket.write` returns how many bytes it took, and the rest has to wait for `drain`. A 4 MiB
  write that ignored it lost what did not fit.
- `socket.end()` closes at once, so the client's `close` fires before the server has handled the
  bytes, which still arrive: 0.2 to 1.3 ms against a half-open server holding the connection for
  300 ms. A test polls for what the server did rather than trusting the close.
  `allowHalfOpen` with `shutdown(true)` hung: the client got `end` and never `close`.
:::

:::tip
A status call gives a live agent 3.766 s, ten times the slowest answer measured on a starved machine, and only an agent that took the connection and then said nothing ever waits that out. Ten times the slowest answer at rest, 212.69 ms, called a live agent silent: 1 of 12 runs of a test beside 48 busy loops, and 15 of 15 asks with a stand-in agent stopped for 0.6 s from just before the asking process started, each failing at 220 to 225 ms; with the new budget those 15 answered in 484 to 532 ms, less than the stop because that process spends the first part of it starting up (the times measured, the reason reasoned).

A fresh process asked a stand-in agent in a process of its own over a real socket, on 16 threads, with that many busy loops beside them at the same niceness. 0 loops: 300 asks, 9.3 to 19.4 ms, median 11.6. 12: 140 asks, 24.4 to 49.6, median 31.7. 24: 70 asks, 36.3 to 120.4, median 70.5. 48: 133 asks, 33.1 to 182.7, median 89.0. 96, a load average near 92: 111 asks, 64 with the budget out of the way and 47 under the old one, 43.2 to 376.6, median 177.7, with 42 past the old budget. An asker and an agent in one fresh process never read past the slowest of their level: at most 286.5 ms beside 96 loops. So the slowest answer grows about 3.7 ms per loop from rest to 96, and the budget reaches well past that load (reasoned from those).

An answer later than the budget can still win: those 47 under the old budget all answered, though 17 took longer than it, up to the 376.6 ms above. The client's timer runs only when its own loop gets there, so the elapsed time overstates what the timer sees, which would be why the old budget failed so rarely (reasoned, not measured): 0 of 19 test runs beside 96 loops, and asks in a test's process, warm, reached at most 132.9 ms over 5255 asks in 40 runs beside 48 loops (both measured). The agent's own wait for the request uses the same budget. Its clock starts after the client's, so the client gives up first unless its own timer runs late (reasoned). A client hung up on before it writes reads an empty answer, as one it cannot read, and that now takes a client stalled for the whole budget between connecting and writing (reasoned, not measured). A connection that never writes holds its handler that long too.

The budget costs a dead agent nothing. A missing socket and a dead agent's socket fail with `ENOENT` and `ECONNREFUSED` as fast as an answer comes: 6.9 to 9.9 ms at rest, 38.2 to 100.9 ms beside 48 loops, 35 of each. A stopped agent takes the connection and costs the whole budget, 3790 to 3795 ms at rest and 3828 to 3879 ms beside 48 loops, 3 of each (all measured). So raising it charges a person a few seconds once, on a machine with a hung agent, while the old budget charged a false report on any busy machine: `status` says a live agent is not answering, and `start` goes on to start a service that already runs and says it did (read in the code). `restart` asks before it restarts, so restarting a hung agent, the likeliest reason to, starts that much later (read in the code).

The wait after a restart has a bound of its own, ten times the slowest start measured at rest, 2943 ms, and past it the report says the agent may still be coming up on a busy machine and to ask for its status. A real agent spawned directly, with herdr's socket missing and the hub unreachable, first answered from its compiled binary, which is what users run, 118.1 to 294.3 ms after its spawn at rest (60 runs, median 141.0, a load average near 2; only the first passed 183.0), 523.6 to 1829.0 ms beside 48 loops (24 runs) and 567.9 to 4662.5 ms beside 96 (10 runs, median 2450.9). Run from source it took 186.1 to 284.6 ms (40 runs), 902.3 to 2939.0 ms (6 runs) and 4842.3 to 6116.1 ms (4 runs) in those same sessions, and 181.8 to 257.7 ms (193 runs), 1057 to 2656 ms (22 runs) and 1255 to 4947 ms (12 runs) in an earlier set. So the compiled binary starts faster, a median of 141.0 ms against 224.2 at rest, and starving it still outlasts the bound: 0 of 24 beside 48 loops and 2 of 10 beside 96 (all measured, the loaded runs of those same sessions with the agent, its asker and the loops at nice 19). Dropping the binary from the page cache before each start read 246.1 to 294.0 ms (5 runs, measured), and a restart runs the same binary it starts, so its pages are at hand (reasoned).

The bound stayed derived, and the sentence is what moved. A wait that outlasted that slowest start would be over 1.7 s longer, and an agent that fails to start answers nothing, so every failed restart would pay it: a missing socket costs the bound itself, 2498.2 to 2513.3 ms under the old 2495 and 2955.7 to 2964.9 ms under this one (5 runs each, measured). A false alarm takes more than 48 loops on these 16 threads, and costs a sentence that now says what it does not know, which the plugin's restart screen follows with the status (read in the code). Each of its asks can now wait out the budget, so a new agent that takes the connection and hangs ends the wait up to 3.766 s past the bound (reasoned, not measured).
:::

:::tip
Bun's `fs.watch` drops a change event that lands about 1 ms after the one it just delivered for that name, and nothing tells the reader (measured on Bun 1.4.4). Whoever reads only on an event then stays short until the file's next write. Three appends to one file in one process, reading the size on each event, then 120 to 150 ms of quiet: `fs.promises.appendFile` back to back left the last read short in 144 of 200 rounds and in 415 of 450 beside 12 busy loops, at about 1 event per round; `appendFileSync` with a spin gap of 0 ms in 4 of 40, 0.5 ms in 15 of 40, 3 ms in 2 of 40, and at gaps of 1, 2, 5, 8, 12, 20, 50 and 200 ms in 0 of 40 each. With the writer in a process of its own, 100 rounds each, the same appends left it short in 60 rounds and 0.5 ms gaps in 96; watching the folder instead read the same, 61 and 93; 12 busy loops beside them made it 84 and 91 on the file and 81 and 90 on the folder. A watch's lost write never came long after its last event: at most 0.99 ms idle and 1.26 ms loaded on the file, and 1.62 ms idle and 1.52 ms loaded across two names in a folder. Another name in the same folder lost nothing: 0 of 400 rounds, 200 of them loaded, its event arriving while the first name's were dropped. That it is a debounce per path inside Bun is what this looks like and is not read in its source.

Real Claude writes that close together. Over four windows of 270 to 285 s, busy-polling the size of the running transcripts of one project with a loop whose 99.9th percentile was 20 us and whose slowest pass was 7 ms, 73 of 143 consecutive size changes on a file sat under 1.5 ms apart. 71 of those were under 0.25 ms and were one append split in two: its first write ended on a 4096-byte offset every time, 71 of 71, so a file can hold a cut line for that long even though a 10 ms poll never saw one. None of those left a read short, since an event takes longer than that to reach a read (reasoned, not measured). The other 2 were separate appends, 1.03 and 1.28 ms apart. Of 79 bursts on those files a raw watch left one short, the 1.03 ms pair: the last 1177 bytes stayed unread for 981 ms, until the next write happened to come.

So a watch hands every event on at once and, once 20 ms have passed with no event, hands on each name heard since the last look once more, and a new event restarts that wait. Twenty is a guard, twelve times the slowest lost write above, and it sits inside the gap real bursts leave: none of the 143 changes came between 1.5 ms and 100 ms after the one before, so a burst gets one second look, and a lost line arrives about 20 ms late rather than at the next write. Only names heard are repeated, and only until the look, so a filter by name spares everything it spared before and a folder repeats nothing it was not told about. It runs only behind an event, and an idle file costs nothing. A second look that finds a file as it was reads and publishes nothing: 1.07 ms of CPU per look more than the same loop with no looks for a tail, and 7.0 ms more for a screen's subagent activity, which reads a 64 KiB tail again (a median over five runs of 1000 looks in Bun on the laptop). Waiting for a session's file rebuilds its project folders' watches on every event from the folder that holds them, so a new project folder rebuilds them once more on its look: left alone, since that folder only moves when a new project appears and one wasted rebuild costs less than a second way of watching (reasoned, not measured). The burst test that started this, its whole file on Bun beside 12 busy loops, failed 5 of 78 runs without the look and 0 of 106 with it.

Deleting a folder under a Bun `fs.watch` reports the folder's own name, and after that the watch hears nothing, though it neither closes nor fails: a folder made again under the same path stayed silent (measured on Bun 1.4.4). Renaming it away reported nothing at all. A watch that must outlive its folder opens again when it hears its own name. Claude touches its pid folder as it starts, which reports that same name, so each new Claude costs one reopen and one read of the folder.

The effect file system stats each rename event in a fiber of its own before it hands the event on, so two events that arrive together reach the stream in the order their stats finish. The folder's own name overtook the deleted file's in 11 of 60 deletes, even though the raw watch reported the file first in 40 of 40 (measured). A stream that stops at the folder's name therefore never hears the file, so that name means reading the whole folder again and forgetting what it no longer holds. Before this, a session file deleted that way stayed known and the deletion woke nothing, in 8 of 60 deletes, and in none of 60 after (measured).

`fs.watch` throws on a folder it may not read, and the effect file system opens its watcher inside a synchronous effect, so `EACCES` arrives as a defect rather than a `PlatformError`, and a retry alone would let it through (measured). A watch that must keep trying turns the defect into its own failure first. The retry starts from the same 100 ms as the reconnect to herdr, a guard and not a measurement: nothing measured says how soon a failed watch is worth trying again.
:::

:::warning
A test of the service unit takes every variable name spelled alone in a quoted string, in the code the agent bundles, for one the agent reads. A constant holding a setting only the hub reads, in a member both import, failed it (measured). A sentence holding the name passes.

Never run `install-service`, `uninstall-service`, `systemctl --user` start/enable/stop or `launchctl` against the real user's session, not even with a temporary `HOME`: `systemctl --user` talks to the running user manager whatever `HOME` says. The installer reaches them only through a service whose test layer records the calls. Check a generated unit offline with `systemd-analyze verify` on a file under `tmp/`, which reports a missing binary or a bad directive and starts nothing (measured), and a plist with Python's `plistlib`.
:::

:::tip
A `bun build --compile` binary reports its own path as `process.execPath`, and `Bun.main` sits under `/$bunfs/`; from a checkout `process.execPath` is bun and `Bun.main` is the script (measured). That is how the agent tells which command runs it.
:::
