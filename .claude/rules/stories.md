---
paths:
  - "apps/web/stories/**"
  - "apps/web/test/stories/**"
  - "apps/web/vite.stories.config.ts"
---

# Stories

- A close from the chat that stayed on the chat, blank, for the rest of a story was the story and
  not the app. Every story started at a pane id the router would have encoded, and a memory history
  keeps a path as typed, so the back navigation's comparison never matched. With the encoded path
  the chat goes back to the herd and the toast shows, with no blank (measured). A witness of the
  toast alone passed either way, since the toast shows on the chat too: a story about arriving
  somewhere names something only that place shows.

- A playback speed scales the delays between a story's steps and a story's own pauses inside a step, and a chat's slide-out does not scale. A finger's timing does not scale either: a hold or a swipe's step between moves is input the app reads, so a long press at no waits would be a tap. A settle runs before playback starts, so its pauses keep real time in the browser, where the far-up walk has to pace itself to leave every row measured. The smoke test plays at no waits, and a walk to the top of a thread under happy-dom, which does not clamp `scrollTop`, slept 331 times 50 ms: the two stories that walk took 18.9 s each against a 20 s limit, and 0.2 and 0.5 s at no waits (measured). The reopen catch-up story lost its divider at twice and four times the speed because its tap fell inside the slide-out, so the chat never left and the rows landed as live lines: its thread went from Current to Current and never held anything, 4 of 4 runs with the wait for the chat to leave taken out. With that wait it ends on its divider at 0.5, 1, 2 and 4 times the speed, 2 of 2 each, and at 8 and 16 with even the wait for the held rows taken out (all measured in Chromium, at 4x CPU throttling except the 16). How fast the rows land was never the cause.

`bun run stories` serves a catalog of the real app at phone width, and `bun run stories:list`
prints every story id with its URLs. `/stories/?story=<id>` opens one in the sidebar;
`/stories/frame.html?story=<id>` is the same story bare, `&autoplay=1&speed=<n>` plays its
timeline, and `window.__story` lists, steps, plays and awaits it. A story shows what the app does
today, warts included: a wrong-looking state is a finding about the app, not a story to fix.

- A story runs the real route tree with the hub runtime's layer seeded with a fake, so it needs
  no mock of any screen. The fixtures stay in the test folder, where about forty tests reach them
  relatively; they load in Chromium as they are (measured), and only the wiring that imported
  testing-library moved out from under the tests.
- Each story gets its own iframe. Motion reads reduced motion once per module instance, and the
  keyboard, install and reduced-motion stories stub `navigator`, `visualViewport` and
  `matchMedia`, so one page could not tell two such stories apart without resetting all of that
  by hand. It costs little: from setting an iframe's address to its story done took a median of
  368 ms and a 90th percentile of 461 ms over the whole catalog on the dev server
  (measured).
- A timeline's step is an event the hub or the user would cause, moving the real screen, so a
  step never sets a component's state. A transition that depends on the link's own delays, its
  backoff or its resume runs the real link over a fake browser: the fake link keeps one transcript
  watch through a reconnect, where the real one starts it over on each session (read in both).
- The app's clock is the real one, shifted when a story boots to where the fixtures think it is,
  so elapsed times tick and read the same on every load. The smoke test shifts it again before
  each story: a job that ended 5 s before the fixtures' now had aged out of its 14 s window by the
  time the suite reached it (measured).
- The smoke test's waits can lose to a loaded machine. Alternating whole gates at a load average of 9 to 12 failed 1 of 4 on main and 1 of 4 on a branch, on a story or a first render that passes alone, while the test step alone passed 4 of 4 on each (measured). Run such a failure alone before reading it as a bug.
- The smoke test runs every story under happy-dom, 524 of them in 98 s with two workers at a load
  average of 4 to 11, the slowest 6.1 s (measured), and it is not enough on its own. 17 stories passed there and failed in Chromium (measured): user-event's
  `type` filled the field and left React's state empty, so the send button stayed disabled, and
  its pointer check refuses a press under a sheet that is still opening. Stories type by
  setting the value through the native setter and firing `input`. After changing stories, load
  them in a browser too: one page, one iframe at a time, reading `data-story-phase` on each
  frame's root, went through all of them in about four minutes.
- Every story names what it shows, and the types refuse one that does not; a timeline also names
  where it ends, which a test holds, since a witness taken before the steps says nothing about
  them. Both the smoke test and the browser check them, so a state that stops being reached fails
  its story. A witness proves only what it names: the page's text includes whatever is covered or
  hidden, and a state that exists only as layout, such as a draft that grows its field, can only
  be witnessed by what caused it.
- Two stories failed the gate only under load, and neither was slow. One clicked a button that was
  still disabled because the link had not gone live yet, and the click was lost; a story's press now
  waits for the button to be enabled. The other waited to see a state lasting about a second, which
  a deferred render can skip altogether when the main thread stalls, so it waits for any state that
  shows what it needs. Both reproduced with sixteen busy loops beside them, 2 of 6 runs (measured).
  Raising the find limit would have hidden the first and done nothing for the second. A third
  tapped a card while the chat it had just left was still sliding out, so nothing reopened (measured:
  1 of 14 runs, the chat still mounted and current). A story that goes back waits for the chat to go.
