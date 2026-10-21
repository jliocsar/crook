# crook design system

crook's PWA uses Mischief UI as much as possible, everywhere: the herd, the chat, new agent and
settings. It's styled mobile-first, and nothing imitates iOS (no large titles, no grouped Settings
lists). The theme is Mischief's own: white paper, dark ink and a tomato accent.

Mischief components inherit the host app's shadcn tokens. So in practice the design system is
those tokens plus Mischief's components as they ship. Where crook departs from the source, it's
listed under "crook overrides".

Sources:

- Mischief UI: <https://ui.tinkererslabs.com> (MIT). Source:
  <https://github.com/Tinkerers-Labs/mischief-ui>, read at commit `92c335b`.
  - Token values come from its `app/globals.css`.
  - Component classes come from `registry/default/<name>/<name>.tsx`.
  - Motion, voice and the heading weights come from its `DESIGN.md`.
  - That file also describes its website's own type sizes and radii. Those aren't used here.
- Tailwind CSS 4.3.3's `theme.css`, for anything Mischief leaves at Tailwind's defaults: the
  text size and line-height pairs.
- Paper file **crook**: <https://app.paper.design/file/01M57T3SYXHGVFX2BABZWNGMXW>.
  - The Foundations page holds the color, type and shape artboards.
  - The Components page holds one artboard per component.
- `SPEC.md`: §5.3 for the screens, §8.1 for the PWA stack.

## Tokens

In code, the variables are shadcn's: `--background`, `--primary` and so on. Mischief's
`globals.css` maps them into Tailwind with `@theme inline`. Tailwind then inlines them, so
`bg-primary/50` compiles to `color-mix(in oklab, var(--primary) 50%, transparent)`, and
`--color-primary` never exists at runtime.

Paper names the same tokens with Tailwind's theme keys (`--color-primary`). It holds the light
values.

### Light and dark follow the system

crook ships both themes and picks one from the system's setting. There's no in-app toggle, and
Mischief's Theme Toggle isn't used.

Mischief's site switches with a `.dark` class. crook switches with the media query instead:

```css
@custom-variant dark (@media (prefers-color-scheme: dark));

:root {
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    /* the Dark column below */
  }
}
```

The page carries two `theme-color` metas, one per `media="(prefers-color-scheme: …)"`, with the
`background` value of each theme. That way the iOS status bar matches whichever theme is showing.

Every screen is designed and checked in both themes.

### Color

| Variable                 | Light                                    | Dark                        | Role                         |
| ------------------------ | ---------------------------------------- | --------------------------- | ---------------------------- |
| `background`             | `oklch(1 0 0)`                           | `oklch(0.17 0.012 58)`      | Page ground                  |
| `foreground`             | `oklch(0.215 0.018 58)`                  | `oklch(0.94 0.01 84)`       | Primary text, strong borders |
| `card`                   | `oklch(1 0 0)`                           | `oklch(0.215 0.014 58)`     | Raised rows, sheets          |
| `card-foreground`        | `oklch(0.215 0.018 58)`                  | `oklch(0.94 0.01 84)`       |                              |
| `popover`                | `oklch(1 0 0)`                           | `oklch(0.215 0.014 58)`     | Menus, popovers              |
| `popover-foreground`     | `oklch(0.215 0.018 58)`                  | `oklch(0.94 0.01 84)`       |                              |
| `primary`                | `oklch(0.675 0.205 32)`                  | `oklch(0.72 0.185 32)`      | Tomato: links, active, focus |
| `primary-foreground`     | `oklch(0.99 0.005 84)`                   | `oklch(0.16 0.012 58)`      |                              |
| `secondary`              | `oklch(0.955 0.012 80)`                  | `oklch(0.27 0.018 58)`      | Secondary buttons            |
| `secondary-foreground`   | `oklch(0.27 0.02 58)`                    | `oklch(0.92 0.01 84)`       |                              |
| `muted`                  | `oklch(0.958 0.009 82)`                  | `oklch(0.25 0.014 58)`      | Quiet fills, code wells      |
| `muted-foreground`       | `oklch(0.48 0.025 58)`                   | `oklch(0.72 0.016 76)`      | Supporting text, meta        |
| `accent`                 | `oklch(0.78 0.16 128)`                   | `oklch(0.72 0.14 128)`      | Leaf: small success details  |
| `accent-foreground`      | `oklch(0.24 0.04 128)`                   | `oklch(0.17 0.035 128)`     |                              |
| `destructive`            | `oklch(0.58 0.22 28)`                    | `oklch(0.68 0.2 28)`        | Kill, deny, errors           |
| `destructive-foreground` | `oklch(0.985 0.01 84)`                   | `oklch(0.17 0.02 28)`       |                              |
| `warning`                | `destructive` 55% into `accent` in OKLab | the same mix                | Blocked, reconnecting        |
| `border`                 | `oklch(0.215 0.018 58 / 16%)`            | `oklch(0.94 0.01 84 / 15%)` | Rules, quiet borders         |
| `input`                  | `oklch(0.215 0.018 58 / 20%)`            | `oklch(0.94 0.01 84 / 20%)` | Field borders                |
| `ring`                   | `oklch(0.675 0.205 32)`                  | `oklch(0.72 0.185 32)`      | Focus ring                   |

