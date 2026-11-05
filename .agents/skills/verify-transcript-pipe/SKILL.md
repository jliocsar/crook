---
name: verify-transcript-pipe
description: Model-check crook's transcript pipe (agent, hub, phone) with TLC and replay its behaviours through the real code. Use when a change touches TranscriptStreams, TranscriptBatch, TranscriptRelay, TranscriptState, atoms/Transcript, TranscriptTail or TranscriptCache, or anything about reconnects, resends, session changes, catching up or transcript positions.
---

# Verify the transcript pipe

The promise: whatever order reconnects, resends, drops and session changes come in, the phone
never shows a duplicate line, never has a hole, never shows an old session's line in the new
session, and never gets stuck catching up on a live link.

A test checks the orders someone thought of. `model/TranscriptPipe.tla` checks every order of
the model's steps within its bounds, and the replay walks those behaviours through the real
relay, mailbox, phone view and follow, so the model and the code cannot drift apart unnoticed.
TLA+ with TLC, because the question is whether events can happen in a bad order, and a bug here
lives between three processes, where a unit test holds one still.

## Does your change touch it?

Sync commit: `68940b1`

The command compares these files with that commit and exits 2 when any of them moved. Each line
is the file, then the functions the model stands for.

```coverage
packages/domain/src/Transcript.ts           positionAfter continuesFrom reachesPast inSession omittedUpTo omittedBetween
packages/protocol/src/TranscriptBatch.ts    batchWith withChunk withOpened intoSession eventsOf updatesOf isFull awaitsCatchUp isCaughtUp takeWhen
packages/protocol/src/Transcripts.ts        TranscriptOutOfStep TranscriptWatchFailed
packages/claude/src/TranscriptTail.ts       open available follow tailStart
packages/agent/src/TranscriptStreams.ts     fromLineNearEnd openSession sessionsOf followPane publishAll runWatch serve
packages/agent/src/HubLink.ts               session transcriptLinkOf
packages/hub/src/TranscriptRelay.ts         watch linkFor askedForDemands stillCounts publishOver demandOf forward forwardInSession append passOnCaughtUp fail deliver publish
packages/hub/src/HttpRoutes.ts              serveAgentAs WatchTranscript TranscriptDemands PublishTranscriptBatch
packages/web/src/chat/TranscriptState.ts    applyTranscriptEvent freshLines resumeOf isOpened withOneHole
packages/web/src/chat/TranscriptMachine.ts  transition arrived watchEnded resumed landed leftSession startedOver earlierAsked
packages/web/src/atoms/Transcript.ts        transcriptViews settle resume apply watchOnce
packages/web/src/rpc/HubLink.ts             whileConnected watchTranscript
packages/web/src/cache/TranscriptCache.ts   remember load
```

An `effect` bump touches it too: the model's `SwitchMapSwitches` rests on `Channel.mergeAll`
keeping what an interrupted inner stream already queued, and the hub's permit on
`Semaphore`. Nothing compares those; read them after a bump.

## Run it

```sh
bun run verify:transcript-pipe               # everything, about 4 minutes
bun run verify:transcript-pipe --only holds  # the checks whose name contains the word
```

It needs `tlc` on the PATH (TLC2 Version 2.19, from tla2tools 1.7.4, pinned by mise as
`http:tla2tools`; a `tlc` that reports another version fails the run) and `bun install` done, so
the real members resolve. TLC gets a 1 GB heap and one worker. On a machine shared with other
heavy work, take whatever lock it uses around the whole command.

Output lands in `tmp/verify-transcript-pipe/`: one `.cfg` and one `.out` per check.

| Exit | Meaning |
|---|---|
| 0 | Every check came out as this file says, and no covered file moved |
| 1 | A check came out differently: read "Bug or modeling error" |
| 2 | Every check came out as expected, but covered code moved since the sync commit: the model may no longer describe it. Read "When a change is intended" |

The run has five parts, each a line per check:

- `holds/*`: rules that must hold on the code as it is.
- `finding/*`: rules the code as it is breaks, below. Each breaks exactly as expected, and the
  real code walks the same steps to the same state.
- `reach/*`: steps no bug path or random walk reaches, such as a refused chunk, walked through the
  real code on a path TLC finds to them.
- `can-fail/*`: each rule failing on a broken variant of the code it guards. A check never seen
  failing proves nothing.
