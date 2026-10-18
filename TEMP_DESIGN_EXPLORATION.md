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

- **Tap** opens the agent's chat (below). It slides in from the right, and a swipe from the left
  edge goes back.
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

### History

1. Sidebar, Inbox and Tabs. The user riffed on Sidebar.
2. Stack, Swipe and Expand. These dropped the Needs-you section, sorted each machine by priority,
   dropped the sticky header, and moved all motion to Motion. The user riffed on Swipe.
3. Reveal, Mail and Grouped. These use Stack's row layout inside Swipe's cards. **Reveal
   picked.**

## Agent chat: decided, variant "Thread"

Tapping a herd card pushes the agent's chat: the conversation with one Claude Code agent.

### Prototype

- Same source as the herd: `/home/jliocsar/Projects/crook/tmp/prototypes/herd`, at
  <http://cyborg-15-a13v:5180/?v=1>. It opens on "Review WatchHerd snapshot diff", which works for
  about 4s, then asks to edit `packages/hub/src/Herd.ts`. Back goes to the herd.
- Thread is `src/chat/Thread.tsx`, built from the shared pieces in `src/chat/parts.tsx`. The fake
  transcripts and the live simulator are in `src/chat/data.ts`.
- Screenshots: `/home/jliocsar/Projects/crook/tmp/prototypes/shots/thread-blocked-light.png`,
  `thread-blocked-dark.png` and `thread-done-dark.png`.

### No terminal view

The chat is the only view. There's no toggle to the raw terminal, and no "show screen" escape
hatch on the Ask. SPEC §5.3 lists both, so the SPEC needs to drop them.

A pane that isn't running Claude Code has no transcript. Its chat says so ("Not a Claude pane")
and nothing else.

### Layout

- **Header:**
  - a back chevron;
  - the agent's title (display, 20/28, 620, truncated);
  - one line under the title: the status dot, the status word (blocked reads "needs you"), then
    `machine · workspace` in mono 12px.
- **The transcript** is Mischief's Conversation. It follows the live tail, and shows "Latest" when
  you've scrolled up.
  - **Your messages:** Message bubbles, at 16/24.
  - **Claude's text:** Response markdown, at 16/24, with Code Block for fenced code.
  - **Tool calls:** one Tool Call card each, collapsed, titled like the terminal (`Read(Herd.ts)`,
    `Bash(bun run …)`). The whole header is the 44px trigger. Expanded:
    - Edit shows Diff View;
    - Bash shows Terminal Output;
    - Read and Grep show their output text.
  - **Plans (TodoWrite):** an Agent Checklist titled "Plan". It updates in place.
  - **Notes** (interrupted, an "Always" grant, a cleared conversation) are centered muted 12px
    lines.
  - **Working:** Thinking State, timed from the status change. It shows only when no tool is
    running and no text is streaming, so there's never a second spinner.
  - The tool call an Ask is about is hidden while the Ask is open, so its diff isn't shown twice.
- **The dock** sits at the bottom, on `bg-card`, above the home indicator.
  - **The Ask, while blocked.** It opens above the composer with the label "Needs you" and a
    title ("Edit Herd.ts?", "Run this command?").
    - It shows the Diff View or a Code Block for the command, capped at 160px and scrolling.
    - Then three 44px buttons: Yes, Always, No.
    - "Always" leaves a note in the transcript, e.g. "Edits to Herd.ts allowed for the rest of the
      session".
    - An AskUserQuestion uses Questionnaire instead: the options, "Something else…", and Answer.
  - **The composer** is Prompt Input, at 16px.
    - A `/` button and typing `/` both show the slash commands as a Suggestions row.
    - Send turns into Stop while the agent works. Stop is Esc.
    - While blocked, the placeholder reads "Or tell Claude what to do instead". Sending then
      declines the Ask with your message.
    - Enter adds a line on a touch keyboard and sends on a hardware one.
  - **The key strip** sits under the composer: Esc, Ctrl C, ↑, ↓, Tab, Enter.
    - Each key is 44px, and tapping one keeps the keyboard up.
    - It hides while the Ask is open.

### Behaviour

- The herd behind the chat is inert while the chat is open.
- Watching an agent finish marks it seen, so it doesn't come back as "done, not opened".
- When the iOS keyboard opens, the screen sizes itself to the visual viewport, so the header
  stays put. This is unverified on a device.

### Motion

- **The push and the edge swipe back** use GLIDE. The back swipe starts in the left 16px gutter.
- **New transcript items** fade in and rise 8px with `--motion` and `--ease-out`. They leave with
  a `--motion-fast` fade.
  - The history already there when you open the chat doesn't animate.
- **The Ask** opens and closes as a height collapse on SPRING.
- **The status word** swaps the way it does on the herd.

### Unmeasured knobs

These are guesses to settle on the phone:

- the back swipe commits past a third of the width, or at 500px/s;
- the back swipe's edge gutter is 16px;
- the Ask's diff is capped at 160px.

### Mischief changes (in the copies crook owns)

These were bugs or `DESIGN.md` misses in the components as shipped:

- **Conversation:**
  - it now follows the tail when its own viewport shrinks, e.g. when the dock grows;
  - "Latest" no longer flickers mid-scroll;
  - it takes a `jumpOffset`;
  - the jump button is 44px.
- **Prompt Input:**
  - the text is 16px;
  - Send and Stop are 44px;
  - each is its own keyed element, so Send can't turn into Stop under your finger;
  - neither takes focus away from the field.
- **Tool Call:** the whole header is the 44px trigger.
- **Questionnaire:**
  - its targets are 44px and its freeform field is 16px;
  - it has no Back button on a single question.
- **Motion quirk:** under `AnimatePresence initial={false}`, a child mounted later skips its
  entrance. Each list that animates needs its own `AnimatePresence`.

### Gaps

- **The transcript data doesn't exist yet.** These wait on S5 and the transcript reader:
  - turns;
  - tool calls, with durations;
  - the Ask's diff or command;
  - the plan.
- **Images in the transcript** (SPEC §5.3) weren't prototyped.
- **Sending while the agent works:** the prototype ends the running step and replies. What
  Claude Code really does with a message sent mid-turn still needs checking.

### History

1. Thread, Turns and Pager. Turns grouped each turn's tools into one folded line. Pager made the chat
   and the terminal swipeable pages, with the Ask as a sheet. **Thread picked**, without its
   terminal toggle.

## Next

- **Navigation and Machines.** A tab bar on the top-level lists, hidden on pushed screens like
  the chat. The candidates for tabs are Agents (the herd, as home), Machines and Settings. See the
  handoff for the open questions.
- **Then:** New agent, then Settings (SPEC §5.3).
- **When web starts,** the settled pieces go into `DESIGN.md`:
  - the herd layout;
  - the chat layout;
  - navigation;
  - the Status Pill machine badge.
- **The SPEC changes** go in at the same time:
  - drop the terminal view and the Ask's "show screen";
  - add Motion to §8.1.