Borders use alpha colors, so they work in both themes.

### Agent status

crook's agent statuses reuse Mischief's own dots. The copied Status Pill has seven tones: `ok`,
`warn`, `blocked`, `down`, `idle`, `working` and `unknown`. Mischief's pill ships the four of them
that are not agent-specific; `working` and `unknown` take Subagent Tree's `running` and `queued`
dots, and `blocked` is `warn` with a halo.

| Status    | Dot                                         | Source                |
| --------- | ------------------------------------------- | --------------------- |
| `idle`    | `bg-muted-foreground`                       | Status Pill `idle`    |
| `working` | `bg-primary animate-pulse`                  | Status Pill `working` |
| `blocked` | `bg-warning ring-2 ring-warning/35`         | Status Pill `blocked` |
| `done`    | `bg-accent`                                 | Status Pill `ok`      |
| `unknown` | `border border-muted-foreground/40`, hollow | Status Pill `unknown` |

Notes on the mapping:

- **`down` (`bg-destructive`) marks failures, not an agent status.** The hub is unreachable, or a
  tool failed.
- **The words always carry the state**, so color never works alone.
- **A done agent is green, a done subagent stays grey.** Subagent Tree's `done` is
  `bg-muted-foreground/40`. The decision: green is for an agent the user should look at, while a
  finished subagent is history inside it.
- **`blocked` wears a halo.** Working and blocked differ by hue alone: ΔE OK 0.112 in light and
  0.096 in dark, and 0.012 and 0.021 under simulated deuteranopia (Machado 2009). The ring is the
  cue that survives color blindness. Its 2px width and 35% are unmeasured picks. A box that clips,
  like `truncate`, needs 2px of room on each side of a blocked dot or the ring is cut.
- **The three extra tones live in the copied Status Pill's dot map,** because crook owns the copied
  source (SPEC §8.1). Its `warn` uses `bg-warning`.
- **The dot sits on the text's x-height,** not its line box: an inline dot with
  `vertical-align: middle`, in Status Pill and beside an agent's status word alike.
- **The working pulse is CSS** (`animate-pulse`, with `motion-reduce:animate-none`) on the inner
  dot. A status change swaps the dot through `AnimatePresence`: the new one pops in on the bouncy
  spring, the old one fades out. A Motion keyframe pulse never started on a dot that was already
  working at first render, because `AnimatePresence initial={false}` skips the mount animation.

### Type

| Family              | Variable         | Use                                      |
| ------------------- | ---------------- | ---------------------------------------- |
| Bricolage Grotesque | `--font-display` | Screen titles, headings with personality |
| Schibsted Grotesk   | `--font-sans`    | Everything you read, and controls        |
| Geist Mono          | `--font-mono`    | Code, commands, ids, durations           |

