---------------------------- MODULE TranscriptPipe ----------------------------
(***************************************************************************)
(* The transcript pipe: Claude's file -> agent -> hub -> phone.             *)
(*                                                                         *)
(* One pane, one chat, one agent, one hub. Offsets count lines; the code   *)
(* counts bytes and only ever cuts on a line (TranscriptTail.afterRead).   *)
(* Every action names the code it stands for.  See SKILL.md beside this    *)
(* folder for the coverage record and how to read a result.                *)
(*                                                                         *)
(* What one step is, and why that is true to the code:                     *)
(* - A read is one line per step; the code reads up to CHUNK_READ_LIMIT at *)
(*   once. One line a step only adds orders the code can't reach, and the  *)
(*   mailbox joins them back (withChunk).                                  *)
(* - TapOffers is one step, though Stream.tap runs just before outbox.offer*)
(*   and the offer can block with the Ref already moved. The model's order *)
(*   makes the next inner stream read the older position, the worse of the *)
(*   two, and the hub refuses what that re-reads.                          *)
(* - Each update of a publish is its own step, because the handler can be  *)
(*   interrupted between two of them; forward itself is one, Effect.tx.    *)
(* - A reply is merged with the last update it answers. Only one call is   *)
(*   out at a time, so a late reply is the agent being slower.             *)
(* - A phone applies one event per step, and a drop can land between two.  *)
(* - Rosters, skills and background events are left out; see SKILL.md.     *)
(***************************************************************************)
EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
  NONE,               \* a model value: Option.none(), and it compares with anything
  SessionPath,        \* claudeSession values the pane goes through, in order (sessionsOf)
  FirstFileLines,     \* lines already in the first session's file when the chat opens
  TailLines,          \* CHAT_OPEN_TAIL, atoms/Transcript.ts
  MailboxCapacity,    \* CHUNK_READ_LIMIT in lines: isFull in TranscriptBatch.ts
  SwitchQueueSize,    \* the bounded queue inside Channel.mergeAll behind Stream.switchMap
  Writes,             \* how many lines Claude may append
  PaneGaps,           \* how often the agent row may lose its claudeSession
  AgentDrops,         \* how often the agent's hub connection may die
  PhoneDrops,         \* how often the phone's hub connection may die
  WatchFailures,      \* how often the agent's follow may fail
  Reopens,            \* how often the chat may be closed and opened from the cache
  ShowEarliers,       \* how often Show earlier may be pressed
  SocketsMayReorder,  \* can a message on a dead agent socket reach the hub after one on its successor?
  WalkLength,         \* how long a random walk is before the replay takes it
  Broken              \* "none" for the code as it is; otherwise one broken variant

\* Named so a TLC config can pick one: a config has no syntax for a tuple.
PathOne == <<"A">>
PathStraight == <<"A", "B">>
PathReturn == <<"A", "B", "A">>

Sessions == {SessionPath[i] : i \in 1..Len(SessionPath)}
FailureKinds == {"read", "rejected"}

VARIABLES
  pane,      \* [at: index in SessionPath, gone: row has no claudeSession]  (MachineStateSync)
  file,      \* lines in each session's jsonl, append only
  budget,    \* what the environment may still do
  agentUp,   \* HubLink.session is connected
  fiber,     \* the runWatch fiber of this watch: publishAll + followPane
  call,      \* the PublishTranscriptBatch in flight on the live connection: NONE or updates left
  stale,     \* the one a dead connection left at the hub: NONE or updates left
  superseded, \* TranscriptRelay's latestLinks: a later link has asked for demands, so stale no longer counts
  permit,    \* Watcher.delivery semaphore: "free", "live" or "stale"
  watcher,   \* [alive: in the watchers map, delivered: the TxRef, tail: the watch carries one]
  moving,    \* only for Broken = "forward-two-steps": the position move not yet done
  inbox,     \* Watcher.inbox, a TranscriptMailbox
  wire,      \* the message on its way to the phone, not fully applied yet
  mode,      \* phone: "watching" | "failed" (settle waits for a restart) | "offline"
  view,      \* phone: the TranscriptView in transcriptViews
  cached,    \* phone: TranscriptCache's remembered view, or NONE
  ghost      \* not in the code: history the rules read

vars == <<pane, file, budget, agentUp, fiber, call, stale, superseded, permit, watcher, moving,
          inbox, wire, mode, view, cached, ghost>>

-----------------------------------------------------------------------------
(* @crook/domain/Transcript: continuesFrom, inSession, positionAfter *)

inSession(p, s) == p /= NONE /\ p.s = s

continuesFrom(p, c) == p /= NONE /\ p.s = c.s /\ p.off = c.from

positionAfter(p, u) ==
  CASE u.t = "opened" -> IF inSession(p, u.s) THEN p ELSE [s |-> u.s, off |-> 0]
    [] u.t = "chunk"  -> [s |-> u.s, off |-> u.to]
    [] OTHER          -> p

-----------------------------------------------------------------------------
(* @crook/protocol/TranscriptBatch: the mailbox both agent and hub keep *)

EMPTY_BATCH == [sessions |-> <<>>, failed |-> NONE]

updatesFor(s) == [s |-> s, opened |-> NONE, chunks |-> <<>>, caughtUp |-> NONE]

Last(q) == q[Len(q)]
ButLast(q) == SubSeq(q, 1, Len(q) - 1)

joined(a, b) == [a EXCEPT !.to = b.to, !.body = a.body \o b.body]

withChunk(chunks, c) ==
  IF Len(chunks) > 0 /\ Last(chunks).to = c.from
  THEN Append(ButLast(chunks), joined(Last(chunks), c))
  ELSE Append(chunks, c)

intoSession(sessions, s, Change(_)) ==
  IF Len(sessions) > 0 /\ Last(sessions).s = s
  THEN Append(ButLast(sessions), Change(Last(sessions)))
  ELSE Append(sessions, Change(updatesFor(s)))

withOpened(sessions, u) ==
  IF Len(sessions) > 0 /\ Last(sessions).s = u.s /\ Last(sessions).opened /= NONE
  THEN sessions
  ELSE Append(sessions, [updatesFor(u.s) EXCEPT !.opened = u])

withEvent(sessions, u) ==
  CASE u.t = "opened"   -> withOpened(sessions, u)
    [] u.t = "chunk"    -> intoSession(sessions, u.s,
                             LAMBDA x: [x EXCEPT !.chunks = withChunk(x.chunks, u)])
    [] u.t = "caughtUp" -> intoSession(sessions, u.s,
                             LAMBDA x: [x EXCEPT !.caughtUp = u])

batchWith(batch, u) ==
  IF batch.failed /= NONE THEN batch
  ELSE IF u.t = "failed" THEN [batch EXCEPT !.failed = u]
  ELSE [batch EXCEPT !.sessions = withEvent(batch.sessions, u)]

eventsOf(x) ==
  IF Broken = "updates-out-of-order"
  THEN x.chunks \o (IF x.opened /= NONE THEN <<x.opened>> ELSE <<>>)
         \o (IF x.caughtUp /= NONE THEN <<x.caughtUp>> ELSE <<>>)
  ELSE (IF x.opened /= NONE THEN <<x.opened>> ELSE <<>>) \o x.chunks
         \o (IF x.caughtUp /= NONE THEN <<x.caughtUp>> ELSE <<>>)

RECURSIVE flatEvents(_)
flatEvents(sessions) ==
  IF sessions = <<>> THEN <<>>
  ELSE eventsOf(Head(sessions)) \o flatEvents(Tail(sessions))

updatesOf(batch) ==
  flatEvents(batch.sessions) \o (IF batch.failed /= NONE THEN <<batch.failed>> ELSE <<>>)

isLine(l) == l[1] = "line"

readLines(c) == Len(SelectSeq(c.body, isLine))

RECURSIVE sumChunks(_)
sumChunks(chunks) ==
  IF chunks = <<>> THEN 0 ELSE readLines(Head(chunks)) + sumChunks(Tail(chunks))

RECURSIVE heldLines(_)
heldLines(sessions) ==
  IF sessions = <<>> THEN 0
  ELSE sumChunks(Head(sessions).chunks) + heldLines(Tail(sessions))

isFull(batch) == heldLines(batch.sessions) >= MailboxCapacity

awaitsCatchUp(batch) ==
  /\ Len(batch.sessions) > 0
  /\ Last(batch.sessions).opened /= NONE
  /\ Last(batch.sessions).caughtUp = NONE
  /\ (Broken = "mailbox-holds-when-full" \/ ~isFull(batch))

isCaughtUp(batch) == batch.failed /= NONE \/ ~awaitsCatchUp(batch)

-----------------------------------------------------------------------------
(* @crook/agent/TranscriptStreams: followPane, openSession, fromLineNearEnd *)

NEVER == [stage |-> "never", off |-> 0, tgt |-> NONE, epoch |-> 0,
          caught |-> FALSE, tail |-> TRUE]

OPEN(tgt, off, epoch) == [NEVER EXCEPT !.stage = "open", !.off = off, !.tgt = tgt,
                                       !.epoch = epoch, !.tail = FALSE]

PaneSession == IF pane.gone THEN NONE ELSE SessionPath[pane.at]

\* openSession from startIn(session, position), read through Ref.get(position) when the inner
\* stream first runs. Nothing reads on in a session the pane left: the phone starts over anyway.
startInner(at, tgt, epoch) ==
  IF tgt = NONE THEN NEVER
  ELSE IF inSession(at, tgt) THEN OPEN(tgt, at.off, epoch)
  ELSE OPEN(tgt, 0, epoch)

FIBER_OFF == [running |-> FALSE, at |-> NONE, seen |-> NONE, inner |-> NEVER,
              queued |-> <<>>, outbox |-> EMPTY_BATCH]

fiberFrom(from) ==
  [running |-> TRUE, at |-> from, seen |-> PaneSession,
   inner |-> startInner(from, PaneSession, pane.at),
   queued |-> <<>>, outbox |-> EMPTY_BATCH]

\* tailStart: a cold open leaves out what is over the tail. A resume reads a gap one read covers,
\* and past that it leaves out what is over the tail too.
unskippedLines(off) ==
  IF off = 0 \/ TailLines > MailboxCapacity THEN TailLines ELSE MailboxCapacity

skips(i, s) ==
  /\ ~i.tail
  /\ watcher.tail \/ Broken = "whole-takes-tail"
  /\ file[s] - i.off > unskippedLines(i.off)

\* omittedBetween, then the read carries on from where the tail starts (fromLineNearEnd).
omittedChunk(i, s) ==
  LET start == file[s] - TailLines
      from == IF Broken = "skip-from-start" THEN 0 ELSE i.off
  IN [t |-> "chunk", s |-> s, from |-> from, to |-> start,
      body |-> IF Broken = "omitted-not-marked" THEN <<>>
               ELSE << <<"omitted", s, from, start - from>> >>]

nextChunk(i, s) ==
  IF skips(i, s)
  THEN omittedChunk(i, s)
  ELSE [t |-> "chunk", s |-> s, from |-> i.off, to |-> i.off + 1,
        body |-> << <<"line", s, i.off>> >>]

Emit(event, nextInner) ==
  /\ Len(fiber.queued) < SwitchQueueSize
  /\ fiber' = [fiber EXCEPT !.queued = Append(@, event), !.inner = nextInner]
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, call, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

FollowReads ==   \* TranscriptTail.available, under follow
  LET i == fiber.inner
  IN /\ fiber.running
     /\ i.stage = "follow"
     /\ i.off < file[i.tgt]
     /\ ~(Broken = "follow-stops-at-caught-up" /\ i.caught)
     /\ LET c == nextChunk(i, i.tgt)
        IN Emit(c, [i EXCEPT !.off = c.to, !.tail = TRUE])

FollowOpens ==   \* opened(session), the first thing openSession sends
  LET i == fiber.inner
  IN /\ fiber.running
     /\ i.stage = "open"
     /\ Emit([t |-> "opened", s |-> i.tgt, e |-> i.epoch],
             [i EXCEPT !.stage = "follow", !.tail = FALSE])

FollowCatchesUp ==   \* tail.follow's caughtUp, or the one openSession sends before a file exists
  LET i == fiber.inner
  IN /\ fiber.running
     /\ i.stage = "follow"
     /\ i.off >= file[i.tgt]
     /\ ~i.caught
     /\ Emit([t |-> "caughtUp", s |-> i.tgt, off |-> i.off],
             [i EXCEPT !.caught = TRUE, !.tail = (file[i.tgt] > 0)])

\* sessionsOf changes: Stream.switchMap interrupts the inner stream, and what it already put in
\* the mergeAll queue stays there, ahead of the next one. The next inner reads Ref.get(position)
\* first, and that Ref only moves when an event leaves the queue (Stream.tap).
SwitchMapSwitches ==
  /\ fiber.running
  /\ fiber.inner.stage /= "ended"
  /\ Broken /= "no-switch"
  /\ fiber.seen /= PaneSession
  /\ fiber' = [fiber EXCEPT !.seen = PaneSession,
                            !.inner = startInner(fiber.at, PaneSession, pane.at)]
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, call, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

TapOffers ==   \* Stream.tap moves the Ref; Stream.runForEach(outbox.offer)
  /\ fiber.running
  /\ fiber.queued /= <<>>
  /\ LET u == Head(fiber.queued)
     IN /\ u.t = "failed" \/ ~isFull(fiber.outbox)
        /\ fiber' = [fiber EXCEPT !.queued = Tail(@),
                                  !.at = positionAfter(@, u),
                                  !.outbox = batchWith(@, u)]
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, call, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

Publishes ==   \* outbox.takeCaughtUp, then link.publish; one call at a time
  /\ fiber.running
  /\ call = NONE
  /\ updatesOf(fiber.outbox) /= <<>>
  /\ isCaughtUp(fiber.outbox)
  /\ call' = updatesOf(fiber.outbox)
  /\ fiber' = [fiber EXCEPT !.outbox = EMPTY_BATCH]
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

\* serve -> reconcile: a demand starts a fiber from the watch's delivered position, on every
\* hub connection and for every new watch. The hub's demands runs askedForDemands first, so a call
\* of an earlier link stops counting before the position is read (TranscriptRelay.stillCounts).
DemandStartsWatch ==
  /\ agentUp
  /\ watcher.alive
  /\ ~fiber.running
  /\ moving = NONE
  /\ fiber' = fiberFrom(watcher.delivered)
  /\ superseded' = (Broken /= "no-fence" /\ stale /= NONE)
  /\ UNCHANGED <<pane, file, budget, agentUp, call, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

AgentReconnects ==   \* HubLink: session() retried with hubReconnectSchedule
  /\ ~agentUp
  /\ agentUp' = TRUE
  /\ UNCHANGED <<superseded, pane, file, budget, fiber, call, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

-----------------------------------------------------------------------------
(* @crook/hub/TranscriptRelay: publish, deliver, forward *)

Forwards(u) ==   \* forward: one Effect.tx around inbox.offer and the position move
  IF Broken = "forward-two-steps"
  THEN /\ inbox' = batchWith(inbox, u)
       /\ moving' = positionAfter(watcher.delivered, u)
       /\ UNCHANGED watcher
  ELSE /\ inbox' = batchWith(inbox, u)
       /\ watcher' = [watcher EXCEPT !.delivered = positionAfter(@, u)]
       /\ UNCHANGED moving

MayHoldPermit(who) ==
  /\ permit \in {"free", who}
  /\ moving = NONE
  /\ who = "live" /\ permit = "free" => (SocketsMayReorder \/ stale = NONE)
  /\ who = "stale" => ~superseded

UpdatesLeft(who) == IF who = "live" THEN call ELSE stale

SetLeft(who, left) ==
  /\ call'   = IF who = "live"  THEN left ELSE call
  /\ stale'  = IF who = "stale" THEN left ELSE stale

AfterStep(who, rest) ==
  /\ SetLeft(who, IF rest = <<>> THEN NONE ELSE rest)
  /\ permit' = IF rest = <<>> THEN "free" ELSE who

isOpenFiltered(u) ==
  IF Broken = "open-not-filtered" THEN FALSE ELSE inSession(watcher.delivered, u.s)

HubDropsOpen(who) ==   \* deliver: "inSession(position, opened.session) ? void"
  /\ UpdatesLeft(who) /= NONE
  /\ MayHoldPermit(who)
  /\ watcher.alive
  /\ LET u == Head(UpdatesLeft(who))
     IN /\ u.t = "opened"
        /\ isOpenFiltered(u)
        /\ AfterStep(who, Tail(UpdatesLeft(who)))
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, fiber, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

HubForwardsOpen(who) ==
  /\ UpdatesLeft(who) /= NONE
  /\ MayHoldPermit(who)
  /\ watcher.alive
  /\ ~isFull(inbox)
  /\ LET u == Head(UpdatesLeft(who))
     IN /\ u.t = "opened"
        /\ ~isOpenFiltered(u)
        /\ Forwards(u)
        /\ AfterStep(who, Tail(UpdatesLeft(who)))
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, fiber,
                 wire, mode, view, cached, ghost>>

chunkContinues(u) ==
  Broken = "relay-no-continuity" \/ continuesFrom(watcher.delivered, u)

HubForwardsChunk(who) ==   \* append: continuesFrom ? forward
  /\ UpdatesLeft(who) /= NONE
  /\ MayHoldPermit(who)
  /\ watcher.alive
  /\ ~isFull(inbox)
  /\ LET u == Head(UpdatesLeft(who))
     IN /\ u.t = "chunk"
        /\ chunkContinues(u)
        /\ Forwards(u)
        /\ AfterStep(who, Tail(UpdatesLeft(who)))
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, fiber,
                 wire, mode, view, cached, ghost>>

\* append: TranscriptOutOfStep. runWatch's attempt(outOfStep.expected) restarts the follow from
\* the hub's position; nobody listens to the reply of a call whose connection died.
HubRefusesChunk(who) ==
  /\ UpdatesLeft(who) /= NONE
  /\ MayHoldPermit(who)
  /\ watcher.alive
  /\ LET u == Head(UpdatesLeft(who))
     IN /\ u.t = "chunk"
        /\ ~chunkContinues(u)
        /\ SetLeft(who, NONE)
        /\ permit' = "free"
        /\ fiber' = IF who = "live"
                    THEN fiberFrom(IF Broken = "restart-from-watch-from"
                                   THEN ghost.watchFrom ELSE watcher.delivered)
                    ELSE fiber
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

\* reachesPast: the agent says it read further than the hub ever delivered, so a chunk is missing.
marksPastDelivered(u) ==
  /\ Broken \notin {"caught-up-unchecked", "caught-up-dropped"}
  /\ inSession(watcher.delivered, u.s)
  /\ u.off > watcher.delivered.off

\* passOnCaughtUp: TranscriptOutOfStep. The restart reads from the hub's position, so what the mark
\* claimed reaches the phone, from any agent that sends the mark.
HubRefusesCaughtUp(who) ==
  /\ UpdatesLeft(who) /= NONE
  /\ MayHoldPermit(who)
  /\ watcher.alive
  /\ LET u == Head(UpdatesLeft(who))
     IN /\ u.t = "caughtUp"
        /\ marksPastDelivered(u)
        /\ SetLeft(who, NONE)
        /\ permit' = "free"
        /\ fiber' = IF who = "live" THEN fiberFrom(watcher.delivered) ELSE fiber
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

isCaughtUpForwarded(u) ==
  IF Broken = "caught-up-dropped" THEN FALSE ELSE inSession(watcher.delivered, u.s)

HubForwardsCaughtUp(who) ==   \* forwardInSession
  /\ UpdatesLeft(who) /= NONE
  /\ MayHoldPermit(who)
  /\ watcher.alive
  /\ LET u == Head(UpdatesLeft(who))
     IN /\ u.t = "caughtUp"
        /\ isCaughtUpForwarded(u)
        /\ ~marksPastDelivered(u)
        /\ ~isFull(inbox)
        /\ Forwards(u)
        /\ AfterStep(who, Tail(UpdatesLeft(who)))
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, fiber,
                 wire, mode, view, cached, ghost>>

HubDropsCaughtUp(who) ==   \* forwardInSession: the news of a session it is not in
  /\ UpdatesLeft(who) /= NONE
  /\ MayHoldPermit(who)
  /\ watcher.alive
  /\ LET u == Head(UpdatesLeft(who))
     IN /\ u.t = "caughtUp"
        /\ ~isCaughtUpForwarded(u)
        /\ AfterStep(who, Tail(UpdatesLeft(who)))
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, fiber, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

HubFailsWatch(who) ==   \* fail: the failure goes in the inbox and the watcher leaves the map
  /\ UpdatesLeft(who) /= NONE
  /\ MayHoldPermit(who)
  /\ watcher.alive
  /\ LET u == Head(UpdatesLeft(who))
     IN /\ u.t = "failed"
        /\ inbox' = batchWith(inbox, u)
        /\ watcher' = [watcher EXCEPT !.alive = FALSE]
        /\ SetLeft(who, NONE)
        /\ permit' = "free"
        /\ fiber' = FIBER_OFF
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, moving, wire, mode, view, cached, ghost>>

HubDropsCallOfGoneWatch(who) ==   \* publish: "no phone on this machine watches it any more"
  /\ UpdatesLeft(who) /= NONE
  /\ ~watcher.alive
  /\ SetLeft(who, NONE)
  /\ permit' = "free"
  /\ superseded' = (who = "live" /\ superseded)
  /\ UNCHANGED <<pane, file, budget, agentUp, fiber, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

\* publish and forward: stillCounts is false, so what is left of the call moves nothing. Each
\* update is checked inside forward's transaction, so a call blocked on a full inbox lets go too.
HubDropsFencedCall ==
  /\ stale /= NONE
  /\ superseded
  /\ watcher.alive
  /\ permit \in {"free", "stale"}
  /\ moving = NONE
  /\ stale' = NONE
  /\ superseded' = FALSE
  /\ permit' = "free"
  /\ UNCHANGED <<pane, file, budget, agentUp, fiber, call, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

\* RpcServer.disconnect interrupts the dead connection's handler between two transactions.
HubSeesDeadSocket ==
  /\ stale /= NONE \/ (moving /= NONE /\ ~agentUp)
  /\ stale' = NONE
  /\ superseded' = FALSE
  /\ permit' = IF permit = "stale" THEN "free" ELSE permit
  /\ moving' = NONE
  /\ UNCHANGED <<pane, file, budget, agentUp, fiber, call, watcher,
                 inbox, wire, mode, view, cached, ghost>>

ForwardMovesPosition ==   \* only for Broken = "forward-two-steps"
  /\ moving /= NONE
  /\ watcher' = [watcher EXCEPT !.delivered = moving]
  /\ moving' = NONE
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, fiber, call, stale, permit,
                 inbox, wire, mode, view, cached, ghost>>

HubSends ==   \* inbox.take: one message, and the next only after the phone's acknowledgement
  /\ wire = <<>>
  /\ updatesOf(inbox) /= <<>>
  /\ mode = "watching"
  /\ wire' = updatesOf(inbox)
  /\ inbox' = EMPTY_BATCH
  /\ UNCHANGED <<superseded, pane, file, budget, agentUp, fiber, call, stale, permit, watcher, moving,
                 mode, view, cached, ghost>>

-----------------------------------------------------------------------------
(* @crook/web/chat/TranscriptState + TranscriptMachine + atoms/Transcript.ts: the phone. A view is *)
(* its fold; catching is every machine state that holds a fold back, failed is Failed and Retrying *)

EMPTY_TRANSCRIPT == [position |-> NONE, lines |-> <<>>, catching |-> FALSE, failed |-> FALSE,
                     whole |-> FALSE, shownAt |-> NONE]

isOpened(v) == v.position /= NONE

remembered(v) == isOpened(v) /\ ~v.catching

isOmitted(l) == l[1] = "omitted"

isHole(l) == isOmitted(l) /\ l[3] > 0

holesIn(lines) == {k \in DOMAIN lines : isHole(lines[k])}

Greatest(set) == CHOOSE k \in set : \A other \in set : other <= k

\* withOneHole, which TranscriptCache.load hands every view through: everything down to the hole
\* before the newest becomes one omitted row at the start of the file.
withOneHole(v) ==
  IF Broken = "no-fold" \/ Cardinality(holesIn(v.lines)) < 2 THEN v
  ELSE LET holes == holesIn(v.lines)
           older == Greatest(holes \ {Greatest(holes)})
           kept == SubSeq(v.lines, older + 1, Len(v.lines))
           end == v.lines[older][3] + v.lines[older][4]
       IN [v EXCEPT !.lines =
             IF Broken = "fold-not-marked" THEN kept
             ELSE << <<"omitted", v.lines[older][2], 0, end>> >> \o kept]

linesAfter(v, u) ==
  CASE u.t = "opened" ->
         IF inSession(v.position, u.s) \/ Broken = "open-keeps-lines" THEN v.lines ELSE <<>>
    [] u.t = "chunk" -> v.lines \o u.body
    [] OTHER         -> v.lines

applyTranscriptEvent(v, u) ==
  [position |-> positionAfter(v.position, u),
   lines    |-> linesAfter(v, u),
   catching |-> CASE u.t = "caughtUp" -> FALSE
                  [] u.t = "opened" /\ v.position /= NONE /\ ~inSession(v.position, u.s) -> TRUE
                  [] OTHER -> v.catching,
   failed   |-> FALSE,
   whole    |-> v.whole,
   shownAt  |-> v.shownAt]

\* The machine's leftSession: while the fold has no position yet, the rows on screen name the session,
\* so a read asked for in one session and opening in another counts as having left it.
knownPosition(v) == IF v.position /= NONE THEN v.position ELSE v.shownAt

leavesWholeRead(v, u) ==
  /\ v.whole
  /\ u.t = "opened"
  /\ knownPosition(v) /= NONE
  /\ ~inSession(knownPosition(v), u.s)

seenBy(g, u) ==
  [g EXCEPT
     !.phoneEpoch = IF u.t = "opened" /\ u.e > @ THEN u.e ELSE @,
     !.rewound = @ \/ (u.t = "opened" /\ u.e < g.phoneEpoch),
     !.repeatedOpen = @ \/ (u.t = "opened" /\ inSession(view.position, u.s))]

\* whileDialed + watchOnce: resume reads the view's position and marks it catching up; the
\* hub's watch makes a new watcher with its own inbox and delivered = from; reconcile stops the
\* fiber of the watch that went away. resumeOf asks for the tail unless the view is being read whole.
Resume(v, nextMode) ==
  /\ view' = [v EXCEPT !.catching = TRUE]
  /\ watcher' = [alive |-> TRUE,
                 delivered |-> IF Broken = "relay-forgets-resume" THEN NONE ELSE v.position,
                 tail |-> ~v.whole]
  /\ inbox' = EMPTY_BATCH
  /\ wire' = <<>>
  /\ call' = NONE
  /\ stale' = NONE
  /\ superseded' = FALSE
  /\ permit' = "free"
  /\ moving' = NONE
  /\ fiber' = FIBER_OFF
  /\ mode' = nextMode

