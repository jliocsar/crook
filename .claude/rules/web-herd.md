---
paths:
  - "apps/web/src/herd/**"
  - "apps/web/src/machines/**"
  - "apps/web/src/machine/**"
  - "apps/web/src/navigation/**"
  - "apps/web/src/motion/**"
  - "apps/web/src/components/**"
  - "apps/web/test/herd/**"
  - "apps/web/test/machines/**"
  - "apps/web/test/machine/**"
  - "apps/web/test/navigation/**"
  - "apps/web/test/motion/**"
  - "apps/web/test/components/**"
  - "apps/web/src/atoms/Herd.ts"
  - "apps/web/src/atoms/Machines.ts"
---

# Web: herd, machines and navigation

The herd list, the machine screens, pushed screens and the gestures between them.

- A machine's cards go pinned first, then those with a draft, then blocked ones longest waiting first, then unseen done ones newest first, then everything else by when its chat was last opened on this phone, most recent first, and in herdr's order among those never opened. Working, idle, seen done and unknown share that last group on purpose: as tiers of their own, every flip between working and settled moved the card, which is what read as random. A card moves only when someone needs you or the person did something: pinned it, typed a draft, opened it. The tiers and the groups they rank in are two tables, so splitting the last group again, or changing its key, is an edit to one of them.
- Opening a chat stamps the time on the chat's mount, so a link or a notification counts as an open too. The times live on the phone in IndexedDB, keyed by machine and pane, and survive a restart; a save drops the panes that machine no longer lists, and keeps everything for a machine whose agents the phone cannot see. The herd's layout waits for the drafts and those times to load as well as the herd, so a cold start paints once in order instead of gliding cards a moment after (reasoned, not measured). Both fall back to empty when the browser refuses storage, never to waiting for good.
- A blocked agent reads "needs you" wherever its status is put in words, the same words the tab
  badge and the machine counts use; "blocked" is herdr's word, not the user's.
- The herdr lost pill keeps one line beside a machine's badge and update pill. On a card the three take 226.4 px of 285 at 375 wide and of 300 at 390, and in the machine's header, whose 8 px gap is the same as a dot to its own word, so a dot never sits nearer the word before it, 218.4 of 319 and of 334; at 320 the card has 3.6 px to spare and the header 45.6. A long name truncates and leaves that row alone. The Herdr row stays 44 px tall as a version and as a lost time. The pill arriving moves the update pill sideways in one frame, 79.8 px on a card and 75.8 in the header, for 0.00076 and 0.00128 of layout shift, with the row's own value in the second (all measured in Chromium, the shifts at 390x844 and 4x CPU throttling).
- A machine that lost herdr has no reading of its panes, so nothing about it may say what is running. With no agents on record each spot says it cannot see them, and a tab notice saying nothing runs shows only if no machine is in that state. The Agents tab says this under each machine's header and has no notice of its own for it: a notice above the headers moved them 327.5 px when herdr came back with agents, 0.1729 of layout shift against 0 with the line, and it would be wrong for a lost machine beside an empty or an offline one (measured at 390x844 and 4x CPU throttling). The pill follows the machine rather than its link, so it stays through a reconnect instead of popping back after it. In a section's heading at 320 wide, the pill beside a count of who needs you truncates a six-letter name by 4 px; from 375 wide it fits (measured).
- A kept row drops to the muted colour rather than to the 60% that failed content dims to, because that reads as disabled on a row that still opens and swipes, and it fails contrast. At 60% the row's small muted text reads 2.68 to 1 in light and 3.55 in dark, against 6.58 and 7.77 at full strength, and its status words 1.97 to 2.51 and 2.35 to 3.5. Muted, the title reads 6.61 and 7.02 and the status word and clock 5.86 to 7.62 and 6.33 to 6.57, above what a live row's own 3.44 for Working and 2.71 for its clock read in light. An unknown row stays at the 3.51 and 4.35 it reads live (all computed from the rendered colours in Chromium, both themes). Overriding the three status tokens on the card recolours its icon, pill and ask at once, and leaves the frame and the swipe actions alone.
- A kept row's clock reads the time herdr went, from the agent's own stamp, so it holds through a remount or a reopened app, where a clock stopped by not ticking would read whenever the row mounted, and it cannot disagree with the laptop's clock. When herdr comes back the label ticks from the shared clock again; its first read can hold the last tick for one frame before the catch-up, seen in 2 of 3 runs for 1 to 2 ms, moving forward both times (measured in Chromium).
- An empty machine that gains agents moves everything below them on the machine screen: About went down 188 px, 0.1027 of layout shift, whether the machine was healthy or had just got herdr back (measured at 390x844 and 4x CPU throttling). That is rows truly landing above other content, so it is no story's budget to hide; the story for herdr coming back to a machine with nothing on record lands with no agents.

