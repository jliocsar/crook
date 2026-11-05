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

Sync commit: `5cad416`

The command compares these files with that commit and exits 2 when any of them moved. Each line
is the file, then the functions the model stands for.

```coverage
packages/domain/src/Transcript.ts           positionAfter continuesFrom inSession omittedUpTo
packages/protocol/src/TranscriptBatch.ts    batchWith withChunk withOpened intoSession eventsOf updatesOf isFull awaitsCatchUp isCaughtUp takeWhen
packages/protocol/src/Transcripts.ts        TranscriptOutOfStep TranscriptWatchFailed
packages/claude/src/TranscriptTail.ts       open available follow drain tailStart
packages/agent/src/TranscriptStreams.ts     fromLineNearEnd openSession finishSession fromSession sessionsOf followPane publishAll runWatch serve
packages/agent/src/HubLink.ts               session transcriptLinkOf
packages/hub/src/TranscriptRelay.ts         watch linkFor askedForDemands stillCounts publishOver demandOf forward forwardInSession append fail deliver publish
packages/hub/src/HttpRoutes.ts              serveAgentAs WatchTranscript TranscriptDemands PublishTranscriptBatch
packages/web/src/chat/TranscriptState.ts    applyTranscriptEvent freshLines catchingUpAfter catchingUpFrom failedWith resumeOf isShowable isOpened
packages/web/src/atoms/Transcript.ts        transcriptViews settle resume apply watchOnce
packages/web/src/rpc/HubLink.ts             whileConnected watchTranscript
packages/web/src/cache/TranscriptCache.ts   remember load
```

An `effect` bump touches it too: the model's `SwitchMapSwitches` rests on `Channel.mergeAll`
keeping what an interrupted inner stream already queued, and the hub's permit on
`Semaphore`. Nothing compares those; read them after a bump.

## Run it