PhoneApplies ==   \* Transcript.apply, one event at a time, so a drop can land between two
  /\ wire /= <<>>
  /\ mode = "watching"
  /\ Head(wire).t /= "failed"
  /\ LET u == Head(wire)
         next == applyTranscriptEvent(view, u)
     IN IF leavesWholeRead(view, u) /\ Broken /= "whole-survives-session"
        THEN \* leftSession: ReadAgain, and what the old watch still delivers is dropped until the
             \* new one has been asked, so nothing lands between the two steps here.
             /\ Resume(EMPTY_TRANSCRIPT, "watching")
             /\ ghost' = [seenBy(ghost, u) EXCEPT !.watchFrom = NONE]
             /\ UNCHANGED <<pane, file, budget, agentUp, cached>>
        ELSE /\ view' = next
             /\ wire' = Tail(wire)
             /\ cached' = IF remembered(next) THEN next ELSE cached
             /\ ghost' = seenBy(ghost, u)
             /\ UNCHANGED <<superseded, pane, file, budget, agentUp, fiber, call, stale, permit,
                            watcher, moving, inbox, mode>>

PhoneSeesFailure ==   \* Transcript.settle
  /\ wire /= <<>>
  /\ mode = "watching"
  /\ Head(wire).t = "failed"
  /\ IF Head(wire).kind = "rejected" /\ isOpened(view)
     THEN /\ Resume(IF Broken = "reset-keeps-lines"
                    THEN [EMPTY_TRANSCRIPT EXCEPT !.lines = view.lines]
                    ELSE EMPTY_TRANSCRIPT, "watching")
          /\ ghost' = [ghost EXCEPT !.watchFrom = NONE]
          /\ UNCHANGED <<pane, file, budget, agentUp, cached>>
     ELSE /\ view' = [view EXCEPT !.catching = FALSE, !.failed = TRUE]
          /\ mode' = "failed"
          /\ wire' = <<>>
          /\ UNCHANGED <<superseded, pane, file, budget, agentUp, fiber, call, stale, permit, watcher,
                         moving, inbox, cached, ghost>>