- The Hold Button's label follows what its parent says. It used to show its complete label for
  1200 ms after a hold and then go back, so a Forget still out read "Hold to forget" again while
  it was still pending (measured at 1400 ms in the story harness).

- Motion ends a drag on `pointercancel` exactly as on `pointerup`, and `onDragEnd` gets the
  drag's velocity. On a `pan-y` card a quick scroll that drifted left therefore opened the row the
  moment the scroll cancelled the pointer (measured in a test; that iOS cancels there is for the
  phone). A drag that must lose to the page's scroll moves nothing until it has picked its axis.
- Motion's `dragDirectionLock` picks the axis on the first frame either one has passed 10px, and
  tries `y` first: a quick swipe left that had moved 20px across and 11px down by that frame
  locked to `y` and never moved (measured on motion 14.4.0). The app's own axis lock compares
  the two axes instead and starts the drag through `dragControls` once it has picked `x`.
- Base UI's Dialog returns focus on close to the element focused before it opened only while that
  element is still connected; once it is gone, focus lands on the body (measured on 1.9.0, after a
  close removed the card that opened the sheet). The shared sheet hands Base UI its own return
  target, falling back to the current tab when the opener is gone or inert, and is told outright
  when its own action removed the opener, rather than trusting `isConnected` on an element that may
  still be animating out.
- The phone keyboard shrinks the visual viewport and leaves `innerHeight` alone, so a fixed
  screen keeps its full height under the keyboard and its dock ends up behind it. A pushed screen
  therefore fits its content to `visualViewport.height` and moves it to its `offsetTop` whenever
  the visual viewport is shorter than the window at scale 1, while its opaque surface stays the
  whole window. iOS draws the keyboard over the page, and a dictation keyboard's glass bar shows
  what lies under it: when the whole screen shrank to the visible part, the Agents page's tab bar
  showed through the bar under the chat (seen in a story with a translucent keyboard, light and
  dark, at 390 and 320 wide). Only the content moves, so nothing from another screen sits under
  the keyboard, pins the page back to the top while
  that holds, and marks itself as fitted so the docks drop the home-indicator padding. One inset
  for the whole screen keeps the header at the top and every dock, the ask and the slash strip
  included, on the keyboard; a pinch zoom also shrinks the visual viewport but changes `scale`,
  and leaves the screen alone. Measured in Chromium at 375×812 with the keyboard emulated: the
  header held at the top, the thread took the height that was left, and the dock sat on the
  keyboard's edge, also with `offsetTop` panned. What iOS reports for `scrollY` and `offsetTop`
  on focus is not measured yet.
- A script moving focus off a text field draws the focus ring, because Chromium reads focus coming
  from an input as keyboard focus: the card that takes over from the composer showed its Back button
  ringed in red on a phone-size screen, with nothing pressed (measured). A move no key caused passes
  `focusVisible: false`.

- The Agents page stays mounted under a pushed chat. It used to re-render whole on every herd
  update and every clock second: with fifteen cards on three machines and a chat open, each herd
  render was about 680 component renders, and the page cost 373 to 394 ms of main-thread task
  time per herd update and 144 to 186 ms per idle second at 4x throttling. Under a chat its clocks
  stop: 0 herd-page renders per clock second. What it does on a herd update is the entries below.
  Shown and idle, it commits once a second with only the elapsed times re-rendering, 105
  component renders and 38 to 41 ms per second (all measured on the dev server with a fake hub,
  counting renders through React's devtools hook, two to eight runs each).
- A shown Agents page rendered every card on every herd update. A change to one card of 15 on three
  machines went from 516 component renders and 232 to 235 ms of main-thread task time to 177 and 112
  to 121 ms, and a status flip, which also plays that card's own animations, from 529 and 339 to
  360 ms to 191 and 232 to 240 ms. A clock second went from 90 renders and 48 to 60 ms to 15 and 19
  to 26 ms, once the pill's clock moved into the label that shows it (all measured with the devtools
  hook, a fake hub and CDP's task duration, Chromium on the dev server at 4x, three runs each; a
  production build and a phone are not measured).
