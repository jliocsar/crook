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
  - **No key strip.** The prototype had one (Esc, Ctrl C, arrows, Tab, Enter); the user cut it.
    Stop on the composer is the only key the chat sends.

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
- **Images in the transcript** (SPEC §5.3) are decided under "Chat leftovers".
- **Sending while the agent works:** the prototype ends the running step and replies. What
  Claude Code really does with a message sent mid-turn still needs checking.

### History

1. Thread, Turns and Pager. Turns grouped each turn's tools into one folded line. Pager made the chat
   and the terminal swipeable pages, with the Ask as a sheet. **Thread picked**, without its
   terminal toggle.

## Navigation and Machines: decided, variant "Roster"

### Prototype

- The shell is `src/app/Shell.tsx`, Settings is `src/app/Settings.tsx`, and Machines is
  `src/machines/Roster.tsx` on top of the shared `src/machines/parts.tsx`. The picker's `?v=1`
  is Roster.

### Navigation

- **Three tabs:** Agents, Machines, Settings. Agents (the herd) is home; there's no separate
  dashboard, because the herd already puts what needs you first.
- **The tab bar shows on the three root lists only.** Pushed screens (a chat, a machine) cover it,
  so the chat's dock stays clear.
  - Icons are 20px over a 12px label, in a 56px row plus the bottom safe area.
  - The active tab is `primary`.
  - Agents carries a small `primary` count of the agents that need you. The count is hidden from
    screen readers, which hear ", N need you" instead.
- **Root lists have a sticky header:** the title in display 24/32, with one action on the right.
  Agents has `+` (New agent); Machines has `+` (Add a machine); Settings has none. The herd's old
  "hub connected" line and its count-by-state subtitle are gone.
- **Pushed screens** slide in from the right with an edge swipe back. Their header's back button
  names where it goes ("Back to laptop" when a chat was opened from that machine). The new
  screen's title takes focus, and Back returns focus to whatever opened it.

### Machines list (Roster)

- One card per machine: the name in display 20/28, the connection Status Pill, then "N agents ·
  N need you", then the crook agent and Herdr versions in mono.
- **"update agent"**, a warn Status Pill, shows when the machine's crook agent is older than the
  hub.
- **Offline machines** read "Swipe to forget, or wait for it to reconnect", and swiping the card
  shows Forget (D15).
- With no machines, an Empty State offers "Add a machine".

### Machine detail

- The header shows the name, the Status Pill and the update pill.
- **Agents · N**: the machine's agents as herd cards. Tap opens the chat; long-press opens the
  agent's actions sheet. Offline shows "–" and says its agents are unknown until it reconnects.
- **About**: Online for / Reconnecting for / Last seen, then crook agent (warn when behind the
  hub, "0.0.9, hub has 0.1.0"), Herdr and Machine id.
- **Hold to forget** shows only while the machine is offline, with "It comes back on its own if
  its agent connects again" beneath.

### Add a machine

A sheet with three numbered steps, each with a Code Block: `herdr plugin install
jliocsar/crook`, the hub URL for the plugin's "Connect to hub" action, and an exe.dev token
minted with `{ "machine": "<name>" }` as its context (SPEC §5.2). It ends with "It shows up under
Machines as soon as it connects".

### New agent

`+` on Agents pushes the New agent screen. See "New agent: decided" below.

### Settings

See "Settings: decided" below.

### Lists

- **Info lists and settings rows are flat:** full-bleed rows with no dividers between them. The
  only rule is the one under the section label. DESIGN.md already bans grouped iOS Settings lists.
- **A status dot centres on the text's x-height,** not its line box. In the prototype that's
  `vertical-align: middle` on an inline dot, both in Status Pill and beside the agent's status.

### Data this needs

- **The machine registry** (SPEC §5.1): last seen and forgotten, as stored today.
- **From the hello** (SPEC §5.2): the crook agent's version and the Herdr version.
- **Online for** needs the time of the last connection change. The herd view carries only
  `lastSeenAt` today, so the hub has to add it.