PhoneReconnects ==   \* whileDialed: dialed turned Some again
  /\ mode = "offline"
  /\ Resume(view, "watching")
  /\ ghost' = [ghost EXCEPT !.watchFrom = view.position]
  /\ UNCHANGED <<pane, file, budget, agentUp, cached>>

-----------------------------------------------------------------------------
(* The world: what no process in the pipe chooses *)

ClaudeWrites ==
  /\ budget.writes > 0
  /\ ~pane.gone
  /\ file' = [file EXCEPT ![PaneSession] = @ + 1]
  /\ budget' = [budget EXCEPT !.writes = @ - 1]
  /\ UNCHANGED <<superseded, pane, agentUp, fiber, call, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

PaneChangesSession ==   \* /clear, /resume: MachineStateSync sees another claudeSession
  /\ pane.at < Len(SessionPath)
  /\ pane' = [at |-> pane.at + 1, gone |-> FALSE]
  /\ UNCHANGED <<superseded, file, budget, agentUp, fiber, call, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

PaneLosesClaude ==   \* the agent row shows no claudeSession for now
  /\ budget.gaps > 0
  /\ ~pane.gone
  /\ pane' = [pane EXCEPT !.gone = TRUE]
  /\ budget' = [budget EXCEPT !.gaps = @ - 1]
  /\ UNCHANGED <<superseded, file, agentUp, fiber, call, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

