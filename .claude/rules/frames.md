---
paths:
  - "packages/frames/**"
---

# Frames

`bun run frames <story...>` plays timeline stories at real speed, 390x844 at 4x CPU throttling, reads
the screen once per animation frame and fails on what a settled screenshot cannot show. The
`qa-frames` skill says how to use it beside the other browser tools.

- The recorder is an init script handed to the browser, not code in the catalog, so it is there
  before any page module and the catalog carries nothing of the tool's. The table of which selector
  means which state lives in one place, so a state attribute can replace its selectors later.
- A state has to hold 24 frames or 400 ms. Over the sweeps "Catching up" held 15 to 22
  frames on a reconnect and 11 to 15 on a foreground return, and the paused composer 22 to 23, while
  states a story holds on purpose start at about 29: 30 to 31 for a card, 36 to 37 for the
  composer, 44 to 50 for a cold chat's skeleton (all measured). A threshold of 20 caught the
  reconnect pill in 2 of 3 sweeps and 24 in 3 of 3. The banner on a first load straddles 24 (6 to 37
  frames), so those stories list it as a finding only some runs show.
- 24 frames is 400 ms only at 60 Hz, and a long frame costs frames without costing time, so a state passes on either. Its time runs from its first read to its last plus one frame for that last read, so a steady 24 frames reads exactly 400 ms and a state under 24 at a steady 60 Hz is still a flash. Frames alone failed the reconnect's pill, which the app holds in time: beside the laptop's other work, at a load average of 2 to 6, 3 of 11 runs held 19 to 23 frames over 399 to 424 ms, none starved, and the pictures of a run that failed and one that passed read alike. The first read comes up to 92 ms after the hold starts, since the pill commits inside a long frame, which is why that last frame counts: without it the 399 ms run still fails. More load lengthened the hold, since the read lands later: 24 to 30 frames beside 2 busy loops, 24 to 33 beside 4, 29 to 43 beside 8, over 12, 12 and 9 runs, none under 423 ms (all measured).
- Time stops at the last read rather than at the next frame, which can come much later. A spinner closed with its chat read 6 frames, 84 ms to its last read and 452 ms to the next frame; a paused composer read 23 frames, 346 ms and 439 ms. Both stay flashes. Over three recorded sweeps, two at that load and one beside 8 busy loops, the rule flips the reconnect's pill and the first-load banner with its spinner, which held 4 to 23 frames over 475 to 730 ms, and nothing else (measured).
- A hold of 24 frames in the app, as the thread skeleton has, was the other way out, and it stays out. A chat's landing waits on the pill's hold, so slow frames would make the rows themselves later, each hold would need a frame loop, and it does nothing for a state no hold keeps, such as that banner (reasoned from the same logs).
- A starved run's clock does not count, so it passes on frames alone. A state that work holds rather than a timer stretches with the load: the reconnect's pill with its delay and hold taken out read 446 and 448 ms with no busy loops, and 463 to 869 ms beside 8, with a p90 of 22 to 26 ms, not starved (measured). So a real flash near the limit can pass on a loaded run that is not starved, and only a quiet run is a clean reading of one. Frames alone had the opposite error at the same load, and a sweep run beside other work is the case this had to fix.
- A story's layout shift budget is 0.01 in total. A story that types a bare slash command opens and closes
  the suggestion strip, and that alone measured 0.0535, so a story about something else types the
  command with an argument, which opens no strip. Per-story totals fell at 0.0006 or under, or at 0.0125 or
  over per event, so 0.01 sits in that gap. Synthetic
  events never set `hadRecentInput`, so a story's scripted press counts against it; a transform
  does not count at all.
- A sweep of the 55 timeline stories, skeleton fit included, took 356 and 372 s, contact sheets
  included, on a shared 15 GB laptop. It stays out of the gate: it needs a browser and a dev server,
  it costs six minutes per push, and its counts move with what else the machine runs. The detection runs in the
  gate, over recorded logs, with no browser.
- A loaded machine can make a false finding, by slowing every frame without any one of them looking
  long. One story's frames dropped to 19 per second with another agent working: a pill that held 51
  to 52 frames in three other sweeps held 6 and read as a flash. Counting frames over 50 ms missed
  the next case: at a load average near 9, a pill that held 54 to 55 frames in three quiet runs held
  23 for 659 ms and failed as a flash, with only 8.1% of its frames over 50 ms. The 90th percentile
  frame time told them apart: 17 ms on the six quiet runs and 42 to 44 on the two loaded ones (all
  measured). So a p90 past 30 ms means the run is starved: the tool runs it again, twice at most,
  and says so if it stays starved. With sixteen busy loops beside it, a run retried twice and printed
  that it stayed starved, at a p90 of 71 ms (measured).