- **No ping and no OS.** Both were cut, because nothing stores them.

### History

1. Roster, Fleet and Health. Fleet was two-column tiles with a big agent count and a dot per
   agent. Health was a 24h uptime bar per machine, which needed persisted connection events and
   ping. **Roster picked.**
2. Tweaks after the pick: a smaller tab bar icon and badge, no dividers in lists, no key strip in
   the chat, and dots centred on the x-height.

## New agent: decided, variant "Brief"

### Prototype

- The screen is `src/newagent/Brief.tsx`, and the shared pickers are in `src/newagent/parts.tsx`.
  The Shell takes a `newAgent` variant. The picker's `?v=2` is Brief.
- Steps (`?v=1`) and Places (`?v=3`) are dead ends now.

### Layout

- **A pushed screen shaped like the chat.** The header reads "New agent" with "Back to agents". The
  dock holds the composer, and the screen above it is empty apart from a summary.
- **The summary** is an Empty State centred in the body: "Claude starts in crook", then the
  path in mono, the machine and the branch ("in a new worktree on fix-x" when there is one).
- **The dock**, top to bottom:
  - a scrolling row of compact chips: machine, folder, branch;
  - the composer, "What should Claude work on?", whose send is "Start Claude";
  - a ghost "Start without a task".
- **Chips** are 44px pills in 14px text, each with an icon and a chevron. A new-worktree branch
  chip turns `primary` and reads "new: <branch>". The branch chip shows only when the folder is a
  git checkout. Smaller chips were tried and reverted: DESIGN.md wants the visible control at
  44px, and changing that waits for a proper DESIGN.md pass.
- **Each chip opens a sheet** listing compact rows (44px; title, then a mono detail when there is
  one). Selected rows get `muted` and a `primary` check, and there are no cards and no dividers.
  - Machine: offline machines are disabled and keep their Status Pill.
  - Folder: the machine's folders, most recently used first, plus a field to type a path.
  - Branch: "Work in the checkout" or "New worktree" with a branch name field.

### Behaviour

- **Defaults to the most recent place**: the folder of the agent that changed last, on an online
  machine. Picking a machine moves to its most recent folder.
- **The task comes first.** The worktree branch is suggested from the task's first line, as a
  lowercase slug, and you can edit it.
- **Starting** creates the workspace if no open one has that folder, or a linked worktree
  workspace, then a tab running Claude. The first message goes in as the user's first chat
  message, and the chat replaces this screen, so Back goes to Agents.
- **Empty cases:** with no online machine it says "Every machine is offline". With a machine but
  no folders, the folder chip reads "Pick a folder".
- Mobile Enter inserts a newline, as in the chat composer.

### Data this needs

- **Recent folders per machine**, each with its current branch. Claude's own project list on the
  machine is one plausible source, and herdr's workspace cwds are another.
- **Create commands** (M6): herdr's `workspace.create`, `worktree.create` (which returns the new
  workspace, tab and root pane), `tab.create` and `agent.start`, then `agent.prompt` for the first
  message.
- **Not known yet:**
  - herdr's default worktree path. The prototype stands in `<folder>-<branch>`.
  - the herdr agent name that `agent.start` requires. Brief hides it, so crook has to mint one.
- Kind isn't shown: v1 is Claude only (D8).

### History

1. Steps, Brief and Places. Steps was a sheet with one decision per step, in SPEC §5.3's order.
   Places was a sheet of recent folders where one tap starts Claude, with an inline worktree
   field. **Brief picked.**
2. Tweaks after the pick: compact picker rows. Chips went to 32px and back to 44px. The summary
   moved from the bottom of the body to its centre.

## Settings: decided, variant "Ledger"

### Prototype

- The screen is `src/settings/Ledger.tsx`, and the shared sections are in `src/settings/parts.tsx`.
  The Shell takes a `settings` variant. The picker's `?v=1` is Ledger.
- Preview (`?v=2`) and Index (`?v=3`) are dead ends now.

### Layout