**Weights are Mischief's: semibold 620, bold 650.** These are the heading weights from Mischief's
website type scale. Mischief's `globals.css` leaves Tailwind's defaults (600 and 700) in place.
crook overrides `--font-weight-semibold` and `--font-weight-bold` in its own theme, so every
installed component renders `font-semibold` at 620 and `font-bold` at 650. `font-medium` stays at
500 and body text at 400. Mischief's website body weights (450 and 480) aren't adopted.

Bricolage Grotesque and Schibsted Grotesk are variable fonts, so 620 and 650 render as written.
Paper reports a `wght` axis of 200 to 800 for Bricolage and 400 to 900 for Schibsted. For Geist
Mono, Paper lists only static weights, so mono text set in Paper may snap to the nearest one.

**Sizes and line heights are Tailwind's `text-*` pairs, because the components are set in them.**
Mischief's website ratios (1.6, 1.5, 1.2) aren't used. H1 is the exception, explained below.

| Role       | Family  | Size / line height | Weight | Tracking   | Source                                                 |
| ---------- | ------- | ------------------ | ------ | ---------- | ------------------------------------------------------ |
| H1         | display | 40 / 40 px         | 650    | `-0.04em`  | Floor of Mischief's H1 clamp; 0.98 rounded to whole px |
| Title      | display | 24 / 32 px         | 650    | `-0.025em` | `text-2xl`; tracking borrowed from Mischief's H2       |
| H3         | display | 20 / 28 px         | 620    | `-0.015em` | `text-xl`; Mischief H3 tracking                        |
| Body       | sans    | 16 / 24 px         | 400    | `-0.005em` | `text-base`; Mischief body tracking                    |
| Small      | sans    | 14 / 20 px         | 400    | `0`        | `text-sm`                                              |
| Label      | sans    | 12 / 16 px, caps   | 650    | `0.08em`   | `text-xs`; Mischief label tracking                     |
| Mono       | mono    | 14 / 20 px         | 400    | `0`        | `text-sm`                                              |
| Mono small | mono    | 12 / 16 px         | 400    | `0`        | `text-xs`                                              |

A phone sits at the lower bound of Mischief's H1 clamp, `clamp(2.5rem, 5vw, 4.5rem)`, so H1 uses
that floor: 40px. Mischief's 0.98 line height would give 39.2px, which is rounded to 40px to avoid a
subpixel line.

### Shape and space

- **Spacing:** a 4px base, Tailwind's `--spacing: 0.25rem`.
  - The phone gutter is 16px, so a 375px screen leaves 343px of content.
- **Radius:** `--radius: 0.75rem`, so `sm` 8px, `md` 10px, `lg` 12px and `xl` 16px. This follows
  `globals.css`; Mischief's `DESIGN.md` lists different radii, and those are its website's.
  - Pills are `full`.
  - Several components derive their own radius from `--radius`, for example code wells use
    `calc(var(--radius) + 0.15rem)`. Keep those as shipped.
  - Nested radii stay concentric.
- **Breakpoints:** Tailwind's defaults. Design and test at 375px first, Mischief's smallest test
  width.

### Motion

Mischief's rules, except where crook overrides them below.

Timing:

- 120 to 180ms for hover and press feedback.
- 180 to 240ms for small state changes.
- 300ms at most for anything the user started.

Easing:

- Springs for pointer-driven, interruptible movement.
- Ease-out for entrances and for exits.
- A full `transform` string, not Motion's `x`, `y` or `scale` keys, unless a drag or a `layout`
  animation owns the transform. The animate skill says those keys drop frames under load.
- `MotionConfig reducedMotion="user"` only skips positional keys (the box and Motion's named
  transform keys), so each `transform` string checks `useReducedMotion` itself (measured in
  `motion-dom` 14.3.0).

Restraint:

