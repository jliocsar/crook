---
paths:
  - "apps/**/*Transcript*"
  - "packages/**/*Transcript*"
  - ".claude/skills/verify-transcript-pipe/**"
---

# The transcript pipe

Agent to hub to phone: watches, mailboxes, positions, resumes and skips.

- The agent applies a watch's tail only from offset 0 and keeps it per watch (read in its source),
  so a watch that read one session whole reads the next one whole too. The phone restarts the watch
  when a session read whole changes, with the tail, and drops what the old watch still delivers
  until the new one has been asked, so Show earlier is offered again on the next session.
- An agent too old for the caught-up mark gives no sign that a session is empty, only silence after
  its open, so the phone keeps the skeleton for the same second before it says "No messages yet"
  (reasoned, not measured). With rows on screen it never says so, and a rejected resume keeps them
  until the agent's first chunk replaces them. A file left truly empty behind such a rejection
  therefore keeps showing the old rows until Claude writes again (reasoned, not measured).
- Whether an agent sends the caught-up mark is read from the first version that does, 0.0.2, never from the hub's version. Reading it as any agent behind the hub took every agent that had not updated yet for one that cannot say, so every chunk went straight on screen with no skeleton, no hold and no capsule, which is how a 0.0.8 agent under a 0.0.11 hub read (every tag from 0.0.2 sends it, read in each; a test fails on the old rule). A real 0.0.8 binary was not run against this phone.

- Catching a chat up is bound by round trips, not by any hop's own work. The hub writes a
  transcript message to the phone only after the phone acknowledged the one before. Before
  transcript events were coalesced, it also held one event per phone, so the agent's next event
  waited on that round trip too, and the numbers in the rest of this entry are from then. Run
  locally with every hop timed, a cold open with the 512 KB tail reached the screen 72 ms after
  the phone asked, and the agent began its watch under 1 ms after the hub registered it, so the
  wait sits in the number of events times the phone's round trip. With the agent reading 64 KB per event, 800 KB
  written since the phone last looked took 14 events and 14.3 s at an emulated 1 s round trip,
  and 4.4 s at 300 ms; reading what the file holds in events of up to 1 MiB took 2 events, 2.2 s
  and 0.8 s. Show earlier on a 3 MB transcript went from 48 events and 14.9 s to 5 events and
  1.7 s at 300 ms (all measured against a local hub and agent through a proxy that delays each
  WebSocket message). Fewer, larger events are the lever; a smaller read size is a regression.
- Neither the agent nor the hub waits on the phone per event. Each keeps what is pending for a
  watch in a mailbox that merges as it goes: chunks that continue each other join into one, a
  later skill list or subagent roster replaces the earlier one of its session. The agent publishes
  everything its mailbox holds as one call and keeps reading while it waits for the reply; the
  hub replies once the updates are in the phone's mailbox, and the phone gets everything held
  since its last acknowledgement as one message. A caught-up mark merged that way can name an
  offset before the end of the joined chunk, which the hub lets through. A mailbox takes no more
  once it holds 1 MiB of read lines, so a slow phone holds the agent back instead of filling the
  hub, but always takes a failure. There is no time debounce: merging only happens while a
  message is already out, so an idle pipe adds no delay.
- The agent publishes a batch through its own call, and the hub still answers the single-update
  call an agent from before coalescing makes. A hub is the side that updates first, and an agent
  behind it stays online until the phone offers to update it, so dropping that call would leave
  every older agent's chats without transcripts.
- The hub alone decides what a phone has already been sent. It keeps one delivered position per
  watch and judges each update as it arrives: it drops an open of the session the phone is
  already in and any roster, skill list or caught-up mark of another session, and refuses a chunk
  that does not continue the position, so the agent restarts from there. The phone applies
  whatever arrives and keeps a position only to resume from. The agent sends from where its own
  read reached and resends freely, a repeated open on every resume included; the hub could only
  hand that cursor over after a round trip. An older agent gets the same filtering, since it
  happens at the hub.
  The position moves in the same transaction that puts the update in the phone's mailbox. Done
  as two steps, an agent connection dropping between them would leave the position behind what
  the phone holds, and the agent's resend from that position would reach the phone twice, with
  nothing downstream left to drop it (reasoned from the interrupt points, not measured).
- A caught-up mark names the offset the agent read to, so the hub refuses one past the position it
  holds, exactly as it refuses a chunk that does not continue it, and the agent restarts from there.
  A pane going A, B, A while the open of B still sat in the agent's switch queue read its cursor as
  the end of A and sent only the open and the mark, while the hub's position fell to the start of A:
  an empty thread saying it was caught up (found by the model, and walked through the real relay).
  The refusal is at the hub, since every agent that sends the mark names that offset and restarts
  when refused, so an older agent is covered too.
- A publish that dies of a defect ends its watch with nothing to restart it, because the agent's
  demand stream only moves when the set of watches does (measured in a probe of the agent's real
  serve loop). The agent tells the phone the watch failed, so the hub drops the watch and the phone
  offers Try again, the same as a read that dies. If that call dies too, the watch waits for the next
  connection or re-watch.
- A watch's stream cannot end with the connection lost while the phone still reads the link as
  connected. An RPC socket's failures, a message that will not decode included, reach every live
  request, the herd's among them, and the link reads as connected only while that herd stream runs,
  so the link flips and the watch restarts (read in the RPC client's and the link's source, not
  measured).