PaneGetsClaudeBack ==
  /\ pane.gone
  /\ pane' = [pane EXCEPT !.gone = FALSE]
  /\ UNCHANGED <<superseded, file, budget, agentUp, fiber, call, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

AgentConnectionDrops ==   \* the socket dies; serve's scope closes; a call in flight may outlive it
  /\ budget.agentDrops > 0
  /\ agentUp
  /\ agentUp' = FALSE
  /\ budget' = [budget EXCEPT !.agentDrops = @ - 1]
  /\ fiber' = FIBER_OFF
  /\ call' = NONE
  /\ stale' = IF call /= NONE THEN call ELSE stale
  /\ superseded' = (call = NONE /\ superseded)
  /\ permit' = IF permit = "live" THEN "stale" ELSE permit
  /\ UNCHANGED <<pane, file, watcher, moving, inbox, wire, mode, view, cached, ghost>>

FollowFails(kind) ==   \* publishAll: Stream.catch(followFailed), behind what the queue holds
  /\ budget.failures > 0
  /\ fiber.running
  /\ fiber.inner.stage /= "ended"
  /\ budget' = [budget EXCEPT !.failures = @ - 1]
  /\ fiber' = [fiber EXCEPT !.queued = Append(@, [t |-> "failed", kind |-> kind]),
                            !.inner = [@ EXCEPT !.stage = "ended"]]
  /\ UNCHANGED <<superseded, pane, file, agentUp, call, stale, permit, watcher, moving,
                 inbox, wire, mode, view, cached, ghost>>