- Only a card's body is memoized, by structural equality over its props. Its motion row still renders
  on every update, because Motion animates a layout change only for the rows that rendered; memoizing
  the row too gained nothing against the same update, 111 to 117 ms, so it would risk the glides for
  no measured gain.
- A memo does not stop AnimatePresence's context. With `presenceAffectsLayout`, its default, it builds
  a new context value on every render (read in its source), so each memoized card still rendered its
  own nested presences, 30 of them per update. Turning that option off also stops the render that lets
  the rows below a removed card glide up: they jumped 108 px in one frame, 2 of 2 runs, where they
  otherwise take 28 steps. So the row keeps the option and the body under it reads a null presence
  context, and a reorder, a removal and an added card each glide as before (measured in Chromium at 4x,
  two runs each, reading every card's box per frame).
- A machine's badge reads the clock only while the machine is offline, so a list of online machines
  renders nothing on a clock second, down from 60 renders and 27 to 33 ms. The Machines tab reads its
  atoms inside the covered scope, like the Agents page, and a machine's screen renders only for its
  own machine: an update from another machine under that screen went from 262 renders and 110 to 113
  ms to none, and its clock second from 235 renders and 105 to 113 ms to 12 and 13 to 18 ms (measured
  as above, 3 machines). The tab under that screen has since gone back to following the herd in the
  background, as the Agents page does, so it pays what the shown list pays (reasoned, not measured). A
  herd update to the shown list itself stays about what it was, 22 to 29 ms before and 26 to 31 after,
  and is left alone.
- What a status flip costs outside the screen is too small to spend code on, so deltas stay unbuilt.
  With 15 agents the phone encoded its herd snapshot in about 1 ms and wrote it to IndexedDB in about 1
  ms at 4x CPU throttling, 56 ms at worst. A flip sends one machine's entry, 2440
  bytes at 5 agents, which decodes in under 1 ms at 4x. The hub's upsert took a median of 0.011 to
  0.014 ms and at most 8 ms over 6000 writes to a file (all measured, Chromium and Bun on the laptop).

- The list under a chat that has arrived follows the herd. It used to hold what it showed until the chat had gone, so a back tap or a swipe slid the chat off old cards, and they changed after the slide with the chat already off screen, a removed card's gap showing first (measured in Chromium at 390x844 and 4x CPU throttling, and in the pictures). A close from the chat got the same. Going by what a frame reads now, no card changes, leaves or moves from the first frame of a back tap or a swipe, a swipe that stops part way included, and the slide's worst frame went from 50 ms, the catch-up at its end, to 18 to 20 ms (one run of each, 4x).
- A screen under a pushed one is in one of four phases. Arriving holds what it shows, since a tap's own seen mark would otherwise change the card under the finger while the chat slides over it (reasoned, not measured). Over renders herd updates in the background, through a deferred value and a memoized body, so they are one React transition that yields to anything else. Typing is over with a hold on it. Shown is live and in sight, and the screen is shown from the moment a back tap or a swipe starts, not from when the chat is gone: a swipe released short goes back to over once the chat has come back. A pushed screen says where it stands to the tab under it, and a screen pushed over a pushed screen says nothing to it.
- A herd update under an arrived chat costs what it costs on a shown list. A status flip among fifteen cards on three machines took 203 to 225 ms of main-thread task per flip, three runs of twelve, against 7 ms or less while the list held. Nothing yielded in its commit: rendered at once beside typing, a keystroke's time to its next frame went from a p90 of 44.3 to 46.5 ms and a worst of 52.5 to 75.9 to a p90 of 81.8 to 83.1 and a worst of 103.9 to 127.9, with 11 or 12 tasks over 50 ms per run, the longest 81 ms, one flip a second (dev server, 4x, three runs each). So any input under the chat holds the list for a second after the last one, the second a link's notice waits, reused and not measured anew. With it the same typing read a p90 of 46.4 to 49.8 ms and a worst of 53 to 93.1, with no task over 50 ms, and the median stayed 41 to 45 throughout. A production build and a phone are not measured. An input is what is listened for rather than a key, since a phone's keyboard does not always send one (reasoned, not measured).
- A back tap or a swipe inside that second catches the list up synchronously in the commit that starts it, the one case where a slide starts behind a full list render, so the chat stays where it was for one long frame: 195 ms on a tap and 164 ms on a swipe, with a change among five cards, and the first frame that shows the list shows it right (measured on the dev server in Chromium at 4x, one run of each, and in the pictures). A swipe's first move flushes that commit before it moves the chat, because a move is not a discrete event and its render could otherwise land after a frame showing the old cards (reasoned: one run without the flush landed it in time). A herd update that lands while the chat is already leaving plays as on any shown list, since it happens in view (read in the code).
- A new status icon's pop still plays during that catch-up on a development build, for 8 pictures, 130 ms: its strict-mode second run comes after the flag has gone off (the pop gone in 1 of 1 runs with strict mode taken out, and which effect does it is reasoned). A production build makes no second run, and a phone is not measured.
- Motion's instant flag is global, so it is set by an empty component right before the list and cleared by another right after, in both the layout and the passive effect pass. Effects run in tree order inside one synchronous pass, so the flag covers the list's effects and no one else's, a chat's rows landing in the same commit included (reasoned from React's order, a test holds it off afterwards). Motion starts exits in layout effects and other value animations in passive ones (read in its source). Layout animations start a frame later, so a row reads its transition at render rather than from that flag. The flag and the row's transition stay instant until the second animation frame after the screen is shown, for the catch-up commit above.
- An instant exit still takes a frame, then a low-priority render, to leave. A card closed under the chat stayed for 2 frames after the chat left and the rows below jumped 108 px, 70 ms after the toast had shown. Such a row hides itself in the commit it starts leaving, so the rows below hold their place from the first frame (measured in Chromium at 4x, one run of each).
- A screen that first mounts under a chat, such as the herd under a chat opened cold from a link, goes to over once that screen has mounted, since it has no slide to wait for, so it follows the herd from its first value (read in the code, not measured).
- The flag for the phases is an atom set in a layout effect rather than a context value, since a context change re-renders every reader on cover, as the chat starts its slide (reasoned, not measured). Elapsed times follow one shared ticker atom, so every label on a page changes in one commit, and stop following it under a chat; the first frame a slide can show already holds the current time, because shown starts with the tap.
- React's hidden `Activity` was ruled out: it hides its tree with `display: none` (read in react-dom's source), and the herd shows under a chat while it slides in and under the back swipe.
- Remounting the list to land what changed was ruled out: the chat returns focus to the card that opened it as it unmounts, and a remount replaces that card. The card stays the same element while the herd moves under it (a test holds it).
- CSS transitions played on what changed under the chat (the status pill's colours, measured), so the scope disables transitions for its descendants while the chat is over and until the second animation frame after: the first frame's callbacks run before that frame computes the new styles (reasoned, not measured). The attribute goes on when the chat has arrived and not at the tap, so a card's press highlight still fades under the arriving chat (reasoned, not measured).
- A layout shift under a resting pushed screen moves nothing anyone sees, and neither does the shift in the first paint after that screen starts to leave, or goes, so the frame tool leaves both out for what sits in the list, and counts a shift on the screen on top as ever: with the list live, a card closed under a chat read 0.0285 there and failed a story with nothing moving on screen. The first frame a pushed screen moves is read ahead of Motion's frame, so a card's top there is a step behind what the frame paints, 108 px on a swipe's first move while the pictures show them in place (measured), and only its title and status are judged. The tool's own check for this is a card's title, status or top changing between two frames while a pushed screen sits off its place, and it fails on the old hold (measured).
- Each card leads with a blobatar of its agent, with the status icon as a badge on its corner, so a card has one status mark rather than two. The blob is seeded from the herdr label, falling back to the pane id, never from the chat title, which changes as the chat goes and would turn the agent into another creature. The user chose that seed and the badge over a blob replacing the icon, one beside it in the title line, one on the place line and a larger one with no badge, each tried at 390 and 320 wide. The blob is inline SVG from the renderer: the package's `<img>` uses a `data:` URI, which the policy's `img-src 'self' blob:` refuses. A kept card greys its blob, as it mutes its words. In dark mode the renderer's own circle is a pale tint that glared on a dark card, and its darkest tones vanished on any dark backdrop, so dark mode draws the blob with no backdrop on the theme's muted circle and keeps the name's tone among the four lighter swatches. blobatar 2.7.0 ignores the `backgroundColor` its docs list, and a `palette` backdrop leaves the body's colour alone, so neither could do this (both measured). Both renders sit in the card, and the theme shows one.