- `replay/*`: fixed random walks through the real relay, mailbox and view, comparing every
  position, line and mailbox after every step, plus thirteen cases through the real
  `TranscriptStreams.follow` over real files. `replay/every-step` fails if any step of the model
  was never walked through the real code: without it, a replay that passes says nothing about
  the steps it skipped. It runs only on a whole run, not under `--only`.

## The rules

| Rule | In one sentence | The harm when it breaks |
|---|---|---|
| `NoDuplicateLine` | The phone never shows the same line twice | Repeated rows, and row keys that collide in React and the virtualizer |
| `NoHole` | Everything before a shown line is shown or marked as left out | Part of the conversation is missing and nothing says so |
| `OneSessionShown` | A thread shows one session, and no lines before it knows which | The old conversation stays above the new one |
| `NoRepeatedOpen` | The hub never tells the phone to open the session it is already in | The phone would rely on its own filter, which an older phone does not have |
| `NeverRewinds` | The phone never goes back to a session the pane already left | The chat jumps back to a conversation that is over |
| `NeverStuckCatchingUp` | With a live link and nothing left to do, the phone is not catching up | The pill and held rows stay until something else happens |
| `ShowsPaneSession` | With a live link and nothing left to do, the phone is in the pane's session | The chat shows the wrong conversation |
| `NeverBehindFile` | With a live link and nothing left to do, the phone holds the whole file | Lines the laptop has never arrive |
| `AlwaysSettles` | Every retry ends | A restart loop that burns the agent and never delivers |
| `WholeShowsAll` | With a live link and nothing left to do, a chat that asked for the whole file holds no hole | Show earlier leaves part of the conversation out |
| `AtMostTwoHoles` | A view holds at most two holes | Repeated gaps grow what the phone keeps and shows without bound |

## What it found

A bug found here is kept as a finding until it is fixed: never weaken a rule or the model to make
one go away. Each runs as `finding/*`, so its line stops being "ok" the day the code changes. One
is open today.

**Open: a chat left open gains a hole per reconnect.** `AtMostTwoHoles` holds for a chat opened from
the cache, since the cache folds as it hands a view back. A chat that stays open and reconnects three
times over a wide gap holds three, and the real relay and view walk the same 60 steps to it. The
next open folds them, and each reconnect adds a tail where it used to add the whole gap. Folding on
the spot would take rows from under a reader scrolled up to them, so that is the user's call.

**Settled: a return inside the switch queue.** Needs the pane to go A, B, A while `opened(B)` is
still in `mergeAll`'s queue: microseconds on an idle pipe, longer while a full mailbox holds the
queue up behind a slow phone.

1. The pane leaves A, and `opened(B)` is queued, ahead of `Stream.tap`, so the `Ref` still says A@n,
   the end of the file.
2. The pane returns to A. The next inner stream reads that `Ref`, and `openSession` from A@n sends
   `opened(A)` and `caughtUp A@n`, with no chunk: it believes it is at the end.
3. `deliver` forwards `opened(B)`, then `opened(A)`, since the position is in B, and the phone
   starts over: both are at A@0, with nothing shown.

It used to end there, an empty thread saying it was caught up until Claude wrote again. The mark
names the offset the agent read to, and that offset is past the position, so the relay now refuses
the mark with `TranscriptOutOfStep`, and the agent restarts from A@0. The fix lives at the hub only:
every agent that sends the mark has named that offset since the mark exists, and every agent answers
a refusal by restarting, so an agent older than the hub is covered too. A mark merged behind a later
chunk names an offset before the position, and passes. `holds/return-inside-switch-queue` and
`can-fail/caught-up-unchecked` show the rule holding with the refusal and failing without it, and
`reach/caught-up-refused` walks the refusal through the real relay.

**Settled: a late publish from a dead socket.** It used to rewind the hub: the agent's first
attempt published `[opened A, chunk 0-1, caughtUp A]`, its socket died with that call undelivered,
the agent reconnected, and the old call landed afterwards. `opened A` moved the position back to
A@0, its chunk was accepted because it continued that position, and the phone jumped back to the
finished conversation with its lines repeated. It happens through a real socket, which
`TranscriptFence.test.ts` holds: `RpcServer` runs a dead connection's handler for a frame it read
before the socket ended. The relay now fences by connection: `linkFor` mints a link per upgrade, a
link counts until a later one asks for demands, and a call on a link that stopped counting drops
what is left of its updates and still replies. `holds/late-publish-from-dead-socket` and
`can-fail/no-fence` show the rule holding with the fence and failing without it, and
`reach/fenced-call-dropped` walks the drop through the real relay.