- Never animate keyboard navigation.
- Never animate every element at once.
- Keep deformation between 0.96 and 1.04.
- Respect `prefers-reduced-motion`.

crook's motion, through Motion (`motion/react`):

- **Two springs.** Reorders, collapses and the status-dot pop use
  `{ type: 'spring', duration: 0.5, bounce: 0.2 }`, from the animate skill's table. Swipes, screen
  pushes and sheets use the same spring with `bounce: 0`, because a bounce of 0.2 measured a 5px
  overshoot on a push.
- **Tweens read Mischief's tokens** from the stylesheet: `--motion-fast` (120ms) and `--motion`
  (180ms) with `--ease-out`. That covers word swaps, fades and the press highlight. The tokens
  stay in CSS only, and code reads them once at runtime, so there is one source.
- **The press highlight** comes in instantly and fades out on release.
- **Nothing animates on first load.** The landing screen is opened many times a day, and the shell
  doesn't slide its first screen in.
- **Drags and `layout` animations keep Motion's named keys,** which they own. Under reduced motion
  their imperative `animate()` calls jump to the end instead.

## Navigation

- **Three tabs:** Agents, Machines, Settings. Agents (the herd) is home; there's no separate
  dashboard, because the herd already puts what needs you first.
- **The tab bar shows on the three root lists only.** Pushed screens (a chat, a machine) cover it,
  so the chat's dock stays clear.
  - Icons are 20px over a 12px label, in a 56px row plus the bottom safe area.
  - The active tab is `primary`.
  - Agents carries a small `primary` count of the agents that need you. The count is hidden from
    screen readers, which hear ", N need you" instead.
  - Switching tabs replaces the history entry, so Back never walks through tabs.
- **Root lists have a sticky header:** the title in display 24/32, with at most one action on the
  right. Agents has `+` (New agent); Machines has `+` (Add a machine); Settings has none.
- **Pushed screens** slide in from the right on the `bounce: 0` spring and cover the root list
  beneath, which stays mounted and inert. An edge swipe from the left goes back. The edge gutter
  sits under the header, so the back button keeps its whole 44px.
  - The header's back button names where it goes ("Back to laptop" when a chat was opened from
    that machine).
  - The new screen's title takes focus once it has arrived, and Back returns focus to whatever
    opened it, or to the active tab when that's gone. The opener is the element that was tapped,
    not the focused one: a WebKit tap doesn't focus a button.
  - Back slides the screen out, then pops the history entry. With no entry to pop (the screen was
    opened from a link), it replaces the URL with its parent.
  - The same kind of screen opened with other content (a chat from a chat) is a new screen, with
    its own slide, focus and opener. It takes the place of the screen it was opened from, so the
    root list shows beneath it during the slide, both ways.
  - Only a push slides in. A screen that Back rebuilds, or one that replaces the current screen
    (a restarted chat), appears in place.
  - Back tapped while a push is still loading cancels that push at once, and the screen it was
    tapped on stays.
  - Tapping the same row twice opens one screen.
  - Grabbing the edge while a screen slides in stops it under the finger, and its title takes
    focus then.
  - The browser's own back is instant: the slide belongs to the in-app gesture and button.
- **Lists are flat:** full-bleed rows with no dividers between them. The only rule is the one
  under a section label.
- **Swipe rows:** swiping a card left reveals its actions; only one card is open at a time, and
  tapping another card closes the open one and does nothing else. Long-press opens the card's
  action sheet. Swiping right isn't used.

Unmeasured knobs, picked rather than measured; settle them on the phone:

- the edge swipe starts in a 16px gutter and commits past a third of the screen, or at 500px/s;
- a swipe row opens past half its actions' width, or at 500px/s;
- the actions are 64px wide with 8px gaps;
- a swipe row's drag gives 0.15 of the distance past fully open and 0.05 past closed;
- long-press is 500ms, with 8px of movement allowed.

## The herd

The Agents tab: every agent on every machine, one section per machine.

