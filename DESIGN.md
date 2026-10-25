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
- **Every drag picks one axis and keeps it.** Nothing moves until the finger has gone 10px along
  either axis; it then belongs to whichever axis it moved further on, vertical on a tie, until the
  finger lifts. A swipe row moves only on a horizontal lock, and a vertical one is left to the
  page's scroll. Pull to resync moves only on a vertical lock, so a drag that starts on a card at
  the top of the herd drives one of the two, never both. The edge swipe uses the same lock, so a
  vertical drag that starts in its gutter goes nowhere. The sheet's handle drags only vertically
  and nothing else claims it, so it needs no lock.

Measured with pointer sequences in tests, not yet with a thumb: twenty quick scrolls starting on a
card, 15px per 16ms frame, drifting sideways by up to 43° from vertical and ending as the page
takes them, open no row and move no card (before the lock, 18 of the 20 moved the card sideways);
a quick swipe left that has drifted 11px down by the time it has gone 20px still opens the row in
one motion.

Unmeasured knobs, picked rather than measured; settle them on the phone:

- the axis lock waits for 10px of movement, Motion's own direction-lock distance;
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
  - line 1: the title (16/24; 620 when it needs you, 500 otherwise), a muted pin icon when it is
    pinned, and the time since its status changed, in mono 12px on the right;
  - line 2: the status dot and word, a `·`, then `workspace · tab` and the branch in mono 12px.
    On a blocked agent the pending ask's one-line summary takes this slot, in foreground mono
    12px.
  - The time and status word are foreground when the agent needs you, muted otherwise.
  - A title herdr doesn't know falls back to the pane id.
- **Tap** opens the agent's chat, and opening it marks a finished agent seen.
- **Pinned agents sort first** in their machine, ahead of what needs you (`AgentPriority`).
- **Swipe left** reveals Pin (Unpin on a pinned card) and Close, on the swipe row's knobs. Close
  only opens the action sheet; nothing closes without the Hold Button. A refused pin shows the
  hub's sentence beneath its card.
- **Long-press** opens the action sheet, the same on a machine's screen and from the chat's `…`:
  - the agent's title, over `machine · workspace · tab` in mono 12px;
  - **Rename** opens an inline field, "Agent name", with Save. A blank name clears the label, so
    herdr's own title shows again; a name with a tab or a line break is refused in the field;
  - **Pin to top** or **Unpin**;
  - **Hold to close agent**, a Hold Button. A pane crook didn't open says so above it, "crook
    didn't open this pane. Closing it ends whatever runs there, not just Claude.", and the
    button reads "Hold to close anyway".
  - Save reads "Saving…" and the Hold Button "Closing…" until the herd shows the change; then the
    sheet closes by itself. A refusal shows its sentence in the sheet, under the action.
  - Swiping the sheet away while a close is out only hides it: the close still finishes, a close
    from the chat still goes back to the herd, and a close that fails brings the sheet back with
    its sentence. Once a pane has asked for "Hold to close anyway", every retry asks the same.
  - Rename and Close are disabled while the hub can't act or the machine isn't online. Pin needs
    only the hub, which stores it.
- **The order freezes** while a card is swiped open or being dragged. A card that arrives
  meanwhile goes last until the order thaws.
- **An ended agent leaves the herd**, which lists only live agents. When it ends while its sheet
  is open, the sheet closes with a toast: "Pane closed" when its pane went, "Claude exited" when
  the pane is still there. A close from the chat goes back to the herd with "Pane closed"; a
  close from a card needs no toast, since the card leaves.
- **The toast** is a pill in `bg-foreground text-background` above the tab bar. It rises 8px on
  the fade and stays 3s, both picked in the prototype rather than measured; settle them on the
  phone.
- **Pull down** resyncs: it arms at 48px, rests at 40px while syncing and stops at 96px. It is
  off while the hub can't act, since crook is already retrying.
- **Live updates** re-sort each list; a card moves to its new place on the reorder spring.
- **The needs-you badge** on the Agents tab counts the same agents as the sections, and ignores
  offline machines, whose agents are hidden. It is hidden on first load.

## The chat

