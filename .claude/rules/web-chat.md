---
paths:
  - "apps/web/src/chat/**"
  - "apps/web/test/chat/**"
  - "apps/web/src/atoms/Chat.ts"
  - "apps/web/src/atoms/Transcript.ts"
  - "apps/web/src/cache/TranscriptCache.ts"
  - "apps/web/src/highlight/**"
---

# Web: the chat

The chat screen, its thread, rows, composer and catch-up.

:::tip
Whether a chat's agent is working is one machine, and the header's word, the Working row, the composer's Stop and the queued label all read one table derived from its state, so a word and a row that disagree cannot be written. Its inputs are the herd and the transcript's turn evidence, and the transcript reaches the screen deferred, so it folds during render over the deferred lines rather than in an atom: the row and the answer that ends it have to commit together, and an atom sits on the latest lines, ahead of the rows (reasoned, not measured). A subagent's screen folds the same machine over its own run.

Before it, each read its own check. The row left whenever the newest item was a running tool and came back on the next line, while Stop went on herdr's word, so a turn with tools showed Stop with no row for 98 to 100 frames, and an answered prompt 51 to 52. The check looked only at the last item, so a running tool grouped under another kept the row beside it for 1415 ms. Measured at 390x844 and 4x CPU throttling in Chromium, three runs each, from each story's first step, a turn with two tools went from 3 row mounts and 3 ghosts to 1 and 1, an answered prompt from 2 and 2 to 1 and 1, and a subagent's turn from 3 and 3, one of each before its first step, to 1 and 1. Layout shift held: 0.0006 and 0.0006, 0.0004 and 0.0004, 0.0039 and 0.0037 to 0.0039. One story gains a shift or two, the header's word changing twice as herdr catches up with an answer.

An answer that lands before herdr's flip off reads as `done`, with Send, and the flip that follows carries no news: the row and Stop leave on the answer. A pane in the focused tab goes to `idle` instead of `done`, so the word there reads `done` for the gap and then changes (reasoned from herdr's states; the gap was 150 ms in a story, not measured on a real pane). A failed watch has no evidence to read, so the row and Stop follow herdr alone beside Try again; before, the row left while Stop stayed.
:::

:::tip
A machine's connection blinking is not the machine being gone, and the phone gave the two one look: the card replaced the composer and took the keyboard with it. Measured with a local hub, agent and proxy, from when a phone sees the machine leave online to when it sees it back. A socket dropped from a healthy agent took 25 to 29 ms; one dropped again and again, while the backoff grows, 114 ms to 5042 ms; an agent process restart 219 to 231 ms; a hub restart with 2 s of downtime 215 to 218 ms, and with 6 s 3688 ms; a network blackout of 3 s 17 ms, 7 s 32 ms, 12 s 5418 ms and 20 s 12048 ms, all under the 15 s the hub already gives a machine. So the phone keeps the dock for those same 15 s. The first second of it shows nothing at all, since a healthy machine's single drop never came near it.

A restarted hub lists a machine offline with no reconnecting first (measured), so the phone cannot wait for the hub's word: going from a live pane to offline starts its own grace. It cannot compute that grace from the machine's timestamps either: after a restart they say when the machine was last seen, on the hub's clock. It times it from what it saw, and a machine already offline when the chat opens goes straight to the card.

A send for a machine on its way back holds until the machine is online and the link is up, under one bound, the same 15 s. When the bound runs out with the link up, the call goes out and the hub answers for the machine; with the link down it fails as not connected. Two holds in a row would stack to 30 s (reasoned, not measured). Going back to the chat restarts the wait, since the machine lives only while its chat is open, and a phone that slept through a whole drop gives a machine long gone the same 16 s: nothing it holds tells that from a hub restart.

The card takes the composer's cell at the composer's height, 102 px at 390 and at 430 wide, in light and dark. A machine's name long enough to wrap made it 106 and pushed the dock up 4 px, so the title truncates (measured).

The drop's own time is the token for a wait, so the machine needs no counter: the hub moves it on every drop. A machine sees a herd's reading only when it changes, so offline landing while a drop is still quiet can only be the hub's reconnecting running out, and that goes to the card.
:::

:::tip
The same dialog asked twice is two asks. A Claude making one Bash call twice in a row, same command and same description, showed one fingerprint both times, and herdr's sequence read 2 on the first and 4 on the second, with working between and the second dialog on screen 1415 ms after the first was answered (one Claude, Claude Code 2.1.318 on herdr 0.9.5, measured once). A dialog read off the screen is named by that fingerprint, so such an ask comes back under its old id. Claude writes the description itself, and the dialog shows it: the same command with descriptions that differed gave two fingerprints (measured once), so this takes a call repeated word for word.

The phone matched its answer on the id alone. An audit read that as a dialog opening with no buttons, which it was not: they stayed and worked, a second tap going out under a new key, since an answered ask keeps its buttons on purpose. What the dialog opened with was the last answer's word, "Answered. Waiting for Claude to move on.", "Already answered" or a refusal, over a dialog waiting on the user, until the next answer replaced it (measured in the DOM tests against the old code).

So an answer is a machine whose token is the asking: the terminal, the state change sequence, the id and the dialog, which is what the agent remembers an answer by. The two cannot disagree: an asking the phone offers as new is one the agent takes, and the row still showing the asking it answered keeps its word, as the agent still refuses it. What an answer came to is keyed by its idempotency key, so a retry under the same key is the same answer, and it can move between delivered and not shown as the herd catches up.

It folds during render, as the activity does, because a new asking must not commit with the old word on it, and each render hears the current outcome again, so hearing a thing twice has to change nothing or the render never settles. The walk holds that.

Two identical calls in one message are the case the token cannot name. A Claude told to send one Bash call twice in parallel showed one fingerprint for both, herdr held one sequence and stayed blocked, and the second dialog was on screen about 215 ms after the first was answered (one Claude, the same versions, hooks off, measured once). Nothing on the row or on the screen tells that dialog from the one just answered, so the phone keeps its word and the agent refuses a second tap as already answered (read in both, not run through them), and the laptop answers it. A row naming the dialog by its call would tell them apart (reasoned, not measured).