A refusal is not a finding on its own: `reach/live-chunk-refused` gets one with no drop at all. A
cold watch has `opened(A)` tapped and its chunk 0-1 still in `mergeAll`'s queue when the pane goes
to B and back, so `Ref` still says A@0 and the return reads chunk 0-1 again. The batch
`[opened A, chunk 0-1, chunk 0-1]` reaches the relay, `continuesFrom` refuses the second, and the
agent restarts from A@1. It costs one round trip, and the phone sees no repeat.

What this settles: CLAUDE.md records the position moving in the same transaction as the inbox
offer as reasoned, not measured. `can-fail/forward-two-steps` shows it in the model: split the two,
interrupt between them, and the resend reaches the phone twice.

## Read a result with /statechart

Read every result with the `/statechart` skill. For a violation it gives the shortest path to
each broken rule in plain words; for a pass it draws how the system moves. Give it
`model/TranscriptPipe.tla`, the check's `.cfg` from `tmp/verify-transcript-pipe/`, and
`model/ChartView.ts` as its view. A config over its state budget draws only the bug paths, so
the smallest config that shows the thing is the one to give it.

The command also prints the steps of an unexpected break, each with what it moved: the action
name is the code, `HubForwardsOpen` is `deliver` forwarding a `TranscriptOpened`, and the comment
above each action in the model names its source.

## Bug or modeling error

Start from which line failed.

**A `replay/*` line, or a `finding/*` line saying the real code does not walk the path.** The
model and the code disagree, at the step it names. If you changed that code on purpose, the model
is out of date: see below. If not, your change broke the code: the message says what the code did
and what the model expected, and `can-fail/*` names the rule that guards it.

**A `holds/*` or `can-fail/*` line reporting a broken rule on code you did not mean to change
the behaviour of.** The model has no copy of your code, so TLC reporting a new break means the
model changed. Check the model edit first.

**A rule breaks after you changed the model to match a code change.** Tell the steps as a story
in the code's words and replay them: the `finding` checks do it through `replayOnce`, so add the
config as a finding and let the real code walk it.

- It walks it to the same state: a real bug. Report it with those steps. Do not change product
  code to chase a finding nobody asked you to fix, and do not weaken the rule.
- The real code refuses a step: the model allows something the code cannot do. A modeling error;
  tighten the action's guard to what the code really requires, and cite that code.

One trap: the model steps are finer than the code's in places that are safe, such as a chunk per
line where the code reads up to `CHUNK_READ_LIMIT`. A bug that needs a step the code never takes
is a modeling error, and the replay is what tells.

## When a change is intended

1. Read the diff of the covered files against the model, action by action. Each action names
   its code in a comment.
2. Change the model to say what the code now says, and keep the comment true. Change `Replay.ts`
   or the `FollowReplay.ts` cases where the wire or the view changed shape.
3. Run the command. A `finding/*` that no longer breaks means the code fixed it: delete the check
   and its entry under "What it found".
4. A new rule gets a `can-fail/*` line: add a `Broken` value to the model that undoes the check
   in the code, and see it fail.
5. Only once you have confirmed the model describes the code at the new commit, move the sync
   commit above to that commit. Moving it without reading the diff makes this check lie.

## Bounds and assumptions

Every check is one pane, one chat, one agent, one hub, with lines counted, not bytes.

| Bound | Value |
|---|---|
| Sessions | `A, B` for most checks; `A, B, A` for the return checks |
| Lines in a file | 1 at the start, 1 written later; 3 in the backlog check; 2 and 2 more in the tail check |
| Tail | 1 line; 3 in the backlog check |
| Mailbox | full at 2 lines |
| `mergeAll` queue | 2 events; the real one holds 16 |
| Big gap | a resume with more lines left than a full mailbox skips to the last line, a full mailbox standing for one read; `Writes: 3` is the fewest that lands a hole on `SessionPath: PathReturn` |
| Disruptions | as each `holds/*` line says: each connection drop, follow failure, reopen and pane gap at most once, and the two drops together |