Tapping an agent pushes its chat, variant Thread: the conversation with one Claude Code agent.
The chat is the only view of an agent. There's no toggle to the raw terminal, and no "show
screen" on the Ask.

- **The header** is the pushed screen's: the back button, the agent's title (display, 20/28,
  620, truncated), and one line under it: the status dot, the status word (blocked reads "needs
  you"), a `·`, then `machine · workspace` in mono 12px. The status word is a polite live
  region, so a screen reader hears the agent move on. On the right:
  - "Catching up", a muted pill with a spinner, while the chat shows a cached transcript and a
    fresher one is still on its way. It hides while the chat is dimmed or the pane no longer
    runs Claude;
  - "2 running", a pill shown while any subagent runs. Tapping it scrolls to the running tree;
  - `…`, which opens the agent's action sheet (The herd), while the agent is live or its machine
    is offline.
- **The transcript** follows the live tail. Scrolled up, a "Latest" pill (`bg-foreground`, 44px)
  shows above the dock and jumps back down.
  - **Show earlier** and **Try again** read "Loading earlier messages" and "Trying again" while
    their request is out, so no refresh is silent.
  - **Your messages** are Message bubbles at 16/24. One sent while Claude works, or behind one
    Claude hasn't taken yet, reads "Queued" from the moment you send it; otherwise one Claude
    hasn't written down yet reads "Sent". Each send keeps its own row until the transcript holds
    it.
  - **Claude's text** is Response markdown at 16/24, with Code Block for fenced code.
  - **Tool calls** are one Tool Call card each, collapsed, titled like the terminal
    (`Read(Herd.ts)`, `Bash(bun run …)`). The whole header is the 44px trigger. Expanded, Edit
    shows Diff View, Write its content in a Code Block, Bash its command in a Code Block and
    then its output, Read its output highlighted for the file, and any other tool its input as
    JSON and then its output.
  - **Images Claude read** (a `Read` of a png) show as thumbnails on the tool card, visible
    without expanding it. Images you pasted show in your bubble.
  - **The plan** (TodoWrite) is a checklist titled "Plan" with "2/5 done" on the right. It
    updates in place.
  - **Subagents** (the `Agent` tool) are a Subagent Tree titled "Subagents", one per turn. Each
    row is 44px: the status dot, the description, a mono line with the agent type and model, the
    running time and a chevron. When the pane closes, a running subagent reads "failed" with
    "Pane closed".
  - **Notes** are centred muted 12px lines: "Interrupted", or an Always grant. "Conversation
    compacted" (with "Show summary") and "Conversation cleared" are dividers across the thread.
    History not loaded yet reads "Earlier messages not loaded (N KB)", and tapping it loads it.
  - **Working** is Thinking State, "Working", timed from the status change. It shows only while
    no tool is running, so there's never a second spinner.
  - The tool call an open Ask is about is hidden, so its diff isn't shown twice.
  - Before anything arrives the thread reads "Loading the conversation", then "No messages yet".
    A pane that isn't running Claude has no transcript: its chat reads "Not a Claude pane" and
    nothing else, with no dock.
- **The dock** sits at the bottom, on `bg-card`, above the home indicator: the Ask over the
  composer. When the keyboard opens, the dock rises above it from the visual viewport. The
  thread gives way first, then the Ask scrolls inside what is left, so neither the composer nor
  the answers sit behind the keyboard.
- **The Ask** opens above the composer while the agent is blocked on a machine that's online.
  It reads "Needs you" in `primary`, then a title: "Edit Herd.ts?", "Write Herd.ts?", "Run this
  command?" or "Use WebFetch?", over the tool's name in mono 12px.
  - Then the command as a Code Block, the edit as a Diff View, or the file a write would create
    as a Code Block, capped at 160px and scrolling.
  - Then 44px buttons in one row: Yes, Always and No, as the dialog offers them. No is always
    there, since Esc declines any dialog. Under them, "Always: " and what Always grants, in the
    dialog's own words.
  - Always leaves a note in the transcript after the call, in the third person: "Commands like
    this one allowed for the rest of the session", or "File edits like this one allowed without
    asking again".
  - An AskUserQuestion with one question and one choice uses Questionnaire: the options,
    "Something else…" and Answer. Something else declines with your text. Several questions, or
    a multi-select one, show read-only with "crook can only pick the answer to one question with
    one choice. Answer this one in the terminal, or tell Claude what to do instead." and Decline.
  - An ask crook can't read is "Claude is waiting on something crook can't read", its screen,
    "Decline it here, or tell Claude what to do instead." and Decline.
  - The tapped button spins until the answer is out, then the Ask reads "Answered. Waiting for
    Claude to move on.", or "Already answered" when it was answered elsewhere first. A refusal
    shows its sentence beneath.
  - Screen readers hear "Needs you" and the title once per ask. An Ask that closes while it
    holds focus hands it to the composer.
- **The composer** is Prompt Input at 16px, reading "Message Claude".
  - Typing `/` lists what the session can run, grouped under This project, Yours, Plugins and
    Claude Code with sticky group headers: the name in mono, its argument hint beside it and a
    two-line description, in a list capped at 256px that scrolls. The Claude Code group holds
    only the built-ins that work over a PTY: `/compact`, `/clear`, `/model`, `/effort`, `/fast`,
    `/rename` and `/cost`. There is no `/` button: the keyboard has the key.
  - Send turns into Stop while the agent works and the field is empty. Stop is Esc.
  - While the Ask is open, the placeholder reads "Or tell Claude what to do instead" and Send
    becomes "Decline and send": sending declines the Ask with your message. Blocked before the
    ask has arrived, it reads "Waiting for Claude's question" and is disabled.
  - While the hub can't act it reads "Sending is paused until crook reconnects".
  - Enter adds a line on a touch keyboard and sends on a hardware one; Ctrl+Enter and Cmd+Enter
    send on either.
  - A message that didn't reach Claude comes back into the field when it's empty.
  - There's no key strip. Stop is the only key the chat sends.
- **Watching an agent** marks it seen, so it doesn't come back as "done, not opened". A subagent's
  screen counts as watching its agent.

When the agent ends or its machine drops, the dock becomes a card in its place:

- **The pane closes, or Claude exits:** an icon, "This pane closed" or "Claude exited", how long
  ago, then "Start Claude here again" and Back. The header status reads "closed" or "exited"
  with a hollow dot. The restart starts Claude in the same folder and replaces the chat in place,
  without a push. It needs the hub to be reachable.
- **The machine drops:** "laptop is offline", with a spinner, "Waiting for it. Last heard from
  5m ago.", and Back. The transcript dims, and the header status reads "laptop offline".
- **The chat never pops on its own.** The transcript stays readable until you leave. A machine
  that comes back with the pane still there resumes silently: the card goes and the composer
  returns. If the pane is gone, it turns into the closed card.
- **A draft survives** the card: the composer stays mounted underneath it.
- **Focus stays in the dock:** when the card replaces a focused composer, focus moves to its
  first button. Screen readers hear the card's title once.
- **A close from the `…` sheet** goes back to the herd with a "Pane closed" toast, and never
  shows the card, because you did it.

A subagent row pushes the subagent's own screen, "Back to" its agent:

- the header shows its description, then its status dot and status, time, type and model in mono;
- "Claude asked" holds the prompt it was given;
- its tool calls render like the main chat's, then Working while it runs, then its result;
- there's no composer, just "Subagents take no messages. Reply to Claude in its chat."

Background subagents keep updating after Claude's turn ends. Sending a message or Stop only ends
the turn.

Tapping a thumbnail opens a full-screen viewer on black: the file name and a 44px close button at
the top, pinch to zoom, double-tap to zoom in or out, swipe down to close. Focus returns to the
thumbnail, with a focus ring only when you closed it from the keyboard.

Motion:

- **New transcript items** land in batches, because Claude writes a message to disk only once it
  has finished, so a long answer arrives whole after seconds of Working. The reveal says so
  rather than faking a stream: the batch staggers in top-down, text before the tool card that
  follows it, each item fading in and rising 8px on `--motion` with `--ease-out`. The stagger is
  50ms, squeezed so the last item starts within `--motion`, so a 40-block answer takes no longer
  than a short one (50ms is an unmeasured knob, like the install screen's).
- **Working morphs into the answer:** it fades out where it stood while the first block fades in
  in its place, without the rise.
- **The thread grows instead of jumping:** while it follows the bottom, it slides up by what the
  batch added, at most one screen, on the `bounce: 0` spring.
- Under reduced motion a batch just appears: no stagger, fade, morph or slide. The history
  already there when you open the chat doesn't animate.
- **The Ask** opens and closes as a height collapse on the `bounce: 0.2` spring.
- **The status word** swaps the way it does on the herd.
- **The viewer** fades in on `--motion` while the picture grows from 0.96.

Unmeasured knobs, picked in the prototype; settle them on the phone:

- the Ask's detail is capped at 160px, and a tool's output at 224px;
- "Latest" shows once you're more than 48px from the bottom;
- thumbnails are 96px tall on a tool card and 160px in a bubble;
- double-tap zooms 2.5x within 300ms, and pinch stops at 4x;
- swipe-down closes past 96px, or at 500px/s over the last 80ms once it has moved 24px;
- the backdrop fades out over 320px of drag.

Decided against:

- **A terminal view**, and "show screen" on the Ask: the chat is the only view.
- **A key strip** (Esc, Ctrl C, arrows, Tab, Enter) above the composer.
- **Subagent rows that expand in place**: the quickest look, but long results stretch the chat.
- **Subagents in a strip and a sheet**: the cleanest chat, but subagents sit one step further
  away.
- **A strip under the header plus a slim dock line** for an ended pane: two places for two
  events.
- **A divider written into the transcript** for an ended pane: quietest, but easy to miss when
  you're scrolled up.
- **Popping back to the herd** when the pane closes: it yanks you out mid-read.

## New agent

`+` on Agents pushes New agent, variant Brief: a screen shaped like the chat. The header reads
"New agent" with "Back to Agents". The dock holds the composer, and the body above it is empty
apart from a summary.

- **The summary** is an Empty State centred in the body: "Claude starts in crook", then the path
  in mono, the machine, and the branch (", on main", or ", in a new worktree on fix-x").
- **The dock**, top to bottom:
  - a scrolling row of chips: machine, folder, branch;
  - the task field, "What should Claude work on?", whose send is "Start Claude";
  - a ghost "Start without a task".
- **Chips** are 44px pills in 14px text, each with an icon and a chevron. The folder chip reads
  "Pick a folder" in `primary` while there's none. A new-worktree branch chip turns `primary`
  and reads "new: fix-x" ("new: name the branch" until it has one). The branch chip shows only
  when the folder is a git checkout.
- **Each chip opens a sheet** of compact rows (44px; the title, then a mono detail when there is
  one). The selected row gets `muted` and a `primary` check, and there are no cards and no
  dividers.
  - Machine: offline machines are disabled and keep their badge.
  - Folder: the machine's folders, most recently used first, each with its branch on the right,
    then "Or type a path" with Use.
  - Branch: "Work in the checkout" or "New worktree" ("Own branch and folder"), which opens a
    branch name field with Done.
- **It defaults to the most recent place:** the folder used last, on an online machine. Picking a
  machine moves to its most recent folder.
- **The task comes first.** The worktree branch is suggested from the task's first line, as a
  lowercase slug, and you can edit it.
- **Starting** reads "Starting Claude…". The chat replaces this screen once the pane is in the
  herd, so Back goes to Agents. Until then it reads "Opening the chat…" with "Open the chat".
- **Empty cases**, each in the summary's place:
  - "No machines yet", "Add one from Machines, then start Claude on it.";
  - "Every machine is offline", "Claude can start once one reconnects.";
  - "laptop is offline", "Pick another machine, or start Claude once it reconnects.";
  - "Pick a folder on laptop", "Claude has not worked anywhere on it yet."
- Enter works as in the chat's composer.
- Kind isn't shown: v1 is Claude only (D8).

## Machines

The Machines tab, variant Roster: one card per machine, a pushed screen per machine, and a sheet
that adds one.

- **A card** is the herd card's surface. The label in display 20/28, then the machine badge and,
  when its crook agent is older than the hub, a warn "update agent" Status Pill. Then "N agents ·
  N need you" ("No agents" with none), then the agent and Herdr versions in mono 12px, leaving out
  a version the hub never heard. A chevron on the right. Tap pushes the machine.
- **An offline card** reads "Swipe to forget, or wait for it to reconnect" in place of its counts,
  and swiping it reveals Forget (D15), on the swipe row's knobs. Forget is disabled while the hub
  can't act and while that machine's forget is in flight. A refused forget shows the hub's
  sentence beneath its card, until the machine's connection or the link's state changes.
- **The list dims** when stale, shows skeleton sections on a first load, and shows "No machines
  yet" with Add a machine when the hub knows none.
- **The machine screen** is pushed, "Back to machines". Its header is the label over the badge and
  the update pill.
  - **Agents · N**: the machine's agents as the herd's cards, in the same order; tap opens the
    chat, and swipe and long-press act on them as on the herd. Offline reads "–" and "Offline,
    so its agents are unknown until it reconnects." None
    reads "No agents running. Start one from Agents." Reconnecting dims them, like the herd.
  - **About** is a flat info list: Online for, Reconnecting for or Last seen (from the hub's last
    connection change), crook agent (a warn pill reading "0.0.9, hub has 0.1.0" when behind),
    Herdr ("unknown" when the hub never heard) and Machine id.
  - **Hold to forget** shows only while the machine is offline, with "It comes back on its own if
    its agent connects again" beneath. It is disabled while the forget is in flight, and reads
    "Forgetting…" once held, since the hub has not answered yet. Once forgotten, the screen goes
    back to the list; a refusal shows beneath the button, until the machine's connection or the
    link's state changes.
  - A machine that leaves the herd while its screen is open, forgotten elsewhere, keeps its label
    as the title and reads "crook doesn't know this machine. A forgotten machine comes back once
    its agent connects again."
- **Add a machine** is a bottom sheet opened by `+` (and by the Empty State on both tabs): three
  numbered steps, each with a Code Block, then "It shows up under Machines as soon as it
  connects."
  1. "On the machine, install the crook plugin for Herdr."
     `herdr plugin install jliocsar/crook/packages/agent/plugin`.
  2. "In Herdr, run the plugin's "Connect to hub" action and give it this hub." The agent endpoint
     on the page's own origin (`wss://<hub>/rpc/agent`), which is what `CROOK_HUB_URL` takes today.
  3. "Paste an exe.dev token for the hub VM, minted with the machine's name as its context."
     `{ "machine": "<name>" }`.
- **A sheet** rises from the bottom on the `bounce: 0` spring over a 40% black backdrop, with a grab
  handle, the title in display 20/28 and a muted description. A tap on the backdrop, Escape or a
  drag down closes it.

Unmeasured knobs, picked in the prototype: a sheet closes when dragged down 96px or flicked at
500px/s, gives 0.05 of the distance dragged up, and is at most 85% of the screen tall.

## Settings

The Settings tab, variant Ledger: one flat page with three sections, each a Section Label over a
rule.

- **Notifications**: Approvals, Questions, Finished and Live Activity, each a row with a label, a
  one-line detail and a switch, `primary` when on. A switch shows what the hub holds: a tap writes
  to the hub, and the switch moves when the hub's settings come back. It stays focusable and ignores
  taps (read-only, `aria-busy`) while its write is in flight, and is disabled only while the hub
  can't act. A refused write shows the hub's sentence under its row. Below the rows:
  - "Saved on the hub, so every device you log in on shares them."
  - a full-width secondary "Send a test", which swaps to "Sending" and then "Sent to your phone";
    a refusal shows its sentence beneath, and the button reads "Send a test" again;
  - "Notifications name the agent and the machine, never what Claude wrote. Hark delivers them,
    so they open nothing in crook."
- **No Hark token**: a muted note under the rule, "Notifications are off", with the hub's own
  sentence for it and "These switches are saved meanwhile, and apply once it has one." The switches
  stay usable; "Send a test" is disabled.
- **Account**: "Logged in as" with the exe.dev email the hub admitted, a full-width destructive "Log
  out", and "Lost this phone? End its session on exe.dev from another device."
- **Log out** asks in a sheet: "Log out of crook?", "Your agents keep running.", a muted line
  saying it ends crook's exe.dev session on this phone only, since exe.dev itself stays signed in
  and "Log in with exe.dev" may bring the user straight back, then Log out and Cancel. Log out reads
  "Logging out" until exe.dev answers, and a refusal stays in the sheet with its sentence until the
  sheet is opened again. Once logged out, the logged-out screen replaces everything, pushed screens and
  sheets included.
- **Hub**: Status (connected, connecting, syncing, unreachable or offline, as a plain Status Pill
  that follows the banner), Address (the host the page came from, which is the hub's) and Version
  (the hub's).
- **First load**: each switch row is a Skeleton of its label, detail and switch, and the email is a
  Skeleton bar; a gray pill alone read as a switch that was off. Opened again, Settings shows what
  it last had at once and updates in place.
- **Stale**: the switches dim with the rest of the stale content and are disabled with the other
  hub actions, and so is the test.
- **Decided against**: quiet hours or pause (iOS Focus covers it), per-machine or per-agent
  overrides, a confirm before approving from the lock screen, and a theme setting.

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
- **Decided against**: a floating capsule by the tab bar (one more floating thing, and it
  covered the end of the list), a quiet line under the title (too easy to miss when actions are
  disabled), and a "Retry now" button (crook already retries on its own).
- **Logged out, or the session expired:** one full screen with "Log in with exe.dev". After Log out
  in Settings it reads "You're logged out" and "Your agents are still running. Log in to see them
  again." Otherwise it reads "Your session expired" and "Your agents kept running. Log in again to
  see them.": the phone can't tell an expiry from a logout made on another device, since the proxy
  answers both with the same redirect to its login.

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
- **Approvals** are Hark approval prompts on a normal notification, never on the Live Activity,
  so the herd card keeps the device's one slot. The prompt names the tool only, never the command,
  uses Hark's longest expiry (a day), and is cancelled as soon as the agent stops waiting on that
  ask. Seeing the agent in crook does not cancel it: it is an action, not an alert. Approve
  answers the dialog Yes, and Deny declines it.
- **Questions** can't be answered from Hark, so they're plain notifications.
- **Every other notification is withdrawn** once you've seen the agent in crook or its state
  moved on. Tapping one opens nothing (no `url`), per D16.
- **The Live Activity starts** when the herd goes from idle to busy, because a start makes a
  sound, and never within a minute of the last start (Hark warns iOS drops faster ones). It
  updates on each change of its text, ends on "All done" and lingers 45s (Hark's own example of
  a short linger), and is restarted with its fixed key before Hark's 8h cap.

Unmeasured knobs: the wordmark is 26% of the icon's width with `-0.03em` tracking, the splash mark
is 30% of the screen's width, and the install screen staggers its pieces by 50ms.

Decided against:

- **Other icons**: a shepherd's crook in cream on tomato, and a cluster of status dots on the
  dark ground.
- **A custom notification avatar**: Hark's `imageUrl` must be a public HTTPS URL, and the hub is
  private.
- **Approvals on the Live Activity**: they would take the herd card's slot.
- **Filing notifications under the machine label**: one `crook` project keeps them together, and
  the body already names the machine.

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

**The permission Ask has no Mischief component** (SPEC §5.3), and Questionnaire covers only
AskUserQuestion. The chat's Ask composes it from a Section Label, Code Block or Diff View, and
Buttons (The chat).

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

### In crook's copies

These were bugs or misses in the components as shipped:

- **Prompt Input:** Send and Stop are each their own keyed element, so Send can't turn into Stop
  under your finger, and neither takes focus away from the field.
- **Tool Call:** the whole header is the 44px trigger.
- **Subagent Tree:** its rows are tappable 44px rows with a mono meta line.
- **Motion quirk:** under `AnimatePresence initial={false}`, a child mounted later skips its
  entrance. Each list that animates needs its own `AnimatePresence`.

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

- The machine sections follow the hub's machine order; no order has been decided.