- A burst of writes behind a publish arrives in fewer publishes than writes, not always in one. A test that wrote three lines and waited 80 ms for the agent to read them saw two in the next publish in one loaded gate, and all three in 12 of 12 runs with sixteen busy loops beside it (measured). A file event that lands during a read is kept (read in the tail), but a write landing right after a delivered event gets no event of its own, so then the rest follows on the watch's second look. So a test holds that everything arrives in fewer publishes than writes.
- A test that publishes twice and expects two deliveries takes the first before it publishes
  the second. The mailbox joins whatever the phone has not taken yet, and whether the phone's
  fiber got a turn in between hung on unrelated work in the hub: dropping a per-event update
  made two chunks a test expected apart arrive joined (measured).
- The agent holds a session it opened until it has caught up on it, so the backlog, the
  caught-up mark, then the skills and roster land in one message, and the skills never go first.
  A subagent watch whose file does not exist yet therefore sends nothing until it does; the phone
  waits for the caught-up mark from a current agent anyway, so it shows the same.
  The hub cannot hold the same way: an agent too old to send the caught-up mark would leave the
  phone with nothing, so it forwards whatever it holds.
- Coalescing measured against a local hub and agent in one process, each socket behind a proxy
  delaying every WebSocket message 150 ms (an emulated 300 ms round trip), on a 3 MB real
  transcript with a subagent folder: a cold open with the 512 KB tail went from 6 messages and
  1.85 to 1.91 s to 2 messages and 0.70 to 0.71 s, the second carrying only the subagent roster;
  a resume with 5 new lines went from 4 messages and 1.51 to 1.54 s to 2 messages and 0.62 to
  0.65 s, against a floor of 0.6 s for phone to hub to agent and back; ten writes 20 ms apart
  went from 10 messages and 3.07 s to 2 messages and 0.61 to 0.63 s. Ten writes with no gap were one
  message both before and after, since one file event read them all.
- A resume over a gap wider than one read of the agent skips it, and costs one message however wide the gap. On a real 118 MB transcript at an emulated 300 ms round trip (a local hub and agent in one process, each socket behind a proxy delaying every WebSocket message 150 ms, three runs each), a 20 MB gap went from 13 messages and 4652 to 4738 ms to 1 message and 791 to 809 ms, and a 118 MB gap from 70 to 71 messages, 24 MB and 23106 to 23827 ms to 1 message, 0.01 MB and 768 to 810 ms, against the floor of 0.6 s for phone to hub to agent and back. A whole read pays what it always did: 13 messages and 4756 to 4768 ms over the same 20 MB. Run again with every event through the chat's machine from a cached view, the 20 MB gap took 789 to 871 ms and the 118 MB one 756 to 821 ms, landing as a catch-up with one hole, and the machine's own work was 0.27 to 1.09 ms per resume, 3.89 to 10.48 ms over the whole read (all measured).
- The skip starts past one read, 1 MiB, rather than wherever the tail would land past the resume. A 786 KB gap read whole already cost 1 message and 822 to 844 ms, and a hole there would save nothing and leave a row to press; a 1.16 MB gap read whole cost 3 messages and 1428 to 1464 ms (all measured).
- A skip changes nothing on the wire: it is the omitted-lines chunk a cold open sends, at a later offset, and it continues the hub's position like any chunk. An agent too old to skip never sends one. An older phone shows the row and its button still reads the whole file, but it can strand a sent prompt's row, since only a current phone ends that wait at a hole (reasoned, not measured).
- A resume's offset is checked before it can be skipped, so one past the end or inside a line is still refused rather than hidden behind a hole.

- To the chat's machine a resume over a gap is one more chunk, with no event or case of its own: held back behind the cached rows, landed by the caught-up mark as any catch-up is. Its walk tries one from every state and holds it to the arrow a chunk of lines takes there, and its chart came out unchanged. A special case for it fails that rule (measured).
- A chat read whole stays whole when it reopens from the phone's memory, so a gap since then is read in full rather than skipped, and it stays whole until the session changes or the store is what answers: a stored view is never whole. Showing the whole chat is what the user asked for, so this stays.

- Effect RPC sends each array a stream handler emits as one message and waits for the client's
  acknowledgement before pulling again (read in its server source), so a stream that emits a
  whole mailbox take as one array costs one round trip. `Stream.fromEffectRepeat` followed by
  `Stream.flatMap` over `Stream.fromArray` and by `Stream.mapAccum` keeps that array whole
  (measured).

- A watch goes out when the socket is dialed, not when the first herd lands. The socket holds what is
  written before it opens, and the hub admits a watch from its own state, so nothing depended on the
  order. A resume on a fresh socket, through the real link, a local hub and agent and a proxy delaying
  each WebSocket message 150 ms, went from 960 to 1034 ms to 746 to 780 ms from the dial to the caught-up
  mark (five runs each). A tap on a live link was never affected, and neither are calls, which still
  hold for the first herd. A resume reads the last herd the phone knew to decide whether the agent
  sends the caught-up mark, so with no herd at all it still waits for the first one. Read without one,
  a chat with nothing cached says "No messages yet" a second later and a cached chat lands with no
  catch-up (read in the chat's machine, not measured). A dial that fails before its first herd ends the watch quietly, as any lost connection
  does, and the next dial asks again. Each dial resumes, so a failing backoff restarts the chat's
  notice wait, and the link's own notice dims the chat as away at that same second, which hides the
  capsule and the catch-up dim (reasoned, not measured).