- The chat stays mounted under a subagent's screen, so the page's text still holds the chat's own rows, and a witness that a word is absent can only fail there (measured: `Working` from the covered chat). A story there names the state of the machine on top instead.
- A working flip stamped before the transcript's last line reads as a turn already answered, so a fixture that means working now stamps its flip after its lines (measured: the composer's working stories read `done` with the fixtures' 42 s old flip).
- A witness that a typed draft landed reads the send button, not the field. The field held the
  text in Chromium while React's state stayed empty, so a check of the value alone would have
  passed the bug it exists to catch.
- The clock sits five minutes past the fixtures' start, so a status flip or transcript entry a
  live transition means as just now is stamped past that. Stamped at the start, a Working row read
  5m a second after the send, a running tool read 5m 3s, and the row stayed after the answer,
  because the answer's stamp was older than the flip (measured in Chromium).
- The coverage test is exhaustive over what is a union in the types (a new member fails to
  compile) and over the routes and the link matrix (a new route fails it at run time). It cannot
  see a state that lives in a boolean, a local `useState` or CSS, and a story names what it
  shows, not that the state looks right.
- Whether a machine has lost herdr is an `Option`, so its type asks the coverage test for no story: that table lists them by hand, and a new way to read the state fails nothing.
- Reduced motion is a stubbed `matchMedia` set before the first render. It reaches Motion only:
  the `motion-reduce:` utilities read the real media query (reasoned, not measured). Emulating it
  in the browser instead makes the dev page reload in a loop (reported by another agent, not
  measured here).
- A file put back with `git checkout` while the catalog runs can stay stale if it sits in another member: the server kept handing out a domain leaf's older transform after the file was restored, and touching the file changed nothing, where a restart did (measured once). Restart it after swapping code under it, rather than trusting what a story then shows.
- Vite discovers the highlighter's languages only when a chat first renders, and reloads the page
  once on each fresh server (measured), so the first story of a run can restart, and a sweep
  started in that page dies with it. Load a chat first and wait for the reload.
- The smoke test plays a timeline with no waits, and the fake link's watches share one queue, so
  an event offered while an old watch is still ending reaches it and is dropped. A step after
  something that restarts the watch waits for the new request first (measured: two stories failed
  until they did). A hide and a show with no step between them lost the hide on the one story that
  tried it from the herd, and the link never redialed (measured: the story timed out), so a story
  gives each its own step.
- A timeline's end witness has to hold at every playback speed. A catch-up's trail, since removed,
  showed at full length, where the missed rows land 900 ms after the tap, and not at twice the
  speed, where they land 450 ms after it, so that transition ended on the rows instead (measured in
  Chromium).

:::warning
A production build must get nothing from the catalog, and Tailwind is what would leak it. Its
automatic source detection scans everything under the Vite root that git does not ignore, so a
class only a tracked story uses reached the production stylesheet (measured). The production entry
stylesheet therefore negates the catalog's folder, and the catalog's own stylesheet imports the
same tokens without the negation. A negated `@source` beats a positive one for the same path or a
deeper one, in either order (measured), so the negation cannot live in the shared stylesheet.
:::

:::tip
An explicit `@source` reaches a folder ignored as `dir/` and does not reach files ignored as
`dir/*`, with or without a negation beside it: Tailwind's walker starts at the named directory, so
only a pattern matching what is inside it hides anything (measured, same folder, both patterns). An
`@source` naming a folder that does not exist compiles as if it were not there (measured).

Tailwind's Vite plugin scans when it transforms the stylesheet, and a folder that did not exist then
is not watched, so a prototype created while the dev server runs rendered without its arbitrary
classes until the stylesheet was transformed again (measured). The catalog's dev server therefore
marks its stylesheet changed whenever a file lands in the kitchen.
:::

The kitchen is where the `prototype` skill builds variants: one gitignored folder per prototype,
found by a lazy glob, running inside the real root, gates and shell, on the same fake hub. Keeping
it out of git was the call because a prototype is deleted once a variant wins, so a tracked one
would only reach history and the gate. It stays out of the gate on purpose: oxlint skips ignored
files, the member's `tsc` excludes the folder, and the smoke test leaves it out, since a half-built
prototype must not fail anyone's push. Its own typecheck is `typecheck:kitchen`. A prototype that
does not load fails its own story and no other. Deleting the folder removes it; nothing else names
it.

- A prototype reaches the app's `.tsx` leaves through an alias only the catalog's server has. Vite
  applies a tsconfig's `paths` only to the files that tsconfig includes, and the member's excludes
  the kitchen, so such a file fell through to the `exports` map, which reaches `.ts` leaves alone
  (measured, and a prototype importing `.tsx` leaves loads with the alias and no tsconfig of its
  own).
- `bun run frames` opens a kitchen story with no variant in its address, so it plays only the first
  variant, and it records for 2 s after a story that is done at once (measured). A comparison gets
  one kitchen story per variant.
- A prototype can swap a real route's screen by calling that route's `update` with another
  `component` as its module loads (measured).
- A skeleton swapped for rows reads a layout shift of 0, however badly it fit: the skeleton is
  removed rather than moved, so nothing counts (measured). How well a skeleton fits is measured from
  the boxes of what it stands for.
- Skeleton rows in a flex column that overflows shrink unless they are told not to: a row of 46 px
  rendered 32 (measured).
- A generated skeleton works from what is in the DOM: skullet drew `opacity: 0` elements as bones,
  skipping only `display: none`, its own elements and those marked `skullet-ignore` (measured).