- **The header** is the root list's sticky header: `crook` and `+` (New agent). `+` is disabled
  while the hub can't act, and stays tappable when every machine is offline.
- **No separate "Needs you" section.** Each machine's agents are in `AgentPriority` order
  (ARCHITECTURE §2.6), so what needs you sits at the top of its machine.
- **A machine section** is a heading button that collapses it: the label (display, 20/28, 620),
  the machine badge, "N need you" on the right when there are any, and a chevron. Collapsing is
  UI state and isn't kept across launches.
  - An offline machine shows one sentence instead of its agents: "Last seen 2h ago. Its agents
    come back when it reconnects."
  - A reconnecting machine's agents dim to 60%.
- **The machine badge** is a plain Status Pill: online is `ok`, reconnecting is `warn` with a
  spinner, and offline is `idle`, reading "offline · 2h ago".
- **Each agent is its own card** (`bg-card`, border, `rounded-xl`, 8px apart), 72px tall
  (measured against the real herd):
  - line 1: the title (16/24; 620 when it needs you, 500 otherwise) and the time since its
    status changed, in mono 12px on the right;
  - line 2: the status dot and word, a `·`, then `workspace · tab` and the branch in mono 12px.
    The pending ask takes this slot on a blocked agent once the hub carries it (JC-105).
  - The time and status word are foreground when the agent needs you, muted otherwise.
  - A title herdr doesn't know falls back to the pane id.
- **Tap** opens the agent's chat, and opening it marks a finished agent seen.
- **Pull down** resyncs: it arms at 48px, rests at 40px while syncing and stops at 96px. It is
  off while the hub can't act, since crook is already retrying.
- **Live updates** re-sort each list; a card moves to its new place on the reorder spring.
- **The needs-you badge** on the Agents tab counts the same agents as the sections, and ignores

## Machines

The Machines tab, variant Roster: one card per machine, a pushed screen per machine, and a sheet
that adds one.

- **A card** is the herd card's surface. The label in display 20/28, then the machine badge and,
  when its crook agent is older than the hub, a warn "update agent" Status Pill. Then "N agents ·
  N need you" ("No agents" with none), then the agent and Herdr versions in mono 12px, leaving out
  a version the hub never heard. A chevron on the right. Tap pushes the machine.
- **An offline card** reads "Swipe to forget, or wait for it to reconnect" in place of its counts,
  and swiping it reveals Forget (D15), on the swipe row's knobs. Forget is disabled while the hub
  can't act. A refused forget shows the hub's sentence above the list.
- **The list dims** when stale, shows skeleton sections on a first load, and shows "No machines
  yet" with Add a machine when the hub knows none.
- **The machine screen** is pushed, "Back to machines". Its header is the label over the badge and
  the update pill.
  - **Agents · N**: the machine's agents as the herd's cards, in the same order; tap opens the
    chat. Offline reads "–" and "Offline, so its agents are unknown until it reconnects." None
    reads "No agents running. Start one from Agents." Reconnecting dims them, like the herd.
  - **About** is a flat info list: Online for, Reconnecting for or Last seen (from the hub's last
    connection change), crook agent (a warn pill reading "0.0.9, hub has 0.1.0" when behind),
    Herdr ("unknown" when the hub never heard) and Machine id.
  - **Hold to forget** shows only while the machine is offline, with "It comes back on its own if
    its agent connects again" beneath. Once forgotten, the screen goes back to the list; a refusal
    shows beneath the button.
- **Add a machine** is a bottom sheet opened by `+` (and by the Empty State on both tabs): three
  numbered steps, each with a Code Block, then "It shows up under Machines as soon as it
  connects."
  1. "On the machine, install the crook plugin for Herdr." `herdr plugin install jliocsar/crook`.
     Provisional: the plugin is JC-113's, not built yet.
  2. "In Herdr, run the plugin's "Connect to hub" action and give it this hub." The agent endpoint
     on the page's own origin (`wss://<hub>/rpc/agent`), which is what `CROOK_HUB_URL` takes today.
  3. "Paste an exe.dev token for the hub VM, minted with the machine's name as its context."
     `{ "machine": "<name>" }`.