One flat page on the Settings tab, three sections, each a Section Label over a rule:

- **Notifications**: Approvals, Questions, Finished and Live Activity, each a row with a label, a
  one-line detail and a switch that is `primary` when on. Below the rows:
  - "Saved on the hub, so every device you log in on shares them."
  - a full-width secondary "Send a test" button, which swaps to "Sending" and "Sent to your
    phone";
  - "Notifications name the agent and the machine, never what Claude wrote. Hark delivers them,
    so they open nothing in crook."
- **Account**: "Logged in as" with the exe.dev email, a full-width destructive "Log out", and
  "Lost this phone? End its session on exe.dev from another device."
- **Hub**: Status, Address, Version.

### Behaviour

- **Prefs live on the hub.** The hub decides whether to call Hark, so the phone can't own the
  choice. One user, so no per-device prefs.
- **Log out** asks in a sheet ("Log out of crook?", "Your agents keep running."), then shows a
  logged-out screen with "Log in with exe.dev". Logging out closes every pushed screen and sheet.
- **Lost phone** is handled on exe.dev from another device, not in crook: the in-app log out
  needs the phone.

### Decided against

- **Quiet hours and pause**: iOS Focus already does that for Hark.
- **Per-machine and per-agent overrides**: not for now. If they come, they live on the agent or
  machine screen, not here.
- **A confirm before approving from the lock screen**: Hark's actions are deliberate enough.
- **Theme**: follows the system, per DESIGN.md.

### Data this needs

- **Per-event prefs** stored on the hub and read before every Hark call (M5).
- **A test notification** endpoint on the hub that sends a labels-only Hark notification.
- **The account email**, from the `X-ExeDev-Email` header the hub already checks (SPEC §7).
- **Not known yet:** how the PWA logs out of exe.dev. The prototype fakes it.

### History

1. Ledger, Preview and Index. Preview showed a mock lock-screen notification under each switch.
   Index was three summary rows that each pushed a page. **Ledger picked.**

## Connection states: decided, variant "Banner"

### Prototype

- The connection UI is in `src/connection/`:
  - `data.ts`: the simulated link, its scenarios and `useConnection`;
  - `context.tsx`: the slots a variant fills, and `Gate`;
  - `parts.tsx`: the copy, the icon and the skeleton;
  - `Banner.tsx`: the variant itself.
- The Shell takes a `connection` variant. The picker's `?v=1` is Banner, and its scenario menu (or
  the S key) plays each state.
- Island (`?v=2`) and Caption (`?v=3`) are dead ends now.

### Layout

- **The banner** is a 32px full-width strip at the top of every header, under the status bar. It
  shows on tab screens, chats and pushed screens alike. It has an icon and one line of copy, and
  for the failure states the time since the last update on the right, in mono.
  - Hub unreachable: "Can't reach the hub · retrying", tinted with the destructive colour.
  - No network: "You're offline", inverted (foreground background).
  - Syncing and connecting: "Syncing" or "Connecting to the hub", with a spinner, on muted.
  - Back from a failure: "Back online" on accent for a moment, then the strip collapses.
- **Stale content** dims to 60%: the herd list, the Machines list, a machine's agent cards and
  the chat transcript. Headers and the back button stay at full strength.
- **First load** with no cache shows skeleton rows shaped like machine sections, on Agents and on
  Machines, and hides the needs-you badge.
- **An expired session** shows the logged-out screen with "Your session expired" and "Your agents
  kept running. Log in again to see them."

### Behaviour

- **The cached herd stays readable.** Hub actions are disabled until the hub is back: send, stop,
  answering an ask, new agent, rename, pin, close, forget, and the notification prefs. Back,
  tabs, scrolling and opening chats all keep working.
- **No queue.** A message can't be sent while disconnected, and nothing fires after a reconnect.
- **The resync on return is silent when it's quick.** "Syncing" and the dim only show after 1s,
  Nielsen's limit for a delay that keeps the user's flow of thought. After a failure, "Syncing"
  shows at once, so "Back online" never appears before the data is fresh.