- The rAF log and the screencast were checked against each other over one sweep's 3725 frames and
  2829 pictures: 75 of 84 mark changes showed a pixel change in that element's box, 48 of those
  within 33 ms of the log either way, 2 earlier, 24 up to 300 ms later and 1 over that. Blank frames
  had a content region with a standard deviation of 0.00. Screencast and trace screenshots agree
  with each other (307 against 307 and 281 against 278 pictures in joint runs), holes included, so
  the holes are not the screencast's.
- The log overstates time on screen on this setup. A pill the log held from 4590 to 4924 ms was in
  pictures from about 4818 to about 4935. Chromium's frame reporter kept saying frames were
  presented every 16 ms through that hole, with no damage, on the software renderer (trace). That
  raster lag causes it is inferred, and a phone with a GPU is not measured. So the log says what the
  DOM asked to show, and a frame image can honestly lack a state that the log found; the tool
  prints how far each image sits from its frame for that reason. On a foreground return the pill
  got at most one picture in 5 of 5 runs, and a reconnect's got 7 to 13.
- Pixels change without an animation frame: 47 of 61 main-thread gaps over 50 ms had compositor
  pictures inside. No DOM state can change in one, so the marks miss no state there.
- Tracing moves what it measures: frame times at p90 went from 18 to as high as 58 ms, and the
  pill's count ranged from 10 to 20. The recorder alone costs little: a p50 read of 0.5 to 2.5 ms
  and at most 18.5 ms at 4x, and frame p90 stayed 17.5 to 18.5 ms; adding the screencast made it
  18 to 20. Screencast yes, trace never, under a frame count.
- `agent-browser react renders` overcounts. Over one idle herd window it reported 1030 renders where a
  hook using DevTools' own did-render test counted 175 (7 per card per second, matching the 105 per
  second at fifteen cards above), and it listed components already mounted as mounts. Its
  component names and change reasons are usable; its counts are not.
- `agent-browser record` works alone at 30 and 60 fps. With `--contact-sheet` it failed on this laptop
  at both ("analyzer fell behind by more than 16 buffered frames") and left a 0-byte video
  (measured, version 0.41.1). `agent-browser skills get core --full`, which its help recommends,
  answers "Skill not found" here.
- A sweep on a server that had not met the code yet died once on its first story, reading the log
  from a page whose recorder was gone, and passed when run again (1 run; that Vite's reload caused
  it is a guess). A failed browser step now runs its story again like a starved one, so one bad
  page does not cost the sweep, and it prints that it did.
- The Working row's ghost takes no mark. It lives for a fade, under the 24 frames a state has to hold, so a mark on it read as a flash on every turn (measured).
- A story opening on a quiet state waits past a flash's limit before its first step. A 400 ms wait straddled it, the state holding 22 frames in 510 ms on one sweep and 24 to 25 on others (measured), so the same story passed and failed with nothing changed.
- A state story about where a transition ends opens there when it can, and leaves the transition to a timeline: a settle's change is recorded like any other, so a story that closed the pane in its settle failed on a flash of the Working row. A subagent's own rows still show with the pane gone from the first herd (measured). A chat's rows need the pane open first, so that settle holds its opening state past the flash limit before it changes it.
- A pane closing under an open chat moves the dock up 28 px, 127 to 155 px at 390 wide, because the closed card is that much taller than the composer. It reads 0.0063 of layout shift alone, and 0.0316 with the background dock riding it on the way out, the same before and after that dock stopped counting closed work (measured in Chromium at 4x). The second is over the budget and sits in the baseline.
- A draft growing the composer from one line to four moves the dock up 72 px, 127 to 199 px at 390 wide, and sending it moves the dock back: 0.0592 of layout shift over the 2 shifts, the same with the chip row's fix and without it (measured in Chromium at 4x). Scripted typing never sets `hadRecentInput`, where a person's typing would (reasoned), so that story's shift sits in the baseline.
- A background chip carries a mark of its own, so the log holds its box, clipped by the row like any mark's, in every frame. A chip that glides inside its row reads as a box shorter than the chip or no box at all.
- A contact sheet that added a tile only when the marks changed never showed a `/clear`, since that
  swaps rows for rows with the same marks around them (read in how it picks tiles). It also takes a tile
  when the row count changes and always shows the last frame.
- `Arr.groupWith` compares each element with its group's head, not its neighbour (measured), so it
  does not find runs of consecutive frames: a frame's index minus its position within a filter is
  the key that stays the same along a run.
- No timeline story reached the herd's blank before the link's first value, since the fake browser
  hands the real link its first value before first render: 12 of 12 loads at 4x had the skeleton
  in their first DOM read (measured). A story with the link held before that value shows it, 2
  frames lasting 58 to 87 ms. That production's IndexedDB read makes this gap longer is reasoned,
  not measured.