PhoneConnectionDrops ==   \* the hub's watch ends with the socket; the watcher leaves the map
  /\ budget.phoneDrops > 0
  /\ mode = "watching"
  /\ budget' = [budget EXCEPT !.phoneDrops = @ - 1]
  /\ mode' = "offline"
  /\ wire' = <<>>
  /\ inbox' = EMPTY_BATCH
  /\ watcher' = [watcher EXCEPT !.alive = FALSE]
  /\ fiber' = FIBER_OFF
  /\ call' = NONE
  /\ stale' = NONE
  /\ superseded' = FALSE
  /\ permit' = "free"
  /\ moving' = NONE
  /\ UNCHANGED <<pane, file, agentUp, view, cached, ghost>>

ChatReopens ==   \* transcriptViews runs again from the cache's view, whole if that view was read whole
  /\ budget.reopens > 0
  /\ mode /= "offline"
  /\ budget' = [budget EXCEPT !.reopens = @ - 1]
  /\ LET opening == IF cached = NONE THEN EMPTY_TRANSCRIPT ELSE withOneHole(cached)
     IN /\ Resume(opening, "watching")
        /\ ghost' = [ghost EXCEPT !.watchFrom = opening.position]
  /\ UNCHANGED <<pane, file, agentUp, cached>>