Assumed, not checked: Claude only appends whole lines, and only to the pane's current session.
One `Semaphore` waiter at a time (at most one dead socket's call). A delayed call is allowed only
when `SocketsMayReorder` is on, and `holds/late-publish-from-dead-socket` is the check that turns
it on. A dead link is never the newest to ask for demands once its successor has: a client speaks
only after its upgrade's reply, so links are minted in the order the agent's real connections
started, and a dial the agent gave up on never asks, so it fences nothing. Fairness on the pipe's own steps for `AlwaysSettles`. `awaitsCaughtUp` is true: a current
agent.

## A skip over a big gap

A resume with more than one read left to go sends an omitted-lines chunk from its offset to a line
start near the end, then reads on from there. The model gives every chunk a body of lines and
omitted runs, because a mailbox joins chunks that continue each other and a hole can then sit in the
middle of one. `Show earlier` restarts the watch from nothing with no tail, and the cache folds a
view down to one hole as it hands it back. To the machine a skip is one more chunk: it has no event
or case of its own, and the machine's walk tries one from every state and holds it to the arrow a
chunk of lines takes there.

Whether a view is being read whole sits on the view, as it sits on the fold in the code, and the
replay compares it at every step, the cached view's included. A rejected resume and a session change
both clear it. A session read whole restarts from the tail when the next one opens, atomically here:
the machine drops what the old watch still sends until the new one has been asked, so nothing lands
between the two steps. The view also keeps the position that was on screen when Show earlier was
pressed, since a read that opens another session before its first position has left it too.
`holds/session-change-while-whole`, `reach/whole-left` and `can-fail/whole-survives-session` are
that rule, and removing the restart from the real machine fails `reach/whole-left` at the step that
lands the open.

No rule breaks from the skip. `can-fail/skip-not-marked`, `can-fail/skip-from-start`,
`can-fail/whole-takes-tail`, `can-fail/no-fold` and `can-fail/fold-not-marked` show the guards
failing without it. `can-fail/no-fold` needs three reopens that each land a gap: at `Writes: 4` the
model only reached two holes and said every rule holds, which proved nothing about the fold.

A `holds/*` line over a bound that never reaches the step it names is empty, and says so by nothing.
`holds/return-over-big-gap` held at `Writes: 2`, where no hole ever landed; `reach/hole-on-return`
is what showed it, so a bound for a new step gets a `reach/*` line beside it.

`UserShowsEarlier` is enabled only from a view on screen, not from one held back: a press there asks
the same of the pipe, a new watch from nothing, and the machine ignores it in the states that show no
rows, which this model does not track. The machine's walk holds which states take it.

A real-code mutation shows the replay's half: dropping the chunk that marks the skip fails
`replay/follow` on 5 of 13 cases, skipping a gap one read covers fails it on 2, and a cache that does
not fold fails `reach/hole-folded` at its reopen.

## What it does not cover

- Rosters, skills and background events: they share the mailbox but carry no promise here.
- Subagent watches. They share the relay and the phone, and never change session.
- What the phone's machine shows while it holds a fold back, its show delay and hold, Show earlier,
  the rows and the virtualizer. The replay steps the machine's real `transition` for arrivals,
  failures and resumes, and never steps a timer; the machine's own walk holds the rest.
- A file that is rewritten, or an offset from another file: a rejected resume is modelled as an
  arbitrary `TranscriptResumeRejected`, not from its cause.
- An agent older than the hub (`awaitsCaughtUp` false), and several phones on one pane, whose
  watches are independent.
- A hub restart, except as both connections dropping.
- A publish that dies of a defect: the agent tells the phone the watch failed, and a test holds it.
  If that call dies too, the watch stays dead until the next connection or re-watch.
- `transcriptViews`' fibers are replayed by hand in `Replay.ts` from the machine it drives; the atom
  itself is not run. Its reopen calls the fold directly, so that the cache's own load goes through
  the fold is held by the cache's tests, not here.
- A mailbox that holds a step back. The replay compares the agent's outbox fullness after each
  step, but it cannot see a hub inbox that takes more than the model lets it, since the model
  simply takes no step there.
- A pass covers this model at these bounds. It is evidence about the design, not a proof about
  the whole system.

## Files

- `model/TranscriptPipe.tla`: the model, its rules and its broken variants.
- `model/ChartView.ts`: the phone's words, for `/statechart`.
- `verify.ts`: the one command, and the table of checks and their expected results.
- `Replay.ts`: steps a TLC behaviour through the real relay, mailbox and view.
- `FollowReplay.ts`: the agent's half, through the real `TranscriptStreams.follow`.
- `TraceReader.ts`: reads TLC's printed behaviour.
- `tsconfig.json`: lets a script here reach the members' leaves, since nothing hoists them.