A decline with a message stays out of the machine, on the composer's action, where a failure tells on the composer. The field holds the words it refused, and Esc may already have closed the ask, so only the composer is sure to outlive it. The buttons hold while that action is sending one, which needs no state of its own. An Always note waits on the action rather than the machine, since the grant holds even if the row moved on before the reply. Nothing marks this machine for the frame tool: an answer is out for one round trip, which can sit under the 24 frames a mark would hold it to (reasoned, not measured), and the dock's own state attribute names it in the log.
:::

- A chat's draft, its words and attachments, lives per machine and pane in an atom over IndexedDB, so it survives leaving the chat and an app restart. It goes with the composer's own clears: once the hub takes the prompt the composer empties and the store with it, and a refused send keeps both for the retry. A pane that left the herd, or a machine the herd no longer lists, drops its draft; a machine the herd has no state for keeps it, as the transcript cache does. The words and the attachments are separate records, each attachment written once, because a words write took 0.4 to 0.9 ms (median, p90 0.6 to 1.5) and a 25 MB attachment 76 to 120 ms to write and 73 to 86 ms to read (desktop Chromium, unthrottled, three runs, measured). So the words are written on every change with no time debounce, one write at a time with the changes made meanwhile folded into the next, as the herd cache does, and a draft holding the full 25 MB never rewrites its bytes per key. Every draft is read whole the first time any screen asks for one, so a chat opened after that has its draft in its first render, and a chat opened straight from a cold start shows it once that read lands (reasoned, not measured). The herd's draft signal names only the panes whose draft is not blank and changes only when one turns blank or not, so typing reorders nothing.
- A send still out when the chat is left is not followed to its answer: the composer's clear runs in the screen, so a draft whose send then lands is back on the next open (reasoned, not measured).
- A prompt's attachments go to the hub first, each by its own PUT, and the command follows only once every upload answered, so the agent never asks for bytes the hub does not hold. They stay in the composer until the hub answers the command, as the draft does, and stay through a failed upload or a refused command, so a retry has them. Shrinking a photo to 2000px on its long edge at JPEG quality 0.85 is a decision the user made, not a measurement.
- A live batch lands without a fade of its own: the lift that carries it into view is the one
  animation, and the Working row it replaces leaves as a ghost on the exit token.
- A session can hold lines and no rows: of the real transcripts in the catalog, three hold only
  redacted thinking, entries a newer Claude wrote, or notices for runs outside the slice. Those read
  as nothing crook can show, not as no messages, because the second says something untrue about the
  session. Thinking itself draws nothing, on purpose.
- A subagent run that started, with its session gone idle and no roster to say otherwise, has
  nothing vouching for it: the dock read "1 running 15d" on a real transcript. It reads as
  unconfirmed there, the word that work nothing said ended already has, and it leaves the count.
- A background run's row sits on the tool rows' grid and takes their measurements from the tool row itself: its padding, its icon size and gap, and a column the chevron's width that its state dot centres in. With its own `px-3` and the dot at its edge, the icon and text started 2 px left of the tool rows' and the dot's centre sat 5 px right of the chevron's (read from the classes). Now the icons start at 31 px, the text at 56 px, and the dot's centre and the chevron's both sit at 352 px at 390 wide and 282 px at 320, with a long command still ending in an ellipsis before the dot (measured in Chromium).
- A pane closing says nothing about whether a run failed, so a run cut off that way reads "pane
  closed" with a neutral dot rather than red.
- The dock went on counting that run: "1 running" with its clock going, under a row reading "pane closed", since the row read the pane and the dock read only the run's own status (seen in a story, with the pane's presence reading closed). Once a pane has closed the dock counts nothing as running, shells and monitors included, because nothing can say they still run, and the thread's markers read them as last seen. What already ended keeps how it ended.
- An MCP tool reads in words on a card, in a notification and on a Live Activity: its name, then the server it comes from. Code mode's one tool is named `run`, which would read "Wants to run run from codemode", so it reads as "code mode". The thread's tool rows and the dock's subagent line read the same words. Only the ask's mono line keeps the raw name, since it shows the exact thing being approved.
- A tool crook has no view of its own for reads by its fields rather than as one JSON blob. Code mode's code and each of its inputs sit apart under the names the code reads, a JSON result is set out and highlighted, and any other text stays as text. Setting one out goes through a parse, so a number too large for a double would read rounded (reasoned, not measured). Of three looks tried in the kitchen, the row stayed one line of 46 px with its code above its result, over a second line that showed the result (60 px) and over a panel opening on the result with the code behind a switch. The second line read as `{` on a structured result and had to hold its room before the result landed, since a row that grows under its key moves the rows below it a frame late. The switch hid the code a failure is about.
- The most common row there is, over the newest 370 main transcripts of both Claude roots through the real parser: 16889 of 23293 tool calls were code mode, 1644 executor's, 698 SendMessage, 353 Monitor, 300 ToolSearch, 157 Skill and 10 Workflow (measured). A folded row costs what it did: 150 of them, 12900 px, driven by a finger through CDP at 4x CPU throttling, read a p90 frame of 16.7 ms and no long task both before and after, three runs each, with every row at 46 px. A subject costs a median of 0.003 ms in Bun, and the fields are worked out only when a panel opens. Opening a row with its code highlighted took 39 to 52 ms to its second animation frame, against 31 to 40 ms for the JSON it replaced, five cold runs each with no long task. Its height was the same before and after the highlight landed and after scrolling away and back (all measured in Chromium). A wrapped code line keeps its height highlighted.
- A code mode row names the tools its code reaches, since its first line says little: the median one runs 133 characters where a row at 390 wide shows 25 in all, its name included, and 14173 of 14407 calls spell a tool by name (measured). Spelled through a variable it falls back to that first line. The agent names them the same way for the dock's line, and an agent too old to do so sends the first line, read beside the tool's name in words.
- A code mode run that fails says so only in its text, by opening `run failed: `. Of 434 failed runs in those transcripts, 307 carried no error flag and read as done (measured). Only the opening counts: 22 of 14465 results held those words further in.
- Code folds at 10 lines and 1000 characters, about the 90th percentile of both, and a result at 12 lines, what the scroller it replaced held in its 224 px, and 600 characters, what those lines hold when wrapped at 390 wide. So 13841 of 16878 programs and 8672 of 16887 results show whole (measured). Characters count because a result can be one line: executor's JSON ran to 49054 characters on one line, and a program's first line to 7381. A result of 13451 characters unfolded in 24 to 32 ms with no long task (measured at 4x), and then scrolls in its own 384 px rather than making the row that tall.
- An executor call that needs approval has no form to read: all 126 results that said so were in form mode with no field in their schema (measured), so what it asks is one message. The row says it asked and shows that message and what the call would do, and offers nothing to press, since nothing on the phone answers or resumes an approval. It reads as stopped rather than done, since the call has not run.
- ToolSearch's matches are references the parser drops, 471 of them in the newest 200 mains (measured), so its row shows the query and no result. Keeping them is a change for the agent, and nobody has asked for it.

