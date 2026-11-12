---
paths:
  - "apps/web/**"
---

# Web

:::tip
The link's machine knows what it just went through, and the schedule and the page signals tell it what happened; it decides nothing about when to dial. Screens read one tagged view derived from it, and what dims, what is open and what the banner says are each an exhaustive match on that view, so a view that dims without saying why, or stays open while a call would be refused, fails the walk. A cold start used to dim a cached herd for its first second with no banner and paused the composer with it, which the frame tool read as a flash on every launch (measured: 15 frames, 524 to 567 ms). A dial now reads as live.

A call made while the link dials holds in the fiber that made it. It goes out when the new connection has its first herd, and fails when a failure lands on the banner or after the 15 s the hub gives a machine to come back, whichever is first. A dial nobody answers would otherwise hold it for as long as the socket stays unanswered: effect's browser socket holds a write until it opens, with no bound of its own (read in its source).

A herd update from another machine re-rendered everything above the screens, 10 of 10 updates for each of the gate, the shell, the toast host and the action sheets, because the connection view carried the sync time and was rebuilt on every herd. A sync time now sits only in the views that show one, under structural equality: 0 of 10 (measured by counting commits through React's devtools hook in the DOM tests).

React registers with that hook when react-dom first loads, and Vitest leaves `node_modules` out of its module graph, so `vi.resetModules` cannot make it register again: a hook installed in a test file counted nothing (measured). The DOM setup installs it as its first import, before testing-library loads react-dom.
:::

:::tip
A spinner keeps one rule, in one component: it shows a second after a wait starts, and once shown it stays 400 ms and then fades. The second is the link notice's and the 400 ms is the frame tool's limit of 24 frames at 60 Hz, both reused rather than measured anew, and they share one module so they cannot part. A wait over within the second shows nothing and moves nothing: the glyph it stands in for stays where it was, and it takes no room beside a label until it shows. A line that exists only while it waits holds the room from the start, since its words would move otherwise. Before this a Send answered 1.1 s after the tap showed no progress at all, 0 of 280 frames; now it shows 27 frames, 549 ms, with no finding (measured in Chromium at 4x CPU throttling, one run of each). Only the spinner waits: a word such as "Saving…" still changes on the tap, since the tap needs an answer. A state whose own machine has already waited, the banner, the pill, the away card, the pull gesture and the Working row, draws the bare glyph, with no machine of its own, and shows at once. The Working row is a state the agent reports, not a load, and the activity machine already holds it, so a second spinner wait inside it left the row reading Working with an empty slot for 1028 ms after it mounted. With the bare glyph it spins from the frame the row mounts, at full opacity, on the prompt-to-answer and turn-with-tools stories, and neither reads a flash (measured in Chromium at 4x CPU throttling, one run each). A spinner whose host goes away with its state goes with it, whatever its hold says: a chat closed from its sheet took its Working row's spinner along after 8 and 13 frames, under the sheet and on its way out, so that story lists it as a finding some runs show.

The Working row owns the only spinner during a tool. A running tool's own row keeps a still dot, so a turn never shows two at once.

A command the hub answered is no longer waited for without end. Once it answers, the herd has 15 s to show the result, the same 15 s the hub gives a machine to come back, since a herd that cannot show it inside that means the machine is gone or the command did not land. The 15 s count from the answer's own time, because the wait's atom lives only while a screen reads it: a sheet reopened after them says so at once rather than starting over. Past that, the action stops reading as underway and says crook sent it and the machine has not shown it. It may still land, so what the herd shows later still finishes it and takes the note away. Before, "Saving…" and "Opening the chat…" were still up after 16 s of a herd that never moved (measured in the story harness). A test notification, which nothing in the herd confirms, reads Sent for as long as a toast shows, 3 s, where it used to stay until the screen left (still up after 6 s, measured the same way). That wait is the same machine, one per command, so it has no element to mark and the note is what shows it. A retry after it takes a fresh key, because the hub replays a known key's receipt instead of acting again. The bound is a context reference with the 15 s as its default, and a story sets its own, because the smoke test plays stories one after another and 15 s each would cost more than the rest of the suite.

A launch's line takes the place of the button below the field, which is disabled throughout a launch anyway, at that button's 44 px, and holds until the chat replaces the screen. Start through to the chat grew the dock 76 px and took it back, 0.0964 of layout shift over 3 shifts; now the dock does not move, and only the line's words do as the chat's button joins them, 0.0011 (measured in Chromium at 4x CPU throttling). The note that the pane has not shown still grows the dock, by 116 px at once.

A new agent's launch keeps one call per attempt, so its bound has one call to read, and the call is no longer tied to the screen (read in the code, not measured). An audit said a failed start could show on a screen opened later because the failure was not gated by its attempt. It could not, by leaving and coming back: the old call's atom went with the screen, and the test that leaves and comes back passes on the old code too (measured). That test holds the behaviour, not a fix.

A command that finishes while a machine's atom computes its first value has no state to step from yet, since the atom has returned nothing. A wait that had already run out finished there: traced, the event reached the dispatch with no value and was dropped, and the action stayed at Sent, read 120 ms later. The atom keeps such events and folds them over its first state before it returns.

A composer's failure has an exit other than the next send. A refused prompt holds while the field holds the words it refused, which the failure itself puts back, and clears once the draft moves on. A refused Stop has nothing to do with the draft: it clears on the next press or when the turn ends. A refused prompt outlives a turn ending, because the words are still unsent. Before, both stayed through an edit or the end of the turn (measured in the story harness). A failure lands one commit after the state that causes it, since those inputs reach the machine from effects: over 5 of 5 refused sends one frame sat between the spinner leaving and the failure line, 37 to 80 ms, showing an idle Send and nothing wrong (measured in Chromium at 4x CPU throttling). That frame stays, since it reads as neither a flash nor a state.

The Background dock and its summary were reported to land apart, the dock on its second tick and the summary on its own timer. They do not: one timer wakes the screen, the dock reads the clock as it renders, and over 4 of 4 runs of a dock that ran its full 14 s the summary's row mounted one frame before the dock began to fade, 7 to 9 ms apart (measured in Chromium at 4x CPU throttling).
:::

The PWA is a Vite app, so it carries a few things the Bun members do not.

- The generated route tree is gitignored, so `typecheck` and `test` both run the router's
  generator first: a test imports the tree, and the gate's order must not be what makes it exist.
  A route file declares its `Route` constant above its component: `statement-order` ranks
  constants above functions, and a function declaration is hoisted, so the order is legal.
- The tool-loaded config files (Vite, Vitest, the PWA assets config) have an override turning off
  `effecttsgo/async-function` and `effecttsgo/node-builtin-import`. Their hooks are async callbacks
  a tool awaits, not Effect programs. Everything under `src` keeps both rules.
- The service worker's precache injection point is renamed from `self.__WB_MANIFEST`, which
  `no-underscore-dangle` rejects. The worker compiles under its own tsconfig with the WebWorker lib.
- The member reaches its own leaves as `@crook/web/...` through a tsconfig `paths` alias, which
  Vite and Vitest read too. Its `exports` map is for other members, and a subpath pattern there
  substitutes into one fixed extension, so `./src/*.ts` reaches the `.ts` leaves and never a
  `.tsx` one. `components.json` names the same alias, so `shadcn add` writes it.
- `@tanstack/history` is a direct dependency pinned to the exact version the router pins, only so
  history state can be typed by module augmentation. An augmentation merges into the copy the
  compiler resolves from this member; a second copy would leave the router's type untouched.
  The router, its Vite plugin and its CLI are pinned exactly as well, and the four bump together:
  a caret router resolves on a fresh install to a release that may pin another history.
- `no-underscore-dangle` allows a dangling underscore in a destructuring pattern. The router
  offers no other name for a history entry's index than its own underscored state field, so that
  one field is read by destructuring it into a plain name.
- TanStack Router updates `location` when a navigation starts, commits the new matches when it
  has loaded, and only then updates `resolvedLocation`. A
  component still mounted when `resolvedLocation` changes is part of where the navigation landed.
  `status` is `pending` from the first step until the last, which sets it back to `idle` in the
  same batch, so a newly mounted screen can see a `resolvedLocation` one entry behind its own.
- The router's `navigate` commits no history entry when the target's href and user state equal
  the location it is already on, a pending one included; `router.history.push` always pushes
  (measured).
- The router calls `window.scrollTo({ top: 0, left: 0 })` on a navigation, so a test that spies
  on `scrollTo` asserts the arguments it expects, never that it was not called (measured).
- Motion stops a motion value's animation by the next frame once nothing observes the value, so
  an animation whose `motion` element has unmounted never completes, and its `onComplete` never
  runs (measured). `stop()` does not call `onComplete` either; a step that must happen on arrival
  is run by whatever stops the animation.
- Motion can drop an opacity animation that is retargeted just as the previous one ends: a
  fade to 0.6 that flipped back to 1 about 40 ms later, with the first fade within 0.003 of its
  end, stayed at 0.6 with nothing running (measured on motion 14.4.0, 2 of 12 reloads of a chat
  whose socket was cold for a moment). A state fade that can flip back quickly is a CSS
  transition, which retargets from wherever it stands; with one, 15 of 15 reloads came back.
- Motion drops any inherited velocity on a spring defined by `duration` and `bounce`, and a
  motion value's `jump` zeroes it (both read in motion-dom 14.4.0), so a glide restarted that way
  for every batch started each one from rest. A spring with stiffness 341 and critical damping
  traces the same curve as `duration: 0.5, bounce: 0` (measured, every sample to the pixel) and
  keeps the speed it is given. The thread's lift is that spring following where the content
  rests: each batch moves the target, and the follower is retargeted in place from its own
  position and speed, folding every set made within one frame into one retarget (read in its
  source).
- What a failure says to the phone and what an operator needs are two texts. A failure's message is
  what happened and what to do, in words, with no pane id, ask id, idempotency key, env var or
  database text, and its fields stay on the wire as they were, since older phones and agents decode
  them. A disk failing under the hub reads "could not save that" on the phone, and the database's own
  words and the setting to check go to the hub's log as it refuses the call. The hub or agent logs what it leaves out at the moment it tells the phone, herdr's code, Hark's status and answer, the setting.
  The one place the phone names a setting is the note that the hub has no Hark token. Whoever reads it runs the hub, it stands where the test button it disables would have answered, and nothing else on the phone could say what to set, so it keeps the variable and the scopes. The failure a send meets when there is no token still reads in words. A connection failure only the phone ever sees has no log to keep a detail for, so it carries none.

- A chat's title holds its room before the link's first value, invisible rather than absent, so
  nothing moves when the name lands, and after that value a pane the herd has no name for reads
  "Chat". It used to read the raw pane id in both. A card, a sheet, a notification and a Live Activity read the same word, so two untitled panes in one folder read alike on the list.

- The router percent-encodes a path param, so a herdr pane id like `w1:p3` sits in the URL as
  `w1%3Ap3`, and the route's params hand it back decoded (measured). A memory history started at
  the unencoded path keeps it as typed, so a test that compares the location with one the router
  builds starts at the encoded path (measured: the close from the chat never went back otherwise).
- A hook that hands back an `Effect` is a zero-argument function returning a lazy Effect, and
  `effecttsgo/lazy-effect` rejects it (measured). Code that needs the router takes it as an
  argument, typed `RegisteredRouter`: `AnyRouter` types `history` as `any`, and the type-aware
  rules reject every call on it (measured).
- A grid with no column template gives each item an `auto` column, which grows to the item's
  min-content, so a `truncate` inside it never truncates and a long agent title pushed its card
  past the screen on real data (measured). A grid whose items must shrink takes `grid-cols-1`,
  whose `minmax(0, 1fr)` lets them.
- A flex item's minimum width is its min-content too, and that holds at every level between the
  row and the `truncate`. The swapped text kept its own nowrap width inside a `min-w-0` slot, so a
  background run's line ran under its dot and off the row at 320 and 390 wide; with `min-w-0` on
  the swapped span as well it ends in an ellipsis (measured).
- A production build minifies the CSS, so a custom property read back at runtime is not what
  `index.css` spells: `180ms` comes back as `.18s` and `cubic-bezier(0.22, …)` as
  `cubic-bezier(.22, …)` (measured). The dev server and the tests serve the source, so only
  `vite preview` shows it; a parser for a token accepts every form CSS allows.
- A screen never hands a callback to a hub call it starts. The call can outlive the screen, and
  the callback then acts on a screen that is gone: a forget's "go back" that lands after the user
  already went back pops a second history entry. The screen reads the call's result atom and acts
  on it from an effect, which runs only while it is mounted. A setter from `useAtom` or
  `useAtomSet` in `promiseExit` mode keeps the call running after the screen unmounts, because
  it holds a subscription until the result settles (read in its source, and a test that leaves
  mid-forget sees the forget land).
- An atom over a `Stream` adds `Cause.NoSuchElementError` to its error channel, for a stream that
  ends before its first element, even one that never ends (measured: a type error). A prop that
  takes the atom's result names that error too.
- Every atom that talks to the hub runs on one `Atom.runtime`. A component test seeds the registry
  with `Atom.initialValue(runtime.layer, fake)` and renders the real route tree; a test that
  renders a route without it dials a real WebSocket and fails with `ECONNREFUSED` (measured).
  Seeding a derived atom such as the connection or the needs-you count does not stand in for
  it: the registry still builds the atom, keeping the seeded value, so its reads reach the
  runtime and dial all the same (measured). Seed the runtime's layer.
- An effect atom re-runs whenever anything it reads changes, and the re-run interrupts the effect
  still in flight. One that reads the whole herd re-ran its hub call on every herd change from
  any machine (measured: five calls where one was due). It reads a derived atom that holds only
  its decision instead; atoms compare values with `Object.is`, so a boolean that did not flip
  wakes nothing.
- Shiki's hast names an element's classes in `properties.class`, a space-separated string, not in
  hast's usual `className` array (measured on 4.5). A walk that looks for `className` finds no
  line and renders every block plain; test the walk against a real highlighter's output.

- An atom that has to react to another atom without re-running reads it through `get.stream`,
  which subscribes through the registry instead of adding a dependency (read in `AtomRegistry`).
  Each run of that stream adds a subscription that lives until the atom does, so run it once for
  the atom's life and fan it out, rather than re-running it per wait.
- `get.stream` subscribes only when the stream first runs, and a stream run in a forked fiber
  first runs whenever that fiber is scheduled, so a change that lands before then is lost. Under
  CPU load the chat's restart listener subscribed after its watch had already failed, and a
  Try again pressed in between never restarted it (measured: two tests failing every run with
  sixteen busy loops beside them, passing every run once fixed). An effect that must not miss a
  change subscribes through the `AtomRegistry` into a queue before it forks anything, and the
  forked fiber drains the queue.

- Motion reads `prefers-reduced-motion` once per module instance, so a test file that renders
  with it off and then on gets the first answer both times (measured: the reduced test saw the
  full animation). A component's reduced-motion tests live in a file of their own.

- Vite's dev and preview servers check the `Host` header against `allowedHosts` for HTTP
  requests and the HMR socket, but not for a proxied WebSocket upgrade (measured on 8.3.4: an
  upgrade with `Host: attacker.example` was proxied). A proxy rule that trusts an upgrade does
  its own host check, and the `Host` it compares against must be a fixed name, never another
  request header: a DNS-rebound page sends a matching `Host` and `Origin`.

- Shiki's JavaScript regex engine compiles a grammar's patterns the first time it meets them, so
  the first blocks of each language cost far more than the rest: over one real transcript's 204
  code blocks the first pass took 1507 ms and the second 219 ms, and a nine-line TypeScript block
  took 434 ms on its own (measured in Bun on a desktop). In a browser that froze scrolling for over
  half a second at 4x CPU throttling. Highlighting therefore runs in a Web Worker, and the main
  thread only renders the tokens it sends back.
- A worker that awaits its own setup before it listens for messages loses every message posted
  in the meantime: the highlighter answered nothing until it listened first and loaded lazily
  (measured).

- A focus test compares `document.activeElement` with the element itself. Focus that fell to the
  body still passes a check on its `textContent`, which holds every label on the page (measured: a
  test asserting the tab's text passed with focus on the body).

- A command's keep-alive atom costs 2.26 KB of heap per send (measured over 1000 sends, after a GC), so
  a phone would need 10000 sends in one app lifetime to hold 22 MB. It stays until something else
  changes that atom.

- An atom subscription made without `immediate` does not compute the atom, so it depends on
  nothing and never fires until something else reads the atom: a test that counted wakes that way
  counted none, whatever the atom did (measured). The first read by anything else then fires it
  with the atom's current value, though nothing changed: a retry signal subscribed that way
  delivered its initial 0 once a component read it, with nothing pressed (measured).
- An effect that needs an atom's latest value only at given moments reads it with the registry's
  `get` right then. Mirroring it into a `Ref` through a subscription cost a fiber per atom and
  added nothing; only a change that must not be missed needs the subscription.
- The herd cache is written by one fiber, never on the receive path. It saves whatever herd the
  link holds and coalesces the updates that land while a write is out, with no time debounce, like
  the transcript pipe. Logout clears the cache and forgets the herd while holding that writer's
  permit, so a write still out lands before the clear and none can start after it.

:::warning
`shadcn add` writes a `utils` module even when `components.json` aliases `utils` to the `cn`
package (measured on 4.22.0). That module only re-exports `cn`, which
`no-reexport-only-modules` rejects. Delete it after every add; components import `cn` from `cn`.
:::

:::warning
The app imports neither shadcn's stylesheet nor tw-animate-css, and buttons take no
`class-variance-authority`. A component `shadcn add` writes may use `animate-in`, `fade-in` and the
like, which now emit nothing and fail nowhere, and `data-open:` and its siblings, which fall back on
Tailwind's own `[data-open]` selector (reasoned, not measured). Read what an add wrote before
keeping it.

The agent status icons are filled, and lucide's are stroked, so they sit inline with the paths they
always had. Moving them to lucide is a change of look, not a tidy-up.

A stylesheet can carry what a grep for its classes misses. Two `@utility` of one name in two
stylesheets merge into one rule, so an app utility sharing a name with a stylesheet's can lean on it
unseen: one got `scrollbar-width` only from shadcn's, and the declaration left the production CSS
with the import (measured). Tailwind also
emits a rule for any plain word in the source that names a utility, so the words `running` and
`paused` kept tw-animate-css's rules of those names in the build, though the 438 catalog stories
applied 589 distinct classes and neither was one (measured). So when a stylesheet goes, diff the
production CSS rule by rule rather than trusting the grep.
:::

:::warning
The PWA assets generator writes its PNGs next to the source image. The image must live in Vite's
public directory or the icons never reach the build (measured).
:::

:::warning
fontkit cannot apply a variation to a WOFF2 font: it crashes reading the `cmap` (measured). Decompress
to an sfnt with `wawoff2` first; variations and kerning then work.
:::

:::tip
happy-dom, measured:

- Its `Element.animate` rejects with an `AbortError` on cancel, which surfaces as unhandled
  rejections from Motion. The test setup deletes `animate` from the element prototype, so Motion
  falls back to its JS animator.
- Its pointer events always carry a `pageX` of 0, whatever the init says. Motion's drag reads
  `pageX`, so a drag test defines it on each event before dispatching.
- It does not resolve custom properties from stylesheets. Code that reads a CSS token at runtime
  gets nothing unless the setup copies the tokens onto the root element from the raw stylesheet.
  Vitest empties CSS imports, a `?raw` one included, unless its `css.include` names that file.
- It does no layout, so nothing scrolls on its own. TanStack Virtual takes the viewport's size
  from `clientHeight` and its offset from `scrollTop` on a `scroll` event, so a test that needs
  rows to leave the range defines `scrollHeight` on the viewport, lets the thread follow the
  bottom, and dispatches `scroll` itself once `scrollTop` has moved.
- An event dispatched on an element reaches listeners on `window` too, so a gesture test
  dispatches every pointer event on the element it drags, and both the component's own handlers
  and Motion's window listeners see it.
- Its `:focus-visible` matches any focused element, a clicked one included (read in its selector
  code), so a test cannot tell keyboard focus from a tap through it.
- It has no `window.visualViewport`. A keyboard test defines one, an `EventTarget` carrying
  `height`, `offsetTop` and `scale`, and dispatches `resize` or `scroll` on it.
- A motion value that an animation moves reads a `getVelocity` of 0 every frame: the value is
  set twice per frame at different times, so its previous frame value equals its current one
  (measured). Test a glide by where it goes, not by the speed it reports.
- It does not clamp `scrollTop`: a viewport whose `scrollHeight` a test fixed at 100000 kept a
  `scrollTop` of 100000 when set to it (measured). A test reads the bottom as `scrollHeight` minus
  `clientHeight`, which is where a browser clamps.
- Its `ResizeObserver` never reports, and TanStack Virtual measures a row through its ref only
  while it is not scrolling, so a row mounted by a scroll while the thread is not following keeps
  its estimate for good. A test of the virtualizer's own corrections stubs `ResizeObserver` with one that reports when told, and
  waits a moment after: the correction landed after the call that reported the size (measured).
:::

:::tip
A component test awaits testing-library promises, and an `async` test body trips
`effecttsgo/async-function`. Write it as `it.effect`, with `Effect.promise` around each
testing-library call.
:::

:::tip
Tailwind v4 skips gitignored files when it scans for classes, so a probe page under `tmp/` renders
without any class only it uses (measured). Use inline styles there, or classes the app already uses.
:::

:::tip
A region meant to scroll as a whole when its height runs out is a flex column whose children do
not shrink. As a grid it squeezed its own scrolling child (a capped code block) to a sliver and
never scrolled itself (measured in Chromium at 375×812 with the visual viewport shrunk). The
phone's keyboard is emulated by redefining `visualViewport.height` and dispatching `resize` on it.
:::

- A test that really waits out two notice delays spends 2.4 s of Vitest's 5 s limit on sleeping alone. Alone it took about 2.8 s, and 3.9 s beside sixteen busy loops, but it hit the limit once in a whole gate, so it carries a longer limit of its own, 15 s, a guard and not a measurement. The test of a restart only the old agent answers waits out the whole 2943 ms bound on the real clock, so it carries the same guard, before it ever failed.
- A notice floats in a card above the dock or sheet it belongs to, over what is behind it, rather than growing it: a failure line took a dock from 127 to 195 px, 187 to 303 px and back on a launch that gives up, and a sheet from 265 to 313 px (measured), which is the layout moving twice for one sentence. One stack per surface, since two beside each other overlap. A failure that belongs to a card in a list goes to a toast, since a card has nowhere to float and a list moving under the finger is the bug. A failure at the very end of a page moves nothing and stays where it is. A toast comes only from a failure that lands while its screen is mounted: an action's result outlives the screen, so reading one on a remount would toast an old failure for nothing the user just did (reasoned, not measured).
- The connection banner lies over the content under the header instead of pushing it. Tab screens and a machine's page slide their content down by its height with a transform, which reads the same and is no layout shift, and a chat leaves its thread alone, since a thread sits at its end: at the top of a short chat the banner lies over the first row's top edge while it shows (seen in a shot). Stories with a banner measured 0.037 to 0.056 before and all pass the still budget now, so the banner's own budget went.