- **Pull to resync is off** while the hub is unreachable, since crook is already retrying.
- **Machines keep their last-known status** while the hub is down. The hub, not the phone, decides
  that a machine is offline.
- **Offline and hub unreachable read differently,** because their fixes differ: one is the
  phone's network, the other is crook's side.
- **Screen readers** hear each state once, from a single status region.

### Decided against

- **A floating capsule by the tab bar (Island)**: one more floating thing, and it covered the end
  of the list.
- **A quiet line under the title (Caption)**: too easy to miss when actions are disabled.
- **A "Retry now" button**: crook already retries on its own.

### Unmeasured knobs

- "Back online" stays for 1.5s.
- The strip is 32px tall.
- These were picked in the prototype, not measured.

### Data this needs

- **The last-synced time** stored with the IndexedDB snapshot (SPEC §5.3).
- **`navigator.onLine`** and its events, to tell offline from hub unreachable.
- **The PWA's reconnect schedule**: not designed yet. The client must still ping within the hub's
  10s silence timeout (ARCHITECTURE §2.6).
- **Not known yet:** how an expired exe.dev session shows up to the PWA, whether as a rejected
  WebSocket upgrade or a login redirect on fetch. The prototype fakes it.

### Known issues

- If the hub drops while you're typing, the disabled composer loses focus and the keyboard
  closes. The draft survives.

### History

1. Banner, Island and Caption. Island was a capsule above the tab bar that expanded on tap, and
   docked above the composer in chats. Caption was a muted line under the title. **Banner
   picked.**

## Empty and edge states: decided, variant "Card"

### Prototype

- The edge UI is in `src/edge/`:
  - `data.ts`: the harness store (herd states and events);
  - `parts.tsx`: the copy, the herd notices, the toast and the slot type;
  - `Card.tsx`: the variant itself.
- The herd model gained `gone` (panes that ended, with a snapshot of the agent) and `paneFate`.
- The picker's `?v=3` is Card. Its second menu sets a herd state, or fires an event that opens
  the chat by itself and replays when you switch variants.
- Strip (`?v=1`) and Marker (`?v=2`) are dead ends now.

### Layout

- **No agents, machines online:** one empty state at the top of the herd, "Nothing running",
  with a New agent button. The machine headers stay below it.
- **No machines:** the Agents tab shows the Machines tab's "No machines yet / Add a machine" and
  opens the same sheet.
- **Every machine offline:** one muted "All machines are offline" line at the top, and each
  machine keeps its "Last seen" line. The + stays tappable, and New agent explains that no
  machine is online. The red banner stays reserved for the hub.
- **A machine with no agents** next to busy ones: a muted "No agents" line under its header.
- **The pane closes, or Claude exits, while its chat is open:** the dock becomes a card with an
  icon, "This pane closed" or "Claude exited", when it happened, and two buttons:
  - "Start Claude here again" (a new pane in the same workspace) or "Start Claude in this pane"
    (the pane is still there, at its shell prompt);
  - Back.
  - The header status reads "closed" or "exited" with a hollow dot.
- **The machine drops while its chat is open:** the dock becomes a card, "laptop is offline",
  with a spinner, "Waiting for it. Last heard from Xm ago.", and Back. The transcript dims and
  the header status reads "laptop offline".
- **The pane closes while its long-press sheet is open:** the sheet closes and a "Pane closed"
  toast shows above the tab bar.

### Behaviour

- **Never pops on its own.** The transcript stays readable until you leave.
- **A machine that comes back** with the pane still there resumes silently: the card goes and
  the composer returns. If the pane is gone, it turns into the closed card.
- **A draft survives** the offline card: the composer stays mounted underneath it.
- **Focus stays in the dock:** when the card replaces a focused composer, focus moves to its
  first button, and back to the composer after a restart.
- **Screen readers** hear "This pane closed", "Claude exited" or "laptop is offline" once.
- **The restart replaces the chat in place,** without a push animation. It needs the machine
  online and the hub reachable.