- A settle that clicks Back has the story report ready during the slide-out, so a chat's marks
  from before the first step read as flashes. A story that reopens a screen is judged from its
  first step instead.
- A flash's image is the last frame at its highest opacity, because the first frame of a state
  often predates any picture of it.
- A mark says a state is mounted, not that it fills anything, so a catch-up with the top of the
  screen empty passed every check with rows on screen in every frame. Each frame also reads the
  row boxes against the thread's viewport, and the widest stretch with no row at the top, in the
  middle and at the bottom of it fails a story past 20 px, from a single frame. Over every frame of
  the 36 timeline stories before the fix, top and bottom never passed 16 px, the edge's padding, and
  the middle 12 px, a row's gap, outside single frames of 36 and 60 px and the catch-up stories,
  where the smallest value past those in a band's own tail was 25.5 px (all measured). The read
  took a p50 of 1.3 ms, a p90 of 2.6 and at most 21.5 over 6300 frames at 4x (measured).
- A thread's row moving up and straight back down fails a story as `backtrack`. Each frame logs the
  move of the last row it and the previous frame both hold, and the story fails on a move up followed
  in the next frame by a move down, each at least 2 px, a guard below the smallest one found. Over
  the 57 timeline stories, one run each, a move up was followed by a move down of any size twice
  before the fix (37 and 5 px, 10785 frames) and never after it (10777 frames), so neither the lift
  nor the glide nor a landing does it (measured). A finger does it where it turns around: 11 up then
  9 down, 5 then 6, and 35 then 50 between two strokes, over three gestures driven through CDP at 4x
  (measured). So the recorder marks a frame with a finger down, and the check skips it. A wheel or a
  scrollbar turning around is not marked, since the phone has neither and no story drives one.
- The log's read is the frame's first animation callback, ahead of Motion's in all 40 runs that
  tell, so it holds what the last frame painted plus any commit since, and a Motion value reads a
  frame behind what that frame paints. A `ResizeObserver` on an element whose size that first
  callback flips runs after the frame's callbacks, and it saw Motion's write of that frame in all of
  them (measured). That is the place to read when a finding might exist only in the log, and the
  pictures are the check on it.
- A story that writes `scrollTop` itself can be read before the virtualizer has heard the scroll: twice over 229 story runs the whole viewport held no row for one frame with the lift at 0, once before a story's first step, where nothing judges it, and once failing a story that scrolls up at its start with a flash and a blank (measured; that the read comes before the scroll event is reasoned). Run such a failure again before reading it as a bug. A sweep's story that goes far up walks there, 300 px every 50 ms, slower than the flicks that stayed filled. That is also how it leaves every row measured: a story that jumps leaves the rows between unmeasured, and the Latest it goes on to press ends at a pin and passes with the bug in (measured).
- A lift that takes more than what landed fails a story as `overshoot`: every row on screen moves
  down at least 2 px in a frame where the lift rises at least 2 px. Over the 57 timeline stories, one
  run each, it found 5 such frames in 4 stories before the fix (2, 12, 12, 32 and 98 px) and none
  after it, the 2 px being the smallest there is to find (measured). The read takes every row on
  screen, since a row pushed down by one landing above it moves with the lift rising and the rows
  above stay (reasoned, no story reaches it). A finger does the same as a batch lands: 16.4 px down
  in a frame the lift rose 82.4 px, driven through CDP at 4x (measured), so a frame with a finger down
  is skipped. A flick's momentum is not marked, but a thread scrolling up stops following and
  raises no lift (read in the code).
- A lift that rises in a frame the thread's content grew under 2 px, the same guard as the two checks
  above, fails a story as `unpaid-lift`, finger or no finger: every lift is paid for by what landed. A
  log with no height, recorded before the recorder read it, is not judged. A landing whose rows and lift
  reach two different frames would read as unpaid, and none does: over a sweep's 59 stories all 8 lifts
  rose in the frame the content grew (measured). Over the 57 timeline stories, one run
  each, a lift rose by more than the content grew in no frame (measured), and each of three finger
  recordings before the fix had one such frame, 9 px with the content still. A landing can lift
  more than it grew, by what a nudge left, and passes: the check asks only that something landed.
  Stories drive no finger, so a thread's unit tests hold the fix and recorded fixtures hold the check.
- A baseline entry lists what a story always shows and what it only sometimes shows. A new key
  fails the story, an always key that did not happen fails it too and says to remove it, and a
  sometimes key does neither.
- A failure line that grows the dock or sheet holding it is a bug, with no budget or baseline entry to hide in. Every timeline story is in a sweep, and the sweep ends by holding each skeleton's boxes to the real screen, at both phone widths.
