---
name: qa-frames
description: How to look at crook's app without missing what flickers. Load it before any QA, visual check, review or "does this look right" on the PWA, any UI, animation, loading state, transition, reconnect or flicker, and before saying a UI change works. Says when to use bun run frames, agent-browser trace, record, vitals and react renders, and what each can and cannot see.
---

# Look at the app frame by frame

Never say it looks right from a settled screenshot. A screenshot is taken after the app has
stopped moving, and what goes wrong here happens before that: a "Catching up" pill on a reconnect
holds about 300 ms, a blank frame before the first link value about 70 ms, and every settled
screenshot of those screens is clean.

Say what you ran, on which stories, and what the output said. "It looks fine" with no frames
behind it is not a result.

## Start here

```sh
bun run frames transition/reconnect-chat-open   # one or more stories
bun run frames --all                            # every timeline story, about 2 minutes
bun run frames --no-baseline <story>            # every finding reads NEW, the baseline ignored
bun run frames --output tmp/frames/mine <story>
bun run stories:list                            # every story id
```

It plays each story in Chromium at 390x844 with 4x CPU throttling, at real speed, and records one
line per animation frame. It reuses a catalog server already on port 5192 or starts one and stops
it, and it opens and closes its own browser session. On a shared machine it counts as one Vite and
one browser, so take whatever lock covers those.

For each story you get PASS or FAIL, and under `<output>/<story>/` the frame log (`log.json`), the
screencast (`shots/`, `shots.json`) and a contact sheet (`contact-sheet.png`) with a tile for each
frame where the marks changed, red when a finding names it.

**Open the contact sheet of every story you are reporting on**, also on a PASS. The checks only
know what the marks name; your eyes on the sheet are the rest of the check.

## What fails a story

| Key | Meaning |
|---|---|
| `flash:<mark>` | A state held under 24 frames (400 ms at 60 Hz) and went away |
| `pair:<a>+<b>` | Two states that must never show together did |
| `blank` | The content area showed nothing between states |
| `shift:<element>` | Layout moved past the story's budget; names what moved most |
| `order:<track>:<a>><b>` | A state gave way to one the story does not allow there |

Each prints the story, frame numbers, times, the marks on screen and a frame image.

The image line says how far it was taken from its frame. Read that before you read the image: the
screencast can go a few hundred ms with no new picture, so a short state may not be in any image.
That does not clear it. The log read the DOM saying it was visible; say both.

A line reading `STARVED` means a tenth of that run's frames took over 30 ms. Other work
on the machine starved it, and the tool has already retried twice. Its frame counts mean little.
Run the story again when the machine is quieter before believing a finding from it.

## The baseline

`packages/frames/baseline.json` holds today's findings per story, so the sweep can pass on the
app as it is.

- `NEW` fails: it is a bug or a regression. Report it. Adding it to the baseline is accepting it,
  and that is the user's call, not yours.
- `FIXED` fails: something got better. Remove that key from the story; the tool says so.
- `always` must happen on every run. `sometimes` may or may not; it exists for a state whose hold
  time straddles the threshold from run to run.
- A `known` finding is still a finding. Do not report a story as good because it says PASS: say
  what it knows.

## A state with no story

The tool plays what the catalog can show. Add a timeline story to `packages/web/stories/` when a
state has none, declare what it allows in `packages/frames/src/Expectations.ts` (a test holds the
two lists equal), and add a mark to `packages/frames/src/Marks.ts` for a state nothing names. A
state story without a timeline runs too, with no declared order: blank, flash and shift still
apply.

An element carrying `data-machine` and `data-state` needs no mark to be seen: the log records every
machine's state per frame, the contact sheet takes a tile when one changes and prints it, and a
finding names the machines' states at its frame. A mark is for a state that must never flash.

## Which tool for which question

| Tool | Use it for | It can see | It cannot see |
|---|---|---|---|
| `bun run frames` | Anything that changes over time: every QA pass starts here | Marks, blank frames, layout shifts with the element, boxes, DOM added and removed, per animation frame; the screencast beside them | Pixels of its own (see below); any state no mark names; what runs between animation frames |
| `agent-browser trace` | Why a frame was long: who ran, what laid out | Every main-thread task and compositor step | Which state was on screen. It also disturbs the timing: frames at p90 up to 58 ms against 18. **Never count frames under a trace.** One story is about 94 MB; its screenshots are not in the default categories |
| `agent-browser record` | A video to show a person | What was composited, at a fixed rate (30 fps, or `--fps 60`) | Which frame held which state; nothing lines up with the log. `--contact-sheet` failed on this laptop at 30 fps and at 60 ("analyzer fell behind") and left a 0-byte video; the plain recording worked |
| `agent-browser vitals <url> --json` | Load numbers: FCP, LCP, CLS, React phases | The load, once. It navigates | Anything after the load; CLS comes with no element and no frame |
| `agent-browser react renders` (open with `--enable react-devtools`) | Which components re-render and the reason | Component names and change reasons | **Counts**: over one idle herd window it said 1030 renders where React's devtools hook counted 175, and listed components that never remounted as mounts. Count with the hook |

A settled `screenshot` or `snapshot` answers one thing: what does the screen look like once it
stops. Use it after the above, never in place of them.

## What the frame log cannot see

- It reads the DOM once per animation frame. A mark says the element was mounted, visible and above
  zero opacity, not that a pixel changed. Over a whole sweep, 75 of 84 mark changes had a pixel
  change in that element's box in the screencast, about two thirds of them within 33 ms of the log;
  9 had none.
- It runs on headless Chromium's software compositor. The screencast went up to 267 ms without a
  new picture during heavy commits while the log kept reporting, so **a state's on-screen time in
  the log is an upper bound here**. One 334 ms pill was visible in pictures for about 100 ms. The
  pill on a foreground return got at most one picture in its 214 to 250 ms, on 5 of 5 runs, and the
  one opened did not show it, where the same pill on a reconnect got 7 to 13 pictures. A phone with
  a GPU is not measured.
- Pixels do move between animation frames when the main thread is busy: compositor animations ran
  through 47 of 61 gaps over 50 ms. No DOM state can change in such a gap.
- Layout shift misses transforms by definition, so a slide or a glide never shows as a shift. Use
  the marks' boxes for those.
- Stories run the real route tree on a fake hub. Real network timing, a real phone, iOS and real
  hub behaviour are out of reach; so is anything that needs a real Claude.
- The catalog's fake link can give the real link its first value before first render, so a state
  that depends on real IO ordering may only be reachable through a story built for it.