```sh
bun run verify:transcript-pipe               # everything, about 2 minutes
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

The run has six parts, each a line per check:

- `holds/*`: rules that must hold on the code as it is.
- `finding/*`: rules the code as it is breaks, below. Each breaks exactly as expected, and the
  real code walks the same steps to the same state.
- `reach/*`: steps no bug path or random walk reaches, such as a refused chunk, walked through the
  real code on a path TLC finds to them.
- `jc147/*`: the same model with the phone's view reset that JC-147 plans. This is a prediction:
  it runs nothing real.
- `can-fail/*`: each rule failing on a broken variant of the code it guards. A check never seen
  failing proves nothing. `OneSessionShown` has no line here because the code as it is already
  breaks it: `finding/F1` against `jc147/F1-gone` shows it failing and holding.
- `replay/*`: fixed random walks through the real relay, mailbox and view, comparing every
  position, line and mailbox after every step, plus nine cases through the real
  `TranscriptStreams.follow` over real files. `replay/every-step` fails if any step of the model
  was never walked through the real code: without it, a replay that passes says nothing about
  the steps it skipped. It runs only on a whole run, not under `--only`.

## The rules

| Rule | In one sentence | The harm when it breaks |
|---|---|---|
| `NoDuplicateLine` | The phone never shows the same line twice | Repeated rows, and row keys that collide in React and the virtualizer |
| `NoHole` | Everything before a shown line is shown or marked as left out | Part of the conversation is missing and nothing says so |
| `FinishesSessionItLeaves` | A session the phone started showing is finished before it leaves it | The old session's last lines are gone with no mark |
| `OneSessionShown` | A thread shows one session | The old conversation stays above the new one |
| `NoFalseClear` | "Conversation cleared" appears only when the session changed | A divider that lies |
| `NeverRewinds` | The phone never goes back to a session the pane already left | The chat jumps back to a conversation that is over |
| `NeverStuckCatchingUp` | With a live link and nothing left to do, the phone is not catching up | The pill and held rows stay until something else happens |
| `ShowsPaneSession` | With a live link and nothing left to do, the phone is in the pane's session | The chat shows the wrong conversation |
| `NeverBehindFile` | With a live link and nothing left to do, the phone holds the whole file | Lines the laptop has never arrive |
| `AlwaysSettles` | Every retry ends | A restart loop that burns the agent and never delivers |

## What it found

These are bugs in the code, kept as findings: never weaken a rule or the model to make one go
away. Each runs as `finding/*`, so its line stops being "ok" the day the code changes.

**F1, `OneSessionShown`: old lines stay under the new session.** Fixed by JC-147.

1. The pane's `claudeSession` changes from A to B, and `switchMap` starts `fromSession(B, A@n)`.
2. `finishSession` drains A, then `opened(B)` goes out, and `deliver` forwards it.
3. `applyTranscriptEvent` on the phone: `freshLines` appends `SessionCleared` and keeps every line
   of A.

Harm: the thread shows A's conversation above B's. It is the design today, and this rule says what
the user wants instead.

**F2, `NoDuplicateLine`: going back to a session shows its lines again.** Fixed by JC-147.

1. The pane goes A, B, A, with the phone holding A's line 0 and the hub at B.
2. `fromSession(A, B@n)` finishes B, then `openSession(A, TRANSCRIPT_START)`.
3. `deliver` forwards `opened(A)`, since the hub's position is in B, and moves it to A@0.
4. `continuesFrom` accepts the chunk from 0. The phone appends line 0 again.

Harm: repeated rows, and row keys that collide (measured in
`tmp/redesign/research-bugs.md`, bug 3).

**F4, `NeverBehindFile`: a return inside the switch queue leaves the hub at offset 0.** Not fixed
by JC-147, which makes it worse. Needs the pane to go A, B, A while `opened(B)` is still in
`mergeAll`'s queue: microseconds on an idle pipe, longer while a full mailbox holds the queue up
behind a slow phone.

1. The pane leaves A, and `opened(B)` is queued, ahead of `Stream.tap`, so the `Ref` still says A@n,
   the end of the file.
2. The pane returns to A. The next inner stream reads that `Ref`, and `fromSession(A, A@n)` sends
   `opened(A)` and `caughtUp A`, with no chunk: it believes it is at the end.
3. `deliver` forwards `opened(B)`, then `opened(A)`, since the position is in B: the position is
   A@0, and the phone's too.
4. The phone is caught up and holds position A@0 while the agent idles at A@n.

Harm today: a position behind, until the next line is refused and the restart re-reads the tail,
repeating lines. With JC-147's reset: an empty thread that says it is caught up, until Claude
writes again.

**F5, `FinishesSessionItLeaves`: a session change right after a cold open drops the old session's
end.** JC-147 makes it moot, since it shows no old session. Needs the session to change while
`opened(A)` is still in `mergeAll`'s queue on a cold open, which is a very short window.

1. A cold watch: `opened(A)` and a chunk are queued, and a further line lands in A.
2. The pane moves to B. The next inner stream reads `Ref` as `None`, so `fromSession` has no session
   to finish and only opens B.
3. The queue drains: `opened(A)`, the chunk, `opened(B)`. A's later line never arrives.

Harm: A's last lines are missing above the divider, with no mark.

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
cold watch has `opened(A)` tapped and its chunk 0-1 still in `mergeAll`'s queue when the pane
leaves A, so `Ref` says A@0 and `finishSession` reads chunk 0-1 again. The batch
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
3. Run the command. A `finding/*` that no longer breaks means the code fixed it: delete the check,
   delete its entry under "What it found", and if a `jc147/*` predicted it, delete that too.
4. A new rule gets a `can-fail/*` line: add a `Broken` value to the model that undoes the check
   in the code, and see it fail.
5. Only once you have confirmed the model describes the code at the new commit, move the sync
   commit above to that commit. Moving it without reading the diff makes this check lie.

**When JC-147 lands:** set `Jc147` to the code's behaviour by making the reset the model's only
behaviour, remove the flag, and turn `SessionCleared` out of `linesAfter` and `Replay.ts`.
`finding/F1` and `finding/F2` go away as `jc147/F1-gone` and `jc147/F2-gone` predict.
`finding/F4` stays, and turns from a position behind into an empty thread.
Removing the drain from `fromSession` (its change 6) means removing `DRAIN` from `startInner`;
`FollowReplay.ts`'s cases that finish a session change with it.

## Bounds and assumptions

Every check is one pane, one chat, one agent, one hub, with lines counted, not bytes.

| Bound | Value |
|---|---|
| Sessions | `A, B` for the `holds/*` checks; `A, B, A` for the return findings |
| Lines in a file | 1 at the start, 1 written later; 3 in the backlog check; 2 and 2 more in the tail check |
| Tail | 1 line; 3 in the backlog check |
| Mailbox | full at 2 lines |
| `mergeAll` queue | 2 events; the real one holds 16 |
| Disruptions | as each `holds/*` line says: each connection drop, follow failure, reopen and pane gap at most once, and the two drops together |

Assumed, not checked: Claude only appends whole lines, and only to the pane's current session.
One `Semaphore` waiter at a time (at most one dead socket's call). A delayed call is allowed only
when `SocketsMayReorder` is on, and `holds/late-publish-from-dead-socket` is the check that turns
it on. A dead link is never the newest to ask for demands once its successor has: a client speaks
only after its upgrade's reply, so links are minted in the order the agent's real connections
started, and a dial the agent gave up on never asks, so it fences nothing. Fairness on the pipe's own steps for `AlwaysSettles`. `awaitsCaughtUp` is true: a current
agent.

## What it does not cover

- Rosters, skills and background events: they share the mailbox but carry no promise here.
- Subagent watches. They share the relay and the phone, and never change session.
- `shownAfter`, the held-back view, the rows, the virtualizer and everything after
  `TranscriptView`. JC-151 walks the phone's machines in their real code.
- A file that is rewritten, or an offset from another file: a rejected resume is modelled as an
  arbitrary `TranscriptResumeRejected`, not from its cause.
- An agent older than the hub (`awaitsCaughtUp` false), and several phones on one pane, whose
  watches are independent.
- A hub restart, except as both connections dropping.
- A `watchTranscript` stream that ends with `HubConnectionLost` while `connected` stays the same,
  and a publish that dies of a defect: both would leave a watch nothing restarts, and neither is
  modelled.
- `transcriptViews`' fibers are replayed by hand in `Replay.ts` from the pure functions it calls;
  the atom itself is not run.
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