- **The needs-you badge** ignores agents on offline machines, since they're hidden.
- **No toast** when you closed the pane yourself from that sheet.

### Decided against

- **A strip under the header plus a slim dock line (Strip)**: two places for two events.
- **A divider written into the transcript (Marker)**: quietest, but easy to miss when you're
  scrolled up.
- **Popping back to the herd** when the pane closes: it yanks you out mid-read.

### Unmeasured knobs

- The toast stays for 3s. It was picked in the prototype, not measured.

### Data this needs

- **Telling "closed" from "exited":** herdr still lists an exited pane, just without an agent.
  The hub has to keep that difference in `HerdView`.
- **The transcript after the pane is gone** comes from what the phone already holds. Nothing
  re-fetches it.
- **"Start Claude in this pane"** maps to `herdr agent start --pane`. "Start Claude here again"
  needs a new pane in the same workspace, the same call New agent makes (JC-111).

### Known issues

- If the pane's workspace is gone too, the restart button does nothing. It should open New
  agent instead.
- The draft carries over into the restarted chat. That's probably what you want, but it's
  unconfirmed.

### History

1. Strip, Marker and Card, after 7 calls agreed up front. **Card picked.**

## Chat leftovers: decided, variant "Drill"

### Prototype

- Subagents are in `src/subagents/`:
  - `context.tsx`: the slot a variant plugs into;
  - `parts.tsx`: the run rows, the "N running" pill and the subagent screen;
  - `Drill.tsx`: the variant itself.
- Images are in `src/chat/images.tsx`: the thumbnails and the full-screen viewer.
- The demo pane is "Prototype the herd screen". Its two background reviewers finish about 10s
  after you first open it, then Claude picks up their findings.
- crook's copies of Mischief's Subagent Tree (tappable 44px rows, a mono meta line) and Tool
  Call (a `footer` slot) were extended.
- The picker's `?v=2` is Drill. Inline (`?v=1`) and Tray (`?v=3`) are dead ends now.

### Layout

- **Images Claude read** (a `Read` of a png) show as a thumbnail on the tool card, visible
  without expanding it. Images you pasted show in your bubble.
- **Tapping a thumbnail** opens a full-screen viewer on black: the file name and a 44px close
  button at the top, pinch to zoom, double-tap to zoom in or out, swipe down to close.
- **Subagents** (the `Agent` tool) render as a Subagent Tree titled "Subagents". One turn's
  calls group into one tree. Each row is 44px: the status dot, the description, a mono line with
  the agent type, the model and, while it runs, its current tool, then the running time and a
  chevron.
- **Tapping a row** pushes the subagent's own screen:
  - the header shows its description, then status, time, type and model;
  - "Claude asked" holds the prompt it was given;
  - its tool calls render like the main chat's, then Working while it runs, then its result;
  - there's no composer, just "Subagents take no messages. Reply to Claude in its chat."
- **While any subagent runs,** the chat header shows a "2 running" pill. Tapping it scrolls to
  the running tree.
- **The `…` button** in the chat header opens the long-press sheet: Rename, Pin, hold to close.

### Behaviour

- **Background subagents keep updating** after Claude's turn ends. Sending a message or Stop
  only ends the turn; it doesn't touch them. When they finish, Claude starts its next turn by
  itself.
- **A pane that closes** stops its subagents: they read "failed" with "Pane closed".
- **Closing from the `…` sheet** goes back to the herd with a "Pane closed" toast. It doesn't
  show the ended card, because you did it. Focus lands on the Agents tab.
- **Rename** updates the header and the back labels live.
- **Watching a subagent's screen** counts as watching its agent, so the agent doesn't come back
  as "done, not opened".
- **Focus after the viewer:** it returns to the thumbnail, with a focus ring only when you
  closed it from the keyboard.

### Decided against

- **Rows that expand in place (Inline)**: the quickest look, but long results stretch the
  chat.
- **A strip and a sheet (Tray)**: the cleanest chat, but subagents sit one step further away.

### Unmeasured knobs