- The chat's views are a function its atom runs, not a service. They hold no state between keys, one atom calls them, and no test replaces them: a test fakes what they talk to by seeding the runtime's layer, and a service would be one more thing every seed has to build. Their inputs stay atoms because they subscribe before forking anything and read the latest value at given moments, so streams as inputs would only move that work into an adapter that still holds the registry.

- A stream atom marks every value it emits as `waiting` until its stream ends (read in
  `Atom`'s stream constructor), so the result of an atom over a stream that never ends, such as a
  chat's transcript, is waiting from its first value on and says nothing about a refresh. So the
  chat's atom emits a machine's state, which holds both the view on screen and the fold still
  being read: the thread's "Catching up" capsule and the pending Show earlier and Try again rows are
  each a tag of that state, and a screen reads nothing else. The cue and the catch-up dim hide while
  the chat is dimmed as away, since that dim already says the hub or the machine is away, and once
  the pane no longer runs Claude, whose transcript never catches up. A failed watch is not catching up, and pressing
  Try again is a tag of its own.
- A read that ends within a second says nothing. The cue, a pill in the header when these were measured, used to show as soon as a watch
  resumed, and on a reconnect and a foreground return it held 17 frames (317 ms) and 14 frames
  (238 ms), each with its spinner, and read as a flash every run. Waiting the second a link's
  notice waits, neither shows at all. Once shown it stays until it has held 400 ms, the frame
  tool's limit: a read landing 1.8 s after the tap showed the cue at full opacity for 36 frames
  (all measured in Chromium at 4x CPU throttling).
- The cue, the failure rows and the rows read one state, deferred once, so they commit together:
  on that 1.8 s read the cue starts to fade in the frame the rows land (measured as above). The
  rows are slow to render and the deferred read can skip a state on its way: a read landing about
  1.1 s after the tap went from held rows to landed rows with the state that says catching up never
  committed, so the cue first showed in the frame the rows landed, and held its 400 ms over a read
  already done, 37 frames with its fades (measured as above). The atom cannot know what committed.
- "Catching up" floats over the top of the thread because a pill in the header took its room from
  the title: at 390 wide the title went from 286 px to 168 with it, or to 186 with a running count,
  and with both up at 375 wide it had 53, moving whenever one came or went. Over the thread it takes
  nothing: the title held 271, 286 and 326 px at 375, 390 and 430 wide in every frame of a slow
  catch-up, the capsule up for 57 to 58 frames as the pill was. Layout shift read 0 before and after
  (all measured in Chromium), so the score never saw that reflow: a title narrowing moves no box's
  start (reasoned). The capsule's blur costs nothing the frame tool can read: a p90 frame of 18.0 ms
  under the pill and 17.3 under the capsule, at 4x CPU throttling (measured, one run each).
  It covers the row beneath it and takes no touch: in Chromium with touch emulated, a tap at its
  centre opened the tool call under it, a finger scroll starting on it moved the thread 286 px and
  let go of the end, and a swipe from the screen's edge at its height went back. With the keyboard
  emulated it stayed 8 px under the header over a thread 324 px tall (each measured once).
  The connection banner lies over the same place in a higher layer and hid the capsule whole, for
  all 19 to 20 frames they were up together, at both phone widths in both themes. The capsule now
  rides the slide a tab screen's content takes, so it rests 9 px under the banner, 28 to 29 frames
  together on a reconnect in 3 of 3 runs with no layout shift. The thread itself stays put under both
  (all measured in Chromium). A capsule beside a skeleton is a forbidden pair in the frame tool:
  the states that say catching up each hold a view and a skeleton means there is none (read in the
  machine), and the sweep holds that.
- The rows a catch-up holds back dim while the capsule says so, and only the rows: the header, the
  dock, the capsule and the Latest button stay as they are. The dim reads the one state that both
  shows the capsule and keeps the held rows on screen, so it waits the capsule's second and fades in
  on the capsule's own fade, and the frame log's transcript state names it frame for frame over 17
  catch-up, reopen and reconnect stories. It leaves at once, in the commit the rows land, rather than
  holding the capsule's 400 ms: the capsule may stay over rows already landed, and a dim that stayed
  would call those new rows old. On a slow catch-up the dim held 42 frames, 837 ms, and on a
  reconnect 31 frames, 679 ms, each leaving in the frame the row count grew while the capsule went on
  to its hold, and no frame of the 17 stories showed it beside the catch-up divider (all measured in
  Chromium at 390x844 and 4x CPU throttling, one run each). A read that lands inside the capsule's
  hold therefore gives a dim shorter than a flash's limit, as a spinner goes with its host, so the dim
  carries no frame mark; the story whose read lands about 1.1 s after the tap never committed the
  state that dims (one run), as it never committed the capsule's.
- The catch-up dim takes the rows to 85%, where the away dim takes the whole thread to 60%. On the
  catch-up stories' rows the small muted text read 6.61 to 1 in light and 7.02 in dark at full
  strength, 4.61 and 5.40 at 85%, 4.11 and 4.92 at 80%, and 2.69 and 3.29 at 60%, with body text
  at 10.09 to 11.71 at 85% (computed from the rendered colours in Chromium, both themes, two
  stories). So 85% is the deepest of those that keeps every row's text over the 4.5 small text
  needs. A dimmed row still opens: a tap on a tool row expanded it with the dim on (measured once).
  The thread takes one dim at a time, so the two never show together, and the away dim wins, as it
  does over the capsule: on a reconnect the frame log held the away dim for the one frame of the
  catching-up state that the link was still unreachable, and the catch-up dim after it (measured
  once). When the away dim takes over, the rows fade back on the fade the whole thread dims on, so
  the thread only darkens (reasoned, not measured).
- A chat counts its running subagents only in its dock. The dock counts every running subagent of
  the session, a foreground one included and marked "Claude waits on it", and its chip opens that
  run's screen in one tap, as a tree row does. So the header's count added only a scroll to the
  tree, and it went with the scroll. A run launched inside a hole shows in neither, and a run no
  roster has named yet opens from neither, as before (read in their source). The count on a
  machine's card comes from the agent, and never read what the chat counts.
- A catch-up that lands before the cached rows ever committed gets its divider like any other. What
  is new is what the cache did not hold, whichever rows the chat got to show: the fold keeps the
  lines the cache held when the read ends, and the screen turns those into row keys. A chat kept on
  the device with its answer already waiting goes from nothing to rows and divider in one commit,
  with no layout shift, where judging from the first rows rendered showed no divider and failed its
  story (both measured in Chromium at 4x). Only a chat read from the store can get there, since one
  reopened from memory holds the cached view in its first render (measured). Turning the lines into
  keys costs one pass at the landing: 4.7 ms at 62 lines, 11.4 at 586, 14.5 to 19.5 at 1110 to 1406
  (measured on the dev server at 4x).

- A chat with nothing cached whose pane closed or whose Claude exited showed a blank thread above
  the card. It says the phone has no messages, as a machine that is away does.
- A thread skeleton holds for a flash's limit, 24 frames and 400 ms, whichever takes longer, and rows that arrive meanwhile wait out the rest. Before it, with nothing cached, it held 9 to 13 frames (233 to 369 ms) on a reconnect story and 10 to 17 (232 to 489 ms) on a foreground return over three sweeps, because the catalog's fake hub answers as soon as the screen mounts; with it, neither flashes (measured). A real hub's caught-up mark came 381 to 981 ms after a reload's first commit, so a real open rarely waits on the hold, and a phone is not measured. The other way out, a delay before it shows, leaves a blank panel while the chat slides in (reasoned, not measured).

- A thread can hold a hole in its middle, so whatever reads it can no longer take the row at the start of the file for the only one. A tool call above a hole has its result possibly inside it, so it reads as stopped rather than running forever, and a prompt sent before a hole may have landed in it, so the hole ends the wait for it. The row a cold open starts with is not a hole and ends no wait.
- The phone's cache hands back a view holding at most one hole: everything down to the hole before the newest folds into one row at the start of the file. A chat opened from it holds at most two once the next gap lands, and 40 reopens over a gap each settled at 6 lines (measured in a test). The fold happens before the chat shows, so a catch-up still sees the cached rows as a prefix of what it lands on. A gap under one read adds its lines as any catch-up does, so that growth stays what it was.
- A chat left open does not fold: it gains a hole and a tail for each reconnect over a wide gap, until the next open folds them (the model walks three in a row through the real relay and view). Folding on the spot would take rows from under a reader scrolled up to them, and each reconnect now adds a tail where it used to add the whole gap, so it waits for the next open by decision: the user chose that over merging rows while a chat is open.
- The model reaches a cold open's row directly followed by a hole, when a reopen lands before the tail did: two rows reading the same and pressing the same. Every rule holds on it, and it stays that way.
- The catch-up divider sits above the hole row and names only the times of the rows it landed, since a hole carries no stamps. The rows under the divider read in order as what happened on the laptop, the hole first (seen on the contact sheets).
- Show earlier has to stay pending until the rows it waits for commit, so the label and the rows read one deferred state. Read from the latest state while the rows read a deferred one, the label went back to Show earlier for 6 frames, 82 ms, between the whole view arriving and its rows landing. On one deferred state it holds from the tap until the frame the rows land, over 53 to 59 frames, with no frame of Show earlier between and no layout shift at the landing, in all three stories of a hole (measured at 4x CPU throttling).

- Rows landing while a thread follows used to show one blank frame, with or without a hole: a pin writes the scroll position before the virtualizer has heard of it, so what it rendered sat off screen for that frame, 55 to 63 ms over a tail of 120 rows, and 58 ms over the same rows with no hole (measured at 4x CPU throttling). A following thread now always renders the rows at the end beside its range, and all 36 timeline stories run with no blank there.
- A catch-up longer than the screen used to land with the top of the screen empty: the thread jumped to its end and lifted by up to a screen, and the rows that lift showed above the end's range were not rendered. A landing held 348 to 392 px with no row for 4 to 7 frames, 91 to 111 ms, with a hole or without one, and over rows taller than the estimate the whole 660 px for 1 to 3 frames, 65 to 84 ms, which also read as blank (measured at 4x CPU throttling, 390x844, three to six runs of each). The rows the screen will show now render before the first paint, so a landing is still one lift capped at a screen and its rows still arrive together; with the fix, no band past the thread's own spacing from the first step on, in eleven runs of each story at 390x844 and 430x932 (measured at 4x).
- Which rows the screen will show is only known from heights, and a row's height is only known once it rendered. A thread commit took about 50 ms at 4x on the dev server, so the count of commits is the cost. Walking up from the end by the estimate took six commits and a worst frame of 368 to 404 ms; naming the rows from the height of those already measured, and holding what was rendered, took three and 162 to 177 ms (measured). Against the same stories with the fix reverted, a landing's worst frame went from 111 to 140 ms to 159 to 184 ms on short rows, from 83 to 94 ms to 84 to 102 ms on turns of mixed height, and from 41 to 43 ms, with the blank, to 168 to 260 ms over tall rows (measured as above). A busy machine read higher on both sides: 181 and 213 ms with the fix reverted, 365 and 601 ms with it. A production build is not measured.
- Capping the lift at what is rendered lost to rendering what the lift shows. It kept the landing's worst frame at 107 to 134 ms and lifted 252 to 296 px instead of 660, but a short catch-up that lifts 98 px lifted none, and over tall rows the screen still held 216 px with no row for 4 frames, 103 ms, with the lift at 0: the rows at the end's range do not reach the top even at rest, so the range is what falls short, not the lift (measured as above).
- A long landing leaves 40 rows rendered where the rest state holds 23, until the next render trims them (measured).
- A hole's row and the line that fills it used to share a key, the line's offset and index, so the filled row kept the hole's measured 80 px while it rendered 32, and the rows below moved only after a ResizeObserver reported it: Show earlier landing left 60 px with no row for one frame of 14 to 64 ms in all 14 runs, and in pictures. TanStack Virtual measures through its ref only at mount, and that report renders in a later task (read in its source). Keyed apart, a filled row mounts and measures in the commit that lands it, with no band in 3 of 3 runs at 390 wide and 1 of 1 at 430, a thread still following keeping the row under the hole at 185 px and one scrolled up to it the row above at 293 px in every frame, the lift at 0, Show earlier pending from the tap until the rows land with no frame of Show earlier between, and no layout shift at the landing (measured at 4x CPU throttling). The landing's worst frame stayed within what it moves from run to run: 49 to 64 ms before and 51 to 59 after, 58 to 73 and 61 to 79 scrolled up to the hole, 128 to 142 and 139 to 148 still following (four runs each, measured as above).
- A row that truly changes height under its key still moves the rows below it a frame late, for the reason above. Over a sweep of all 43 timeline stories no row reported a height other than the one it was measured at, so no story reaches that path and nothing checks it (measured with the same tracing). Which rows can do it on real data is not measured.
- A browser asks for a font only once text needing it lays out, so a chat whose rows were the first text to want it measured them in the fallback font. The font landed before the next frame, while the commits after the mount still held the main thread: a prompt measured 76 px where it renders 52, and 36 px stayed empty between rows for one frame of 47 to 87 ms in 11 of 11 runs at 390 wide; at 430 three tall rows measured 608 where they render 560, 60 and 64 px empty on the first frame (measured at 4x CPU throttling). Asking for the three families when the app's entry runs has them in hand before those rows commit, and waits for nothing: no band in 3 of 3 runs at 390 wide and 1 of 1 at 430, the band back in all four with only that ask taken out, and the first frames' worst frame at 325 to 338 ms against 325 to 343 (measured as above). In a production build, unthrottled and on a screen with no mono text, all three answered 64 ms before the first contentful paint (measured once). The ask names no text, so of the 11 faces only the three whose range covers a space load, and a chat in another script still swaps its own faces late (reasoned, not measured). A font slower than the first rows still swaps under them, and a phone with the service worker behind it is not measured.
- A scroll position that outruns the rendered rows shows an empty thread until the virtualizer's render lands, because that render waits for a task after the scroll event, so the frame that first shows the position holds the old rows. The first sign was a story's own write, of 0 from the end of 47 rows, which read 660 px with no row at the lift of 0 for one frame; the screencast showed nothing between the header and the dock, so the tool told the truth (measured once at 4x, 1 of 43 stories in a sweep; 2 of 229 story runs before it). The app reaches the same frame. All of this was measured in Chromium at 390x844 and 4x, by real touches over CDP, on threads of tool turns.
- Latest used to glide the whole way, and a smooth scroll takes about the same time however far it goes (3552 px in about 700 ms, measured once), so its speed grows with the distance. It stayed clean up to 5910 px from the end, at up to 634 px a frame. At 9840 px, 1019 px a frame, 285 px at the bottom held no row for 4 frames, 122 to 129 ms. At 15080 px the whole 660 px held none for 6 to 7 frames, 289 to 491 ms, at 25560 px for 9 to 10 frames, 493 to 593 ms, with 9 to 11 blank pictures in the screencast, and at about 43000 px for 11 to 12 frames, 616 to 670 ms (two or three runs each). It takes a thread whose rows between are all measured, as scrolling up by finger leaves them: a row that measures differently moves the content, the pin writes the end, and the glide stops there (3641 of 3742 px in one frame, with no band).
- So Latest now starts one screen from the end and glides from there, and tells the virtualizer where it wrote, so the commit that holds the press renders the rows it starts on. At 3552, 25560 and about 43000 px that read no band and no blank picture (two or three runs each), and the worst frame of the press at 25560 px went from 67 to 85 ms to 62 to 71 ms. Telling the virtualizer is what makes it hold: the rows a thread renders for the end are a guess from the rows it sits on, and from inside a row 9608 px tall the end got 9 rows of 44 px, 396 px. A glide starting there showed no row at all for one frame, with 2 to 3 blank pictures, and a send or a reduced-motion Latest from there left 260 px for 2 frames; told, each read none (two or three runs each). Only a thread coming back from away tells it. Told on a chat's first mount, where nothing has scrolled, the first commit held 9 rows where it had held 46, and 260 px at the top held no row for 2 frames (measured).
- A send from far up, a reduced-motion Latest and coming back from a subagent's screen write the end in a press or a layout effect, so the commit lands before the paint: no band at 25560 px for the first two and 7634 px for the third, in 2 of 2 each.
- A finger is mostly slower than the rendered rows. Single flicks at 3750 and 7500 px a second moved at most 510 px a frame, with no band in 18 of 19 runs and 43 px for one frame in the other. At 15000 px a second, up to 604 px a frame, 50 px in the middle held no row for one frame in 2 of 6 runs. Flicks 120 ms apart are another matter, since Chromium adds each to the momentum of the last: at 7500 and 15000 px a second they reached 3185 to 7838 px a frame, with the thread empty for 31 to 38 frames over 1836 to 3482 ms and about half the pictures blank. Rendering in the scroll event does not fix that: with it on every scroll, 21 to 31 frames still read empty, 108 to 152 of 232 to 404 pictures stayed blank where 83 to 134 of 164 to 246 had, and the 90th percentile frame went from 70 to 72 ms to 85 to 107 ms. That render was already turned off once for what it costs a scroll. So this stays, and how far a phone's own flicks reach is not measured.
- Filling a hole is not new content at the end, so it lifts nothing. With the lift, a thread still following when the whole file landed lost its rows for 115 ms and glided the row under the hole from 668 px back to the 361 px it had been at. Without it, that row read 185 px in every frame before and after the landing, and a thread scrolled up to the hole kept the row above it at 293 px while the filled rows opened under it and pushed the rest down (all measured at 4x CPU throttling, 390x844).
- A real resume does not land before the chat's first commit. The chat's first commit with a view comes before the request even leaves, so a shorter round trip cannot get ahead of it. Tapping a card on a local hub and agent, a real transcript and a stand-in Claude, the Chromium dev server at 4x and at an emulated 300 ms round trip: first commit 55 to 91 ms after the tap, the resume going out 267 to 391 ms after it, the caught-up mark arriving at 899 to 1055 ms and the rows committed at 1038 to 1327 ms, a 1.3 MB gap among them. At 1x those were 18 to 22, 94 to 105, 710 to 735 and 746 to 768 ms. With the proxy delaying nothing, at 4x: 68 to 114, 450 to 473, 619 to 663 and 783 to 859 ms. Reloading the page onto the chat, timed from navigation at 4x, the first commit takes 909 to 2887 ms and the mark still arrives 782 to 981 ms after it; with the proxy delaying nothing, 381 to 486 ms after it. At 20x with the proxy delaying nothing the first commit still came first: 406 and 420 ms against a mark at 2267 and 2310 on a tap, and 6251 to 8308 against 8083 to 10207 on a reload. A production build and a phone are not measured.

- A thread shows one session, and there is no way back to an earlier one on the phone: the old file
  stays on the laptop and `/resume` reaches it. An open of another session starts the view over,
  and the agent reads nothing further of the session the pane left, since the phone would throw it
  away. Everything that counts on a thread only growing starts over with it: the wait for a sent
  prompt, whose count can fall and strand a row (measured), the catch-up, the always notes, and
  the thread's following, size cache and lift. The draft is the user's words about the pane rather
  than about one session, so it stays.
- A thread remounts when a session it knows changes to another, not when its first session
  arrives. Remounting on the first one threw away the following that had already pinned the
  thread to its end (measured: a test opened at the top instead of at the bottom).
- A `translateY` on the thread's content extends its scroll container's scrollable overflow by
  the same amount: in Chromium 156 a 1000 px child lifted by 100 px gave the container a
  `scrollHeight` of 1100 and a bottom `scrollTop` 100 px further down (measured). While the
  reveal's lift is up, the thread subtracts it before it judges whether it sits at the bottom or
  scrolls there; otherwise the slide read as the user scrolling away and the thread stopped
  following on every batch taller than the follow threshold.
  Scrolling there means `scrollHeight` minus the lift minus `clientHeight`. Asking for
  `scrollHeight` minus the lift alone lets the browser clamp at the lifted bottom, so a batch
  landing mid-glide counted the lift still up as growth, doubled it, and the scroll was clamped
  down under the shrinking lift for 37 to 38 frames of a six-batch burst, the glide stopping short
  instead of easing out. With `clientHeight` subtracted it was 2 to 3 frames (measured in Chromium
  at 4x CPU throttling, batches 100 ms apart, two runs each).
- A lift's first frame read as late in the log and never reached a screen. Motion renders an
  element in a microtask after every commit that re-rendered it, from its motion values as they
  stood (read in its source), and a transform derived from other motion values catches up only in
  Motion's next animation frame. So the transform the pin writes by hand was overwritten with the
  one from before the lift, and stood that way until that frame. A read in the first animation
  callback then saw the scroll moved and the lift missing: at the end of 120 lines, a row 37 px up
  for one frame and back in 20 of 20 runs of output landing in a later batch, and 5 px in 20 of 20
  of command and output in one write, where a measure's second commit left only its own part behind.
  A read after the frame's animation callbacks saw it in 0 of 20 each, and so did the bubble's place
  in the screencast's pictures, since Motion's frame runs before the paint that follows the commit
  (measured in Chromium at 390x844 and 4x CPU throttling). An earlier count of 2 of 7 and 1 of 2
  is what a read in another place among those callbacks would give (reasoned, not measured). The
  thread sets the derived value in the step that pins, so all three now read 0 of 20 each. Across
  all 57 timeline stories no pin landed between those two reads (measured), which is where such a
  frame would be painted (reasoned). It mattered past the log: a pin in a second commit before that
  frame read a scroll height short of the lift and left the scroll up by the lift. A test
  holds that, and none of the 57 stories reached it (measured). The transform written by hand stays
  beside the motion value: Motion only writes in a microtask or a frame, and a pin in the commit
  flushed right after, before either, reads the scroll height through it.
- A pin waits for the commit that holds what its rows measured, so a lift takes what landed and no
  row drops first. A pin used to raise the lift by the rows' estimates in the commit they mounted,
  and the next commit moved only the scroll back, so the difference stayed in the lift and every row
  dropped by it in the frame they landed, then glided up. It reached pictures. Following a band of
  the thread through the screencast, the first picture after the landing read 12 px on a send at
  the end of 120 lines and 92 to 94 px on a short catch-up, 20 of 20 runs each. That catch-up's rows
  fit the screen once measured, so it glided 98 px for nothing. Now the send lifts 84 px rather than
  96 and that catch-up not at all, and the first picture reads 0 px, 20 of 20 each (measured in
  Chromium at 390x844 and 4x CPU throttling).
- Lowering the lift when the scroll moves back cannot replace the wait. Of the 64 px that send's
  scroll came back, 52 belonged to a row above the screen, mounted for the lift and measuring short:
  the rows under it hold their place with the lift untouched, so taking it from the lift would throw
  them up. Writing the measured height into the content before the pin does not do it either. A
  commit places its rows at their estimated starts, and they overflow a shorter content: that
  catch-up measured 576 px and still scrolled 30 px (all measured).
- A landing that would reach past a screen pins without waiting, since it lifts a screen whatever
  it measures. Waiting there put a commit between the pin and the rows the lift shows, and the
  worst frame of a long catch-up went from 145 to 163 ms to 221 to 251, and of one over a big gap
  from 142 to 172 ms to 210 to 248. Without it they read 143 to 171 and 139 to 163, and over tall
  rows and over turns they stay where they were, 159 to 176 against 159 to 181 and 77 to 97 against
  82 to 99 (eight runs each, measured as above). Layout shift read 0 throughout.
- A following thread measures a row itself as it mounts. TanStack Virtual's ref skips that while it
  reads a scroll, for 150 ms after the last one (read in its source), and leaves it to a
  `ResizeObserver` report that renders a frame later, so a batch landing that soon pinned at the
  estimate and came back in the next frame. At four times a story's speed that read as a row 96 px
  up and then 12 px down, 6 of 6 runs of a send landing before the thread had landed, so with no
  lift to hide it; now 84 px up, 6 of 6 (measured as above). Under a lift it would have been the same
  drop a frame late (reasoned, not measured). A row that changes height after it mounted is not
  covered: the lift takes growth and not a shrink, so its rows still drop by it.
- TanStack Virtual corrects `scrollTop` itself when a row above the top first measures away
  from its estimate, and writes the correction before React commits the new heights. A thread
  that read every upward move as the user leaving lost the end on open: 299 rows of 20 px (every
  tenth 200 px) under an 84 px estimate, each rendering 400 extra hidden elements, and a last row
  of 2000 px opened 1468 px short of the end with following off in Chromium at 6x CPU
  throttling, 3 of 3 opens, after a correction moved the scroll up 396 px. Without the extra
  elements it landed 3 of 3, throttled or not (measured). Two guards each fixed it alone, 3 of
  3: while following, the virtualizer keeps only corrections for growth above the top, since
  the thread pins itself; and an upward move counts as leaving only after a touch, wheel, key, mouse or
  pen press, until the scroll settles. The thread keeps both. Growth keeps its correction
  because the pin judges a slide by how far it moved the scroll, so an uncorrected row growing
  above the top would slide the reveal for it (read in the pin's effect).
- A following thread pins again when a scroll settles, after any scroll the user did not start
  and after one during which it asked for a pin, so a write lost to a scroll still under way is
  made again. That iOS drops a `scrollTop` write during momentum is not measured yet. After a
  user's own scroll with no pin asked it stays put, so a nudge that stays inside the follow
  threshold is left where the finger put it.
- While the user's scroll is under way, a pin writes the end minus what that scroll left from it, so
  a landing lifts by what landed and nothing else moves. A pin used to write the end itself, and
  called what it moved growth. On the end of 120 lines at 4x, driven by a finger through CDP, three
  runs each: a nudge of 30 or 44 px threw the rows up 5 to 6 px as a row above measured short, 6 of
  6, and once the finger lifted the scroll's settling took the whole nudge back in one frame, 9 and
  27 px, 118 to 208 ms later, 6 of 6, because that pin counted as one asked for. A finger resting
  on a nudge had the same 9 to 15 px taken back under it, 3 of 3. Now none of it, 9 of 9: the nudges
  end 16 and 32 px from the end, and one held through a landing keeps its 15 px while the lift and the
  scroll both move 37 px and the rows stay (all measured). The next batch with no scroll under way
  goes to the end and lifts what landed and the nudge, so a nudge lasts until then. "Under way" is a
  finger down, or a gesture with a scroll that has not settled. A finger that pauses past the settling
  and lifts starts no further scroll, so it left the gesture's flag set, and a batch landing after it
  lifted 17 px and kept the 9 px nudge, 3 of 3; now it lifts 26 px and reaches the end, 3 of 3, while a
  finger still down keeps the nudge and lifts 17 px, 3 of 3 before and after (measured). A wheel that
  scrolls nothing here, as over a nested code block, left the same flag (a test holds it, not driven in
  a browser).
- A pin runs only when the content changed. The thread's first wait ending used to run one too, and
  it read a scroll the thread had not heard, so the lift rose 9 px over content that had not grown,
  3 of 3 with the finger pressed before the thread mounted, and 20 px on an earlier recording; now
  0 of 3 (measured). That press stays unheard, so the scroll's settling still takes those 9 px back
  in one frame, 3 of 3 (measured). A send's own jump to the end still wins over a nudge, in one frame:
  15 px, 3 of 3 (measured).
- A thread too short to scroll has no lift, and a landing there is the list growing. The rows above
  hold, the new row takes the place of the row it lands above, usually Working, and that row steps
  down by the new row and its gap: 58 and 64 px in one frame, or up 20 px as a Sent line goes. It
  reaches the screen: following a band through the screencast, one step between pictures 16 to 17 ms
  apart, 20 of 20 runs at each of 7 landings, and the new row whole in that same picture, 120 of 120.
  It stays. Nothing is blank and nothing overlaps, and a glide would have to pass Working over the
  new row, or fade the row in, which a live batch does not get (reasoned, not measured).
- A sent row giving way to its transcript line really gets shorter, by the 20 px of its Sent line, so
  a following thread's rows drop by that in one frame, 20 of 20 in pictures on a command at the end
  of 120 lines. It stays. Keeping the height would leave 20 px empty under the bubble, and a lift only rises,
  so taking the drop as a glide would need a lift below zero, which moves a Working row under the
  bubble up and back (reasoned, not measured).
- The chat route remounts its screen whenever the machine or pane changes, so following and the
  virtualizer's size cache start fresh per pane. A subagent opens as a child route, so the chat
  stays mounted under it and pins to the end when it is uncovered again.

- A field that grows with its text sits in a grid over an invisible copy of that text, and reads no height of its own. Setting its height to `auto` to measure it collapsed the dock for one layout on every key, and the thread's scroll was pulled back to fit: at 390 wide, 10 scroll events all at one position, the thread 120 px short of its end for 131 of 148 frames. Laid out from the copy, 5 scroll events of 24 px, one per wrapped line, off the end for those 5 frames of 133 and ending on it (real keystrokes in Chromium, unthrottled, one run of each). That this is the flicker a phone showed is a guess, since iOS is not measured. The copy's words sit in a pseudo-element, so they join no witness's text.
- Typing renders no thread. The draft's state lives in an atom per pane that the chat's screen reads, so each key re-renders the screen, and two values it hands down were rebuilt per render: a session `Option` and a filtered list. A memo on the thread did nothing until they held: 6 thread renders over 5 keys before, 0 after, and 5 with only the `Option` rebuilt (measured by the render counter). A thread renders by itself for a while after its rows land, so a test counting per key waits past that: 1 render at 50 ms, 0 at 1000 ms (measured).
- A clock read at the top of a screen re-renders the whole screen every second. In the chat that
  re-rendered every visible row; moving the clock into the leaves that show an elapsed time, each
  ticking only while its span is running, halved the idle render time (measured at 4x
  throttling, about 60 ms to about 28 ms per five seconds).
- A virtualized thread unmounts rows as they scroll away, and a remount parses its markdown again.
  react-markdown's `Markdown` export is a plain function without hooks, so the thread keeps one
  render cache for its lifetime, keyed by the text, and a remounted row reuses the element tree.
  The cache lives and dies with the thread rather than with the page, so it needs no size cap.
- An atom update renders synchronously, so a transcript that arrives while a chat slides in
  blocked the slide's frames. Reading it through `useDeferredValue` lets React render the rows in
  yielding slices: the worst frame of the slide went from about 255 ms to about 175 ms at 4x
  throttling (measured).

- Re-deriving the whole chat on every transcript event grew with its length. One event of one or
  two lines cost 112, 134, 182 and 316 ms of main-thread work at 252, 1008, 2007 and 4005 lines,
  and most of that was creating a row element for every item (66 ms at 2007 lines, React's
  development build) and re-deriving every item (19 ms). The chat's items are now a fold over
  the appended lines, and each unchanged item keeps its row element. An event then cost 72 to
  81 ms at every length from 1008 to 4005 lines, of which the fold was 0.6 to 1.4 ms (measured on
  the dev server in Chromium at 4x CPU throttling, a synthetic transcript, sampled by the CDP
  profiler; the first run in a fresh page reads higher, 112 before and 81 and 121 after).
- The fold places and drafts each new line on its own, then re-resolves only the items that can
  still change. A tool call's result or a task notification can land in any later batch. The
  last turn's calls change when the next turn starts or the activity moves. Every subagent run
  depends on the rosters, the activity and the current session. Lines that do not extend the last
  ones (a reset, a cached view, the whole transcript) start the fold over. Whether they extend is
  judged by the identity of the first and last line the fold saw: the transcript view only
  appends lines or starts over with new ones, so a middle line never changes. Tests hold it equal to
  a full recompute at every batch size of real transcripts, with the activity both changing and
  steady: with it changing on every batch, a dropped notice went unnoticed, because the activity
  already re-resolved every subagent run (measured).
- Appending to the transcript view copies its line array, which costs 0.1 to 0.2 ms per event at
  4005 lines and 4x throttling (measured), so the view keeps a plain array.
- Every herd update re-rendered the open chat, 10 of 10 updates from another machine. Three
  values the chat reads were rebuilt on each one: the chat's model, the connection view (its sync
  time moves with every herd) and each command action's progress, which builds a fresh `Idle`
  per herd. Structural equality on the model and on the progress, the model holding only what
  the chat shows, and reading only whether it can act and whether it is stale from the
  connection brought that to 0 of 10 (measured by counting component renders through React's
  devtools hook).

- The memory the transcript cache keeps per chat is small enough that nothing evicts it: 0.2 MB of heap
  for a 512 KB tail of one real transcript, 1 MB for 3 MB of it, 4 MB for the whole 13 MB, and 27.9 MB
  for the biggest local transcript, 118 MB, read whole (measured after a GC). Evicting would also make
  a reopen read the store, and only a reopen from memory has its rows in the first render.
- Saving a chat encodes it and writes it on the main thread, and reading it back costs about the same.
  At 4x, encode then write took about 4 ms for a 512 KB tail, 20 ms for 3 MB, 65 ms for a whole 13 MB
  and 388 ms for the whole 118 MB; read then decode took about 4, 20, 63 and 294 ms (measured, medians
  of three). Only a whole read of a huge transcript reaches a stall worth a frame, and a chat saves on
  its caught-up mark, on leaving and on hiding, so that stays as it is.

- A laptop catch-up is judged once per open, from the lines the cache held: the view that ends the
  catch-up counts as one only if the cached view's last line sits at the same index in it (lines
  are appended, so the same object), and its new rows are the row keys the cached lines do not
  give. A row the cache held keeps its key as more lines land, which a test holds over real
  transcripts at every cut. A chat that opened current, a cold open, a watch that failed or started
  over, and a catch-up that added no row get nothing. The fold judges the lines when the read ends,
  and the screen turns them into row keys, since only it has rows.