\* EarlierAsked: LoadingEarlier and ReadAgain, so the watch starts over from nothing, with no tail.
\* Only from a view on screen: a press while a fold is held back asks the same of the pipe, and the
\* machine's walk holds which of those states take it.
UserShowsEarlier ==
  /\ budget.earlier > 0
  /\ mode /= "offline"
  /\ ~view.catching
  /\ ~view.failed
  /\ \E k \in DOMAIN view.lines : isOmitted(view.lines[k])
  /\ budget' = [budget EXCEPT !.earlier = @ - 1]
  /\ Resume([EMPTY_TRANSCRIPT EXCEPT !.whole = TRUE, !.shownAt = view.position], "watching")
  /\ ghost' = [ghost EXCEPT !.watchFrom = NONE]
  /\ UNCHANGED <<pane, file, agentUp, cached>>

UserPressesTryAgain ==   \* transcriptRetryAtom, or watchable turning true
  /\ mode = "failed"
  /\ Resume(view, "watching")
  /\ ghost' = [ghost EXCEPT !.watchFrom = view.position]
  /\ UNCHANGED <<pane, file, budget, agentUp, cached>>

-----------------------------------------------------------------------------

Who == {"live", "stale"}

HubStep ==
  \E who \in Who :
    \/ HubDropsOpen(who)
    \/ HubForwardsOpen(who)
    \/ HubForwardsChunk(who)
    \/ HubRefusesChunk(who)
    \/ HubForwardsCaughtUp(who)
    \/ HubDropsCaughtUp(who)
    \/ HubRefusesCaughtUp(who)
    \/ HubFailsWatch(who)
    \/ HubDropsCallOfGoneWatch(who)