These were picked in the prototype, not measured:

- thumbnails are 96px tall on a tool card and 160px in a bubble;
- double-tap zooms 2.5x within 300ms, and pinch stops at 4x;
- swipe-down closes past 96px, or at 500px/s over the last 80ms once it has moved 24px;
- the backdrop fades out over 320px of drag.

### Data this needs

Measured from local Claude Code transcripts (2026-10-20):

- **The tool is `Agent` now, not `Task`.** SPEC and DESIGN.md still say Task.
- **Each subagent writes its own transcript** at `<session>/subagents/agent-<id>.jsonl`, with
  a `.meta.json` beside it holding `agentType`, `description`, `model` and `finished`. The
  subagent screen reads that file, so the agent has to tail it like the main transcript.
- **No subagent found had spawned subagents of its own,** so the tree stays one level deep in
  practice. The component nests if that changes.
- **The images found** were inside `tool_result` blocks. The hub needs to stream them, or
  serve them, without breaking the CSP (`img-src`).

### Known issues

- **Sending images from the phone** isn't designed. It's flagged on JC-104.
- **While a machine is offline,** a running subagent's timer keeps counting. It's probably
  still running on the machine, but nothing confirms it.
- **On iOS,** whether the viewer can turn off the ring on returned focus
  (`focus({ focusVisible: false })`) hasn't been checked on a device.

### History

1. Inline, Drill and Tray, after 8 calls agreed up front. **Drill picked.**
2. The thumbnail kept a focus ring after you closed the viewer with a tap. Now the ring only
   shows when you closed it from the keyboard.

## Outside the app: decided, variant "Word"

### Prototype

- `src/outside/`:
  - `identity.tsx`: the three icons as data, one SVG renderer and one canvas renderer for the
    splash image;
  - `data.ts`: the scene switch, the notification and Live Activity copy, and the lock screen
    demo script;
  - `parts.tsx`: the Home Screen, Launch, Install and Lock Screen scenes.
- The picker's `?v=3` is Word. Crook (`?v=1`) and Herd (`?v=2`) are dead ends now. Its scene
  menu (or the S key) switches scenes, and Next (or N) steps the lock screen demo.
- The prototype sets the real `apple-touch-icon`, a startup image drawn for the phone's own
  screen in each theme, and a manifest. So adding it to the Home Screen shows the real icon and
  splash. `?bar=` overrides the status bar style.
- `?icon=<id>` renders one icon full-bleed, which is how its 180px PNG was made.
- The lock screen is a mock. Hark draws the real cards, and their look wasn't checked.

### Layout

- **The icon** is the lowercase wordmark "crook" in Bricolage Grotesque at 650, dark ink
  (`#201711`, the light theme's foreground) on cream (`#FDFCF8`, the light theme's
  primary-foreground). It's a full-bleed square; iOS rounds the corners.
- **The splash** is the wordmark alone, in the theme's foreground on its background, centred.
- **The install screen**, shown in a browser tab only:
  - the icon, "Add crook to your Home Screen", then "crook runs from your Home Screen, like an
    app. Logins are kept per app, so log in once it's there.";
  - numbered steps for the browser you're in. Safari: "Tap Share in the toolbar" (with "Can't
    see it? Tap ⋯ first."), "Choose Add to Home Screen". Chrome: "Tap Share in the address
    bar", then the same. Both end with "Open crook from your Home Screen";
  - a quiet "Continue in browser" at the bottom.
- **Notifications**: the title is the agent's title, so each agent threads on its own. The body
  is a verb and where it runs: "Wants to run Bash · laptop / crook", "Has a question · desk /
  notes", "Finished · laptop / crook". All go into a `crook` project in Hark's inbox.
- **The Live Activity**: the title is "crook". The status is the herd in one line: "1 needs
  you · 2 working", "3 working", "All done". The detail is the agent that has waited longest
  ("Prototype the herd screen wants Bash · laptop"), or the latest working one. The symbol is
  `warning`, `terminal` or `success`, with no progress bar. The accent is the dark theme's
  foreground (`#EEEBE4`).

