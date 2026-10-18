# Temporary design exploration

This is a working note while the PWA's screens get prototyped. It isn't the design system;
`DESIGN.md` is. A decision here moves into `DESIGN.md` (and SPEC §8.1 when it's a stack choice)
once web implementation starts. Then this file goes.

The web halt still stands: nothing here starts JC-92.

## Herd screen: decided, variant "Reveal"

The landing screen is the herd: every agent on every machine.

### Prototype

- Source: `/home/jliocsar/Projects/crook/tmp/prototypes/herd`. `tmp/` is gitignored, so this only
  exists on the laptop.
- Run it with `bun run dev` from that directory. It listens on the tailscale IP only, at
  <http://cyborg-15-a13v:5180/?v=1>. Reveal is `v=1`.
- Reveal is `SwipeScreen` with no flags, in `src/herd/swipe.tsx`. The variant file is
  `src/variants/Reveal.tsx`.
- Screenshots: `/home/jliocsar/Projects/crook/tmp/prototypes/shots/s1-light.png`,
  `s1-dark.png` and `s1-swiped.png`.
- Fake data and the live simulator: `src/herd/data.ts`.

### Layout

- **No separate "Needs you" section.** Each machine's list is sorted by priority, so what needs you
  sits at the top of its machine:
  1. pinned agents;
  2. blocked, the longest-waiting first;
  3. done but not opened, the newest first;
  4. working;
  5. idle, and done that's been opened;
  6. unknown.
- **No sticky header.** A plain header scrolls away. It shows the `crook` wordmark (display, 24/32,
  650), the hub status, and a one-line summary such as "2 blocked · 1 finished · 3 working".
- **Machine sections** have:
  - the label (display, 20/28, 620);
  - a plain Status Pill for the machine (online, reconnecting with a spinner, or "offline · 2h
    ago");
  - "N need you" on the right, or nothing;
  - a chevron to collapse the section.
    An offline machine shows one sentence instead of its agents. A reconnecting machine's list dims
    to 60%.
- **Each agent is its own card** (`bg-card`, border, `rounded-xl`), with 8px between cards. Inside
  each card:
  - Line 1: the title (16/24; 620 when it needs you, 500 otherwise), a pin icon if pinned, and the
    time since the last state change, in mono 12px at the right.
  - Line 2: the status dot, the status word (14px, 620), a `·`, then either the pending ask
    (blocked, mono 12px) or `workspace · tab` plus the branch in mono 12px.
  - An agent that needs you gets foreground-colored text; the others get muted text.

### Interactions

- **Tap** opens the agent. For now that's the terminal view, with the Ask card pinned at the
  bottom while the agent is blocked. It slides in from the right.
- **Swipe left** reveals Pin and Close. Close opens the action sheet, and Hold Button does the
  close. Only one card is open at a time. Tapping another card closes the open one and does
  nothing else. Swiping right isn't used.
- **Long-press** (right-click on desktop) opens the action sheet: rename, pin, hold to close. You
  can drag the sheet down by its handle to dismiss it.
- **Pull down** resyncs. While it syncs, the list dims and the header says "syncing".
- **Live updates** re-sort each list, but the order freezes while a card is open or being
  dragged.

### Motion

Everything moves through Motion (`motion/react`).

- Springs:
  - Reorders, collapses, and the status-dot pop use `{ type: 'spring', duration: 0.5, bounce: 0.2
}`, from the animate skill's table.
  - Swipes, screen pushes and the sheet use the same spring with `bounce: 0`, because a
    bounce of 0.2 measured a 5px overshoot on a push.
- Tweens take their timing from Mischief's tokens (`--motion-fast` and `--motion` with
  `--ease-out`): the status word swap, fades and the press highlight.
- The press highlight comes in instantly and fades out on release.
- Nothing animates when the list first loads. It's the landing screen, opened many times a day.
- Reduced motion uses Motion's named transform keys, so `MotionConfig reducedMotion="user"` covers
  them. The imperative `animate()` calls jump instead.

### Unmeasured knobs

These are guesses. Settle them on the phone:

- the swipe opens past half the actions width, or at 500px/s;
- the actions are 64px wide with 8px gaps;
- long-press is 500ms, with 8px of movement allowed;
- pull to resync arms at 48px, rests at 40px and stops at 96px;
- the sheet dismisses past 96px, or at 500px/s.

### Stack implications (for SPEC §8.1 when web starts)

- **Motion (`motion` 14) is a new dependency.** SPEC §8.1 doesn't list it.
- **The sheet is a Base UI `Dialog` rendered through `motion.div`**, with `keepMounted` and
  `AnimatePresence`. Base UI only waits for a Motion exit that animates opacity, so the popup's
  exit includes a late opacity fade.
- **shadcn 4.22 replaced `clsx` and `tailwind-merge` with its own `cn` package** in `lib/utils`.

### Gaps and conflicts found

- **`AgentRow` lacks fields the rows need.** It has no branch and no pending-ask summary (blocked
  rows show the ask). The ask waits on S5.
- **`DESIGN.md` says "ease-in for exits".** The animate skill says never ease-in on UI. The
  prototype uses ease-out, and `DESIGN.md` should change.
- **The working dot (tomato) and the blocked dot (the destructive/accent mix) look alike at 8px.**
  The status words carry the state, but the colors are worth revisiting.
- **New Status Pill tones:** the copied Status Pill gained `working` and `unknown` tones, as
  `DESIGN.md` planned.
- **Button sizes:** Button gained crook's 44px `touch` and `icon-touch` sizes.

## History

1. Sidebar, Inbox and Tabs. The user riffed on Sidebar.
2. Stack, Swipe and Expand. These dropped the Needs-you section, sorted each machine by priority,
   dropped the sticky header, and moved all motion to Motion. The user riffed on Swipe.
3. Reveal, Mail and Grouped. These use Stack's row layout inside Swipe's cards. **Reveal
   picked.**

## Next

- The next screen to prototype is still open: agent chat is the obvious one (SPEC §5.3).
- The settled pieces then go into `DESIGN.md`:
  - the herd layout above;
  - navigation as a push stack;
  - the Status Pill machine badge.