Internal ==
  \/ FollowReads
  \/ FollowOpens
  \/ FollowCatchesUp
  \/ SwitchMapSwitches
  \/ TapOffers
  \/ Publishes
  \/ DemandStartsWatch
  \/ AgentReconnects
  \/ HubStep
  \/ HubDropsFencedCall
  \/ HubSeesDeadSocket
  \/ ForwardMovesPosition
  \/ HubSends
  \/ PhoneApplies
  \/ PhoneSeesFailure
  \/ PhoneReconnects

World ==
  \/ ClaudeWrites
  \/ PaneChangesSession
  \/ PaneLosesClaude
  \/ PaneGetsClaudeBack
  \/ AgentConnectionDrops
  \/ \E kind \in FailureKinds : FollowFails(kind)
  \/ PhoneConnectionDrops
  \/ ChatReopens
  \/ UserShowsEarlier
  \/ UserPressesTryAgain

Quiescent == ~ENABLED Internal

Settled == Quiescent /\ UNCHANGED vars

Next == Internal \/ World \/ Settled

Init ==
  /\ pane = [at |-> 1, gone |-> FALSE]
  /\ file = [s \in Sessions |-> IF s = SessionPath[1] THEN FirstFileLines ELSE 0]
  /\ budget = [writes |-> Writes, gaps |-> PaneGaps, agentDrops |-> AgentDrops,
               phoneDrops |-> PhoneDrops, failures |-> WatchFailures, reopens |-> Reopens,
               earlier |-> ShowEarliers]
  /\ agentUp = TRUE
  /\ fiber = FIBER_OFF
  /\ call = NONE
  /\ stale = NONE
  /\ superseded = FALSE
  /\ permit = "free"
  /\ watcher = [alive |-> TRUE, delivered |-> NONE, tail |-> TRUE]
  /\ moving = NONE
  /\ inbox = EMPTY_BATCH
  /\ wire = <<>>
  /\ mode = "watching"
  /\ view = [EMPTY_TRANSCRIPT EXCEPT !.catching = TRUE]
  /\ cached = NONE
  /\ ghost = [phoneEpoch |-> 0, rewound |-> FALSE, repeatedOpen |-> FALSE, watchFrom |-> NONE]

