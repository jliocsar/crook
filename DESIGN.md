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

| Variable                 | Light                         | Dark                        | Role                         |
| ------------------------ | ----------------------------- | --------------------------- | ---------------------------- |
| `background`             | `oklch(1 0 0)`                | `oklch(0.17 0.012 58)`      | Page ground                  |
| `foreground`             | `oklch(0.215 0.018 58)`       | `oklch(0.94 0.01 84)`       | Primary text, strong borders |
| `card`                   | `oklch(1 0 0)`                | `oklch(0.215 0.014 58)`     | Raised rows, sheets          |
| `card-foreground`        | `oklch(0.215 0.018 58)`       | `oklch(0.94 0.01 84)`       |                              |
| `popover`                | `oklch(1 0 0)`                | `oklch(0.215 0.014 58)`     | Menus, popovers              |
| `popover-foreground`     | `oklch(0.215 0.018 58)`       | `oklch(0.94 0.01 84)`       |                              |
| `primary`                | `oklch(0.675 0.205 32)`       | `oklch(0.72 0.185 32)`      | Tomato: links, active, focus |
| `primary-foreground`     | `oklch(0.99 0.005 84)`        | `oklch(0.16 0.012 58)`      |                              |
| `secondary`              | `oklch(0.955 0.012 80)`       | `oklch(0.27 0.018 58)`      | Secondary buttons            |
| `secondary-foreground`   | `oklch(0.27 0.02 58)`         | `oklch(0.92 0.01 84)`       |                              |
| `muted`                  | `oklch(0.958 0.009 82)`       | `oklch(0.25 0.014 58)`      | Quiet fills, code wells      |
| `muted-foreground`       | `oklch(0.48 0.025 58)`        | `oklch(0.72 0.016 76)`      | Supporting text, meta        |
| `accent`                 | `oklch(0.78 0.16 128)`        | `oklch(0.72 0.14 128)`      | Leaf: small success details  |
| `accent-foreground`      | `oklch(0.24 0.04 128)`        | `oklch(0.17 0.035 128)`     |                              |
| `destructive`            | `oklch(0.58 0.22 28)`         | `oklch(0.68 0.2 28)`        | Kill, deny, errors           |
| `destructive-foreground` | `oklch(0.985 0.01 84)`        | `oklch(0.17 0.02 28)`       |                              |
| `border`                 | `oklch(0.215 0.018 58 / 16%)` | `oklch(0.94 0.01 84 / 15%)` | Rules, quiet borders         |
| `input`                  | `oklch(0.215 0.018 58 / 20%)` | `oklch(0.94 0.01 84 / 20%)` | Field borders                |
| `ring`                   | `oklch(0.675 0.205 32)`       | `oklch(0.72 0.185 32)`      | Focus ring                   |

Borders use alpha colors, so they work in both themes.

### Agent status

crook's agent statuses reuse Mischief's own dots. Status Pill has four tones: `ok`, `warn`, `down`
and `idle`. Subagent Tree draws three dot styles the pill lacks: `running`, `queued` and its
`done`.

| Status    | Dot                                                             | Source                  |
| --------- | --------------------------------------------------------------- | ----------------------- |
| `idle`    | `bg-muted-foreground`                                           | Status Pill `idle`      |
| `working` | `bg-primary animate-pulse`                                      | Subagent Tree `running` |
| `blocked` | `bg-[color-mix(in_oklab,var(--destructive)_55%,var(--accent))]` | Status Pill `warn`      |
| `done`    | `bg-accent`                                                     | Status Pill `ok`        |
| `unknown` | `border border-muted-foreground/40`, hollow                     | Subagent Tree `queued`  |

Notes on the mapping:

- **`down` (`bg-destructive`) marks failures, not an agent status.** The hub is unreachable, or a
  tool failed.
- **The words always carry the state**, so color never works alone.
- **A done agent is green, a done subagent stays grey.** Subagent Tree's `done` is
  `bg-muted-foreground/40`. The decision: green is for an agent the user should look at, while a
  finished subagent is history inside it.
- **`working` and `unknown` are two extra entries in the copied Status Pill's dot map.** crook owns
  the copied source (SPEC §8.1).

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

Mischief's rules, unchanged.

Timing:

- 120 to 180ms for hover and press feedback.
- 180 to 240ms for small state changes.
- 300ms at most for anything the user started.

Easing:

- Springs for pointer-driven, interruptible movement.
- Ease-out for entrances, ease-in for exits.

Restraint:

- Never animate keyboard navigation.
- Never animate every element at once.
- Keep deformation between 0.96 and 1.04.
- Respect `prefers-reduced-motion`.

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
| Terminal Output | The terminal fallback view                                  |
| Agent Checklist | TodoWrite                                                   |
| Subagent Tree   | Task tool subagents                                         |
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

### Touch targets of at least 44px

On a phone this is the visible control, not an invisible larger hit area. Mischief's `DESIGN.md`
asks for 44px touch targets and says mobile actions stay 44px tall. Its shipped controls fall
short of that:

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

All of them go to 44px. Button needs a size of crook's own, because base-nova doesn't have one that
large.

### Text fields at 16px

These fields ship under 16px:

- Prompt Input's field and Questionnaire's freeform field, at `text-sm` (14px).
- Command Palette's search, at `text-[0.95rem]` (15.2px).

iOS Safari zooms the page when a field under 16px takes focus. That's known iOS behavior, but it
hasn't been checked on the user's phone yet. Raise all three to `text-base`.

### Two more Status Pill tones

`working` and `unknown`, as described under Agent status.

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

- Navigation: a push stack (herd → chat) or a tab bar.
- What each herd row shows, and how "Needs you" looks.
- The machine badge's tone for each state: online, offline, reconnecting.