- **A sheet** rises from the bottom on the `bounce: 0` spring over a 40% black backdrop, with a grab
  handle, the title in display 20/28 and a muted description. A tap on the backdrop, Escape or a
  drag down closes it.

Unmeasured knobs, picked in the prototype: a sheet closes when dragged down 96px or flicked at
500px/s, gives 0.05 of the distance dragged up, and is at most 85% of the screen tall.

## Connection states

- **The banner** is a 32px strip at the top of every header, tab screens and pushed screens alike,
  with an icon and one line. The failure states add the time since the last update, in mono, on
  the right ("Updated just now" under a minute).
  - Hub unreachable: "Can't reach the hub · retrying", on the destructive tint.
  - No network: "You're offline", inverted.
  - "Syncing" and "Connecting to the hub", with a spinner, on muted.
  - "Back online" on accent for 1.5s after a failure, then the strip collapses.
- **Stale content dims to 60%.** Headers and the back button stay at full strength.
- **Hub actions are disabled** while the hub can't act, and nothing is queued: an action never
  fires after a reconnect. Back, tabs, scrolling and opening chats keep working.
- **A quick resync is silent.** "Syncing", the dim and the disabled actions show only after 1s,
  Nielsen's limit for a delay that keeps the user's flow of thought. Inside that second a hub call
  is still refused, never queued; nothing on the herd screen makes one. After a failure, "Syncing"
  shows at once, so "Back online" never appears before the data is fresh.
- **A cold start dims the cached herd at once,** since it may be days old, and disables the
  actions with it. Only the banner waits the second.
- **Machines keep their last-known status** while the hub is down. The hub, not the phone,
  decides that a machine is offline.
- **Offline and hub unreachable read differently,** because their fixes differ.
- **Screen readers** hear each state once, from a single status region.
- **First load** with no cached herd shows skeleton sections (three cards, then two) at the
  card's real height.
- **Logged out, or the session expired:** one full screen with "Log in with exe.dev": "Your
  session expired" and "Your agents kept running. Log in again to see them." The phone can't tell
  the two apart, since the proxy answers both with the same redirect to its login.

## Empty states

- **No agents, machines online:** "Nothing running" at the top of the herd, with a New agent
  button. The machine headers stay below it.
- **No machines:** "No machines yet" with Add a machine, the same Empty State and sheet as the
  Machines tab.
- **Every machine offline:** a muted "All machines are offline" line at the top, and each machine
  keeps its "Last seen" line. The red banner stays reserved for the hub.
- **A machine with no agents** next to busy ones: a muted "No agents" line under its header.

Unmeasured knobs, picked in the prototype; settle them on the phone: the 1.5s "Back online", the
32px strip, the pull distances and its 0.5 resistance, the skeleton's three and two cards, and the
11px and 14px spinners.

## Outside the app

- **The icon** is the lowercase wordmark "crook" in Bricolage Grotesque at 650, dark ink
  (`#201711`, the light theme's foreground) on cream (`#FDFCF8`, the light theme's
  primary-foreground). It's a full-bleed square; iOS rounds the corners. The wordmark is outlined
  to a path from the font before any PNG is exported, so no image depends on a font loading.
- **The splash** is the wordmark alone, in the theme's foreground on its background, centred. Each
  iPhone size gets a light and a dark startup image, picked by `prefers-color-scheme`.
- **The install screen** shows in a browser tab only, on an iPhone or iPad, in Safari or Chrome:
  - the icon, "Add crook to your Home Screen", then "crook runs from your Home Screen, like an
    app. Logins are kept per app, so log in once it's there.";
  - numbered steps for the browser you're in. Safari: "Tap Share in the toolbar" (with "Can't
    see it? Tap ⋯ first."), "Choose Add to Home Screen". Chrome: "Tap Share in the address
    bar", then the same. Both end with "Open crook from your Home Screen";
  - a quiet "Continue in browser" at the bottom, which lasts for the browser session.
  - Other iOS browsers and every desktop browser go straight to the app: crook has no steps
    to show them.