Spec == Init /\ [][Next]_vars /\ WF_vars(Internal)

-----------------------------------------------------------------------------
(* The rules. Each one is the promise in the user's words; none bends to main. *)

covered(s, n, before) ==
  \E k \in 1..(before - 1) :
    /\ view.lines[k][2] = s
    /\ \/ view.lines[k] = <<"line", s, n>>
       \/ isOmitted(view.lines[k]) /\ view.lines[k][3] <= n /\ n < view.lines[k][3] + view.lines[k][4]

\* The phone never shows the same line twice.
NoDuplicateLine ==
  \A a, b \in DOMAIN view.lines :
    a < b /\ isLine(view.lines[a]) => view.lines[a] /= view.lines[b]

\* Everything before a shown line is shown or marked as left out.
NoHole ==
  /\ \A k \in DOMAIN view.lines :
       isLine(view.lines[k]) =>
         \A n \in 0..(view.lines[k][3] - 1) : covered(view.lines[k][2], n, k)
  /\ view.position /= NONE =>
       \A n \in 0..(view.position.off - 1) :
         covered(view.position.s, n, Len(view.lines) + 1)

\* A thread shows one session: no line of an old session under the new one.
OneSessionShown ==
  IF view.position = NONE
  THEN view.lines = <<>>
  ELSE \A k \in DOMAIN view.lines : view.lines[k][2] = view.position.s

\* The phone is never told to open the session it is already in.
NoRepeatedOpen == ~ghost.repeatedOpen

\* The phone never goes back to a session the pane has already left behind.
NeverRewinds == ~ghost.rewound

LiveLink == agentUp /\ mode = "watching" /\ ~pane.gone

\* With a live link and nothing left to do, the phone is not catching up.
NeverStuckCatchingUp == (LiveLink /\ view.catching) => ~Quiescent

\* With a live link and nothing left to do, the phone is in the pane's session...
ShowsPaneSession == (LiveLink /\ ~inSession(view.position, PaneSession)) => ~Quiescent

\* ...and holds everything the file holds.
NeverBehindFile ==
  (LiveLink /\ inSession(view.position, PaneSession)
   /\ view.position.off < file[PaneSession]) => ~Quiescent

\* Show earlier leaves nothing out: a whole watch never skips.
WholeShowsAll == view.whole => \A k \in DOMAIN view.lines : ~isOmitted(view.lines[k])

\* Reading one session whole says nothing about the next: it starts from its tail.
WholeStaysInItsSession ==
  (view.whole /\ view.position /= NONE) => inSession(view.shownAt, view.position.s)

\* Gaps can repeat for ever, and what a view keeps of them stays bounded.
AtMostTwoHoles == Cardinality(holesIn(view.lines)) <= 2

\* Every retry ends: the pipe always reaches a point with nothing left to do.
AlwaysSettles == []<>Quiescent

\* Not rules. Each "breaks" the first time the pipe takes that step, so TLC prints a path to it
\* for the replay: refusals sit past where every bug path stops, and random walks missed them.
NoLiveChunkRefused == [][~HubRefusesChunk("live")]_vars
NoFencedCallDropped == [][~HubDropsFencedCall]_vars
NoDeadSocketSeen == [][~HubSeesDeadSocket]_vars
NoCaughtUpRefused == [][~\E who \in Who : HubRefusesCaughtUp(who)]_vars
NoCaughtUpDropped == [][~\E who \in Who : HubDropsCaughtUp(who)]_vars
NoCallOnGoneWatch == [][~\E who \in Who : HubDropsCallOfGoneWatch(who)]_vars
NoHoleLanded == [][holesIn(view'.lines) = {}]_vars
NoEarlierShown == [][~UserShowsEarlier]_vars
NoWholeLeft == [][~(PhoneApplies /\ leavesWholeRead(view, Head(wire)))]_vars
NoHoleFolded == [][~(ChatReopens /\ cached /= NONE /\ Cardinality(holesIn(cached.lines)) >= 2)]_vars

\* Not a rule. Simulation "breaks" it at a depth to print one long random behaviour, with its
\* action names, for the replay against the real code.
WalkEnds == TLCGet("level") < WalkLength

=============================================================================