### Behaviour

- **Approvals** are Hark approval interactions on a normal notification, not on the Live
  Activity, so the herd card keeps the device's one slot. Approve and Deny both withdraw the
  notification. The prompt names the tool only, never the command. It uses Hark's longest
  expiry and is cancelled as soon as the agent stops waiting.
- **Questions** can't be answered from Hark, so they're plain notifications.
- **Every notification is withdrawn** once you've seen it in crook or the state moved on.
  Tapping one opens nothing (no `url`), per D16.
- **The Live Activity starts** when the herd goes from idle to busy, because a start makes a
  sound. It updates on each meaningful change, ends on "All done", and leaves after a short
  linger. Hark caps a card at 8h, so it's then restarted with a fixed `key` and `replace:
true`, at least a minute after the last start (Hark warns iOS drops faster ones).
- **The install screen** shows when crook isn't running standalone. "Continue in browser"
  carries on to the login. From the Home Screen, crook goes straight to "Log in with exe.dev".
- **The manifest**: `name` and `short_name` are `crook`, `display` is `standalone`, the
  background and theme colours are the light background, and the orientation isn't locked.

### Decided against

- **Crook**, a shepherd's crook in cream on tomato, and **Herd**, a cluster of status dots
  on the dark ground.
- **A custom notification avatar**: Hark's `imageUrl` must be a public HTTPS URL, and the hub
  is private.
- **Approvals on the Live Activity**: they would take the herd card's slot.
- **Filing notifications under the machine label** (JC-107's first cut): one `crook` project
  keeps them together, and the body already names the machine.

### Unmeasured knobs

These were picked in the prototype, not measured:

- the wordmark is 26% of the icon's width with `-0.03em` tracking;
- the splash mark is 30% of the screen's width;
- the install screen staggers its pieces by 50ms;
- how long the "All done" card lingers isn't picked yet.

### Data this needs

- **Hark's limits** (from its docs): title 80, Live Activity status 60 and detail 240
  characters; one Live Activity per device; at most 8h per activity.
- **The PNG icons and the startup images** are build output. The wordmark should be outlined to
  a path before export, so it doesn't depend on the font loading.
- **Standalone detection**: `display-mode: standalone`, or `navigator.standalone` on iOS.

### Known issues

To check on the phone, with the prototype added to the Home Screen:

- the status bar style in both themes (`default` against `black-translucent`);
- whether a startup image with `prefers-color-scheme` in its media query is honoured;
- how iOS treats a web app's icon in dark and tinted Home Screen modes;
- whether Safari's canvas supports `letterSpacing`, which the splash image uses;
- the install steps' wording on the phone's iOS version, in Safari and in Chrome.

### History

1. Crook, Herd and Word, after 8 calls agreed up front. **Word picked.**

## Next

- **The rest of JC-117**: housekeeping. Wide layouts are skipped; they aren't needed for now.
- **When web starts,** the settled pieces go into `DESIGN.md`:
  - the herd layout;
  - the chat layout;
  - navigation and Machines;
  - the New agent screen;
  - Settings;
  - the connection banner, the dimmed stale state and the first-load skeleton;
  - the empty states, the ended and offline chat cards, and the toast;
  - the image thumbnails and viewer, the subagent tree and screen, and the chat's `…` button;
  - the Word icon, the splash and the install screen;
  - the Status Pill machine badge.
- **The SPEC changes** go in at the same time:
  - drop the terminal view and the Ask's "show screen";
  - §5.3 gains the tab bar and the Machines screen, and Forget moves from Settings to Machines;
  - §5.3's New agent order becomes task first, with machine, folder and branch as defaults you
    can change;
  - §5.3's Settings gains Account and the test notification, and its prefs are stored on the hub;
  - add Motion to §8.1;
  - the Subagent Tree is for the `Agent` tool, not `Task`;
  - §8.1 gains the install screen and the manifest, and the Hark payloads get the copy from
    "Outside the app".