- **The manifest**: `name` and `short_name` are `crook`, `display` is `standalone`, the
  background and theme colours are the light background, and the orientation isn't locked.
  It's fetched with credentials, because the exe.dev proxy guards every path.
- **Notifications**: the title is the agent's title, so each agent threads on its own. The body
  is a verb and where it runs: "Wants to run Bash · laptop / crook", "Has a question · desk /
  notes", "Finished · laptop / crook". All go into a `crook` project in Hark's inbox.
- **The Live Activity**: the title is "crook". The status is the herd in one line: "1 needs
  you · 2 working", "3 working", "All done". The detail is the agent that has waited longest
  ("Prototype the herd screen wants Bash · laptop"), or the latest working one. The symbol is
  `warning`, `terminal` or `success`, with no progress bar. The accent is the dark theme's
  foreground (`#EEEBE4`).

Unmeasured knobs: the wordmark is 26% of the icon's width with `-0.03em` tracking, the splash mark
is 30% of the screen's width, and the install screen staggers its pieces by 50ms.

## Components

This is the list in SPEC §8.1, plus Spinner, with what each component is for in crook.

| Component       | crook use                                                   |
| --------------- | ----------------------------------------------------------- |
| Status Pill     | Agent status; machine badge (online, offline, reconnecting) |
| Message         | One transcript turn                                         |
| Response        | Assistant markdown                                          |
| Conversation    | The transcript scroller, following the live tail            |
| Prompt Input    | The composer                                                |
| Thinking State  | Agent working, with elapsed time                            |
| Tool Call       | Bash, Edit and Read calls, collapsed by default             |
| Questionnaire   | AskUserQuestion, on a blocked agent                         |
| Code Block      | Snippets and commands                                       |
| Diff View       | Edit and Write tool inputs                                  |
| Agent Checklist | TodoWrite                                                   |
| Subagent Tree   | Agent tool subagents                                        |
| Hold Button     | Destructive confirms, such as closing an agent              |
| Empty State     | Nothing needs you; no machines yet                          |
| Skeleton        | First load with no cached snapshot                          |
| Spinner         | Reconnecting, refreshing                                    |
| Kbd             | Hardware-keyboard hints (iPad, desktop browser)             |
| Side Panel      | Agent detail                                                |
| Command Palette | Jump to an agent                                            |

Some loading states don't use Skeleton. A cached snapshot paints dimmed, with "syncing" on it (SPEC
§5.3).

Mischief ships no Button; each component styles its own. crook's standalone button is shadcn's
`base-nova` Button, the style Mischief's `components.json` declares.

**There's a gap: the permission Ask card** (SPEC §5.3). It shows a header, the command or diff, and
the buttons Yes, Yes always and No. Mischief has no component for it, and Questionnaire covers only
AskUserQuestion. It gets composed from a card surface, Code Block or Diff View, and Buttons.

## crook overrides

These are deliberate departures from the shipped source, because crook is phone-first.

### Touch targets: 44px to hit, 24px to see

Every control's hit area is at least 44 by 44px (Apple's HIG). What a control shows can be smaller:

- **Primary actions show at 44px:** buttons, send and stop, the Ask's choices and its Back, Skip
  and Next, list rows and the tab bar.
- **Compact controls may show as small as 24px**, the minimum in WCAG 2.2's 2.5.8 (AA), when an
  invisible hit area takes them to 44px. That covers switches, chips and inline icon buttons.
- **Hit areas never overlap.** Space compact controls at least 44px apart, centre to centre, or
  show them larger.

Compact controls get their hit area from crook's `hit-area` utility.

Mischief's `DESIGN.md` asks for 44px touch targets and says mobile actions stay 44px tall. Its
shipped controls fall short of that:

