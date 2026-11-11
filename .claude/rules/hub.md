---
paths:
  - "apps/hub/**"
---

# Hub

:::warning
An RPC handler's `headers` over a WebSocket are the upgrade request's headers with each call's own
headers merged over them, and the call wins (measured). A client can overwrite any upgrade header
per call, a proxy-injected one included. Identity a proxy vouches for is read once at the upgrade
and bound to that connection, one RPC server per connection, never read back from handler headers.
:::

:::warning
A lock-screen answer waits for its machine; no timer retries it. The retry it replaced ran every 15 s with no limit and audited each try: 1 row after 5 s, 241 after an hour and 5761 after a day of a machine away, on the hub's real services over a fake Hark and the test clock (measured). Now a machine away for 23 hours costs 0 rows, and the answer costs 1 when its fate is known (held by a test).

The worst bug here is an old answer landing on a new dialog, and an ask id alone cannot prevent it. A dialog read off the screen is named by its fingerprint, so the same dialog asked again carries the same id (read in the derivation), and the agent's own check compares only the id. The old retry also fired as soon as a link was up, before that link had published anything: a command was routed with no state from that connection (measured). So a held answer goes out only over the link that published the state it judged, when that state shows the same terminal, state change sequence and ask id, by the same rule the notification plan judges with, and a test holds that the same id under the next sequence is never answered and raises its own prompt. What is left is a dialog changing in the moment between that state and the keys, which the wire has no field to close.

A machine is back when its newest link has both attached and published, in either order. An agent's session starts its attach and its publishing side by side, so the hub can see either first (reasoned from the session); every session's publishing starts from the current state (read in the agent), which is why this needs nothing new from an older agent. It has to be per link, because a redial overlaps the link it replaces: the hub reads a silent socket as live for seconds after the agent left it, so a machine that merely reads online with a state on file can be holding the dead link's state. A send names the link it judged and is refused as offline if a newer one has attached since, and goes back to waiting. A publish that lands late from an older link changes nothing. A state that cannot tell, herdr lost or a row reading unknown, keeps the wait.

A send that timed out with the link still up is not sent again until a newer state or a new link. The timed-out command is still in that link's queue and the agent replays by key (read in both), so a timer added nothing but rows.

A held answer ends a day after Hark says it was answered, the longest a prompt stays open, and the time comes from Hark's own read, so a restart cannot reset it. A read with no such time starts the day at the read (none measured; the field is optional in Hark's schema). Before there was no end, and an Approve days old could land on a dialog the user had long forgotten. Past that the phone sees what it sees for any refused answer: the prompt reads answered, and the pane reads needs you once its machine is back.

The answer was already durable, and stays so without a new table: it lives at Hark, and the sent notification's row says to read it again after a restart (measured: a restart of the old hub routed it once the machine attached). The audit table is what says it concluded, so a restart neither sends nor audits again. A row saying offline or timed out concludes nothing, which is what an older hub's retries left behind (a test seeds them). A hub stopping writes no row for an answer still held or still out, since the restart resumes it.

This is a machine rather than one effect because it has six ways out, a delivery, a refusal, a state that moved on, a withdrawal, an age limit and a send that may not have landed going back to waiting, and the rules worth holding are about arrows: a send only from a hold on that hold's own open, one fate recorded on the way into the end, nothing after it. Whatever watches the link or the clock is one fiber per hold, in a scope that ends with the answer, inside the notifier's scope.
:::

- An upload lives in the hub's memory, for its machine only, for 15 minutes, and the hub holds at most four messages' worth, 100 MiB, before it refuses more. Both numbers are guards, not measurements: the agent downloads a prompt's files the moment the command reaches it, and nothing has measured how long that takes over a slow link. The agent's download has 60 s, also a guard, and a prompt with attachments gets that on top of the usual command timeout at the hub.
- A publish from an agent connection that has died can still run at the hub after its successor's.
  The RPC server forks a handler for each request frame it reads, and nothing orders two sockets.
  With a proxy holding the client's bytes, the client dead by its own ping timeout and its successor
  already publishing, releasing the first held frame ran the call in 10 of 10 runs: the phone got
  the finished session back with its lines repeated, and the next live chunk was refused. Released
  in one read with the ping and close frame behind it, the call never ran, in 10 of 10: the handler
  was forked into a scope that closed first (all measured). So it takes a gap at the hub between
  the frame and the end of its socket. The hub closed a silent socket 12.0 s after it fell silent,
  while the agent gives up 5 to 10 s after its last frame and redials, so the hub still reads a
  socket the agent has left (one run measured). A network that delivers the oldest segment before
  the rest is reasoned, not measured.
- The hub fences publishes per connection. Each upgrade mints a link with a rising number, and a
  link stops counting once a later one asks for demands. A call on a link that stopped counting
  drops what is left of its updates and still replies with success, so nothing changes on the wire
  and an older agent is covered too: every publisher got its watch ids from the demand stream. The
  fence moves at the demand and not at the upgrade, so a dial the agent gave up on, which never
  speaks, fences nothing. A client speaks only after its upgrade's reply and redials only after
  giving up, so the numbers follow the agent's own order, and an older link asking late cannot move
  the fence back. A publish parked on a full mailbox wakes when its link is replaced and lets go,
  rather than delivering once the phone drains.
- A machine's state has the same race as a transcript publish, so the hub fences it per connection
  as well. A real agent's state frame held behind a proxy and released alone, after its successor's
  first state, while the old socket was still open, ran over the newer state in 12 of 12 runs held at
  a random point of the ping period, and over raw clients in 10 of 10; released in one read with the
  ping and close frame behind it, in 0 of 10 (all measured). What it took was the machine's real
  state: the phone read the older row, still there after 20 s with nothing else happening, and an
  idle machine publishes nothing to correct it. The next state replaced it in 5 to 30 ms, but the
  pane's seen mark was gone by then, and against a fake Hark the same late state sent a "Has a
  question" push and moved the Live Activity to "1 needs you" for a dialog already answered
  (measured). The gap is short: over 12 runs with nothing released, the hub closed the silent socket
  before the agent gave up in 6, which tells the agent at once, and 776 to 1470 ms after the
  successor's first state in the other 6 (measured). That a network delivers the oldest segment
  alone inside it is still reasoned.
- The state's fence is the record of which link last published, checked and written in one update
  around the herd's write, so an older link's call waiting behind a newer one's is dropped too. It
  needs no second notion of the current link and no word from the agent: the reply stays a success,
  so an older agent is covered, and with the fence on, 4 of 4 releases left the newer state and no
  Hark call followed (measured). It moves at a publish rather than at the demand: an agent's first
  state and its demand go out side by side, and a dial the agent gave up on never publishes. A late
  state landing before the successor's first is kept until that first state replaces it, which is
  safe because a session starts publishing from the current state (read in the agent), and dropping
  an older link's state loses nothing for the same reason. In that order its push can still go out,
  and the first state then withdraws it (reasoned, not measured). The record has one permit across
  machines, which costs nothing new, since the herd's write already takes one across machines (read
  in both). A check of the state's version could not
  do this: it restarts at 0 with the agent (read in the agent), and would refuse a restarted agent's
  first state.
- A watch's delivered position lives beside the watch, outside the set the agents' demands are
  built from, so only a watch that comes or goes works out a machine's demand again. Updating
  the position inside that set recomputed the demand once per event: 21 events cost 21
  recomputations before, and none after (measured with a counting tracer).