- The catch-up shows nothing but the thread's "Catching up" capsule and the dim on the rows it
  holds, past its first second, while it waits for the fresher view. Its rows then land in one commit under one ordinary lift capped at a screen,
  with a static divider above the first new row. Releasing them one row at a time, with a chip
  carried down a trail, held a reopen back from its end: reopening a thread of 120 lines with 40
  new ones took 267 to 273 frames, 5.1 to 5.5 s of lift, and ran past a story's wait for its last
  line. Landed at once it takes one lift of 25 to 26 frames, about 490 ms, of at most the 660 px
  screen (all measured in Chromium at 390x844 and 4x CPU throttling, four runs each).
- A thread starts lifting only once its rows are rendered and its height has held still for a
  fade's length. A fixed fade's length from the first row armed it while the first measures were
  still arriving, so a thread opened already holding 120 lines glided 151 to 156 px for about
  400 ms, 219 to 271 ms after it first showed: on its first mount in 4 of 4 runs, and on a reopen in
  2 of 4. With the wait restarting on each change of height no open lifted in 16 of 16 runs, long or
  short, cold or cached, and a catch-up landing after it still lifted (measured as above). A cold
  open tapped from a card did not lift with the fixed wait either, in 8 of 8 runs, so the race
  belongs to a thread that mounts holding its rows.