| Control                             | Shipped                 |
| ----------------------------------- | ----------------------- |
| Button (base-nova, largest is `lg`) | 32px default, 36px `lg` |
| Prompt Input send and stop          | 36px                    |
| Questionnaire Back, Skip and Next   | 36px                    |
| Questionnaire choice rows           | about 38px              |
| Diff View Accept and Reject         | 32px                    |
| Code Block wrap and copy            | 32px                    |
| Code Block "Show N more lines"      | about 33px              |
| Conversation jump-to-latest         | 36px                    |
| Side Panel close                    | 32px                    |

All of them get 44px hit areas. The primary ones also show at 44px, and Button needs a size of
crook's own for that, because base-nova doesn't have one that large: `touch` (44px tall) and
`icon-touch` (44px square).

### Text fields at 16px

These fields ship under 16px:

- Prompt Input's field and Questionnaire's freeform field, at `text-sm` (14px).
- Command Palette's search, at `text-[0.95rem]` (15.2px).

iOS Safari zooms the page when a field under 16px takes focus. That's known iOS behavior, but it
hasn't been checked on the user's phone yet. Raise all three to `text-base`.

### Exits ease out

Mischief's `DESIGN.md` says ease-in for exits. crook eases out both ways, because ease-in starts
slow and delays the moment the user is watching (the animate skill, from Emil Kowalski's rules).

### Phone behavior we get for free

The source already does these on a phone:

- Message actions are always visible: `[@media(hover:none)]:opacity-100`.
- Terminal Output hides its `cwd` below `sm`.
- Side Panel is `w-screen` below `md`.
- Diff View defaults to unified, which is the view that fits 343px.

## Voice

Mischief's voice rules, applied to crook's copy:

- Short, direct sentences.
- Say what a control does.
- Use real interface examples.
- No hype.
- No em dashes.

Use real crook content: agent titles, branches, machines, real tool calls. Never lorem ipsum.

## Paper

Paper (<https://paper.design>) is where the screens and flows get designed before any web code.
Agents read and write it through its MCP server, the `paper-desktop@paper` Claude Code plugin.

- **Tokens:** Paper's tokens are CSS variables with the `--color-*` names. Designs reference them
  as `var(--color-primary)`, so a token change reaches every design.
- **No theme modes yet.** Paper holds the light values. Every screen ships in both themes, so check
  each one in dark too: swap the color tokens to the Dark column above, screenshot, then swap them
  back.
- **Paper's weight tokens are out of date.** They still say 600 and 700. Updating them to 620 and
  650 was blocked by the MCP cap. Change them in the Theme tab by hand, or once the cap resets.
- **No components or instances yet.** The Components page is a sheet of copies.
  - Reuse a part with `<x-paper-clone node-id="…">`, which makes an unlinked copy.
  - Editing the sheet doesn't update earlier clones.
- **HTML paste keeps inline styles only.** Class names are dropped. So every sheet part is
  Mischief's Tailwind classes translated into inline styles over the tokens. Its layer names follow
  the source structure (`StatusPill/working`), so it can be traced back.
- **Font tokens are bare family names** (`Bricolage Grotesque`). With quotes and a fallback, Paper
  silently renders another font.
- **No rich text.** A block whose children are all inline flattens into one text node.
- **The free plan caps MCP use per week.** Building the foundations and the first ten and a half
  component artboards used up a week. Pasting HTML by hand with ⌘V doesn't go through MCP.
- **Going back to code:** read the frames with `get_jsx` and `get_computed_styles`, then build them
  with the real Mischief components. Never rebuild from the inline styles or from screenshots.

## Open

- The screens decided in `TEMP_DESIGN_EXPLORATION.md` (chat, New agent, Settings) move
  here with the ticket that builds each one.
- The herd's swipe actions, long-press sheet, pins, the order freeze while a card is open, and the
  "Pane closed" toast arrive with JC-112.
- The machine sections follow the hub's machine order; no order has been decided.
