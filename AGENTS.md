# AGENTS.md

Effect v4 TypeScript monorepo boilerplate. Toolchain, lint rules, conventions — no product code.
Members live in `packages/*`. `packages/tsconfig` holds the shared TS base every member extends.

Toolchain is oxc + TypeScript 7: `oxlint` (lint), `oxfmt` (format), `typescript@7` with
`@effect/tsgo`. No ESLint, no dprint, no Prettier.

The house lint rules are `@jliocsar/begone-slop`, a published oxlint plugin developed in its own repo. It is
an ordinary dependency here: `.oxlintrc.json` loads it by bare specifier and extends its
`preset.json` through an explicit `./node_modules/` path, because `jsPlugins` resolves a package
specifier and `extends` does not (measured).

:::warning
Fix a rule in the `begone-slop` repo, never here — there is nothing to edit in this one. It ships
compiled ESM, so `node_modules/@jliocsar/begone-slop/dist` is build output. Reach for `bun run lint` and read
its `README.md` for the rule list.

The same goes for the compiler settings: the package publishes the house tsconfig as
`@jliocsar/begone-slop/tsconfig`, and `packages/tsconfig/base.json` extends it. A house-wide
compiler option is a release of that package, exactly like a rule.

`lint` passes `--no-error-on-unmatched-pattern`: this repo carries no product code, and oxlint
otherwise exits non-zero when it matches no files, failing the gate on an empty template.

Every oxlint and oxfmt call, the hooks' included, also passes `--disable-nested-config`. An agent
worktree under `.claude/worktrees/` carries its own `.oxlintrc.json` and `.oxfmtrc.json`, and both
tools let a nested config govern its directory, so the root's `.claude` ignore did not reach it:
the push hook failed on another agent's half-done worktree, once per tool (measured). This repo
tracks one config of each, so nothing else changes.
:::

The preset ships most of them as `warn`, so every lint invocation passes `--deny-warnings`: a
warning that cannot fail the gate is one nobody fixes. Downgrade individual rules in
`.oxlintrc.json` rather than dropping the flag.

:::warning
`prepare` runs `effect-tsgo patch --oxlint`, which patches the oxlint and TypeScript binaries in
`node_modules`. Without it the Effect rules do not run. It is not optional and it re-runs on every
install — do not "simplify" `prepare` down to the git config line.

It also validates that `oxlint`, `oxlint-tsgolint` and `@effect/tsgo` are a supported triple, so
bump the three together. tsgo 0.58 added `effect-tsgo oxlint` and `effect-tsgo tsc`, which run
patched binaries without touching `node_modules`; crook still patches, since editors and plain
`tsc` launch the stock binaries.

A reinstall reverts the patch and `prepare` redoes it: `Unknown plugin: 'effecttsgo'` is what a
missing patch looks like, and the Effect rules ran again after `bun install --force` and a patch
(measured on tsgo 0.67.4). A toolchain bump still unpatches first, with `bunx effect-tsgo unpatch
--oxlint`, since that restores the old build's binaries.
:::

The git hooks are plain scripts in `.githooks`, and `prepare` points `core.hooksPath` at them. Husky
did nothing else we used. Formatting, lint on staged files and the typecheck run on commit; the whole
repo's lint and the format check run on push, so a commit stays quick, and so do the tests the pushed
commits can reach: each member's `vitest --changed` against what the remote already has. The whole
suite took 2 min 42 s, 141 s of it the web member's 1523 tests, past an agent's 2 min Bash timeout
and flaky beside other agents' work (measured). `--changed` follows the module graph into other
members (a domain leaf touched picked 61 web test files, measured) and reruns everything when a
`package.json` or a Vite or Vitest config moved (read in its source). A new branch diffs from its merge base with `origin/main`, and a
push it cannot place, such as a branch other than the one checked out, runs the whole suite. A Claude Code hook
refuses the Bash commands that skip them. It drops quoted text first, so a commit message mentioning
a flag passes.

## First

:::warning
Invoke the `effect-best-practices` skill before writing Effect code. Follow it as absolute truth.
Do not duplicate it here — read it.
:::

Gate every change, all four:

```sh
bun run typecheck && bun run lint && bun run test && bun run fmt:check
```

Auto-fix: `bun run lint:fix && bun run fmt`. Run `fmt` before `lint:fix` — formatting moves line
breaks, and the spacing rules judge the result.

## Area rules

What matters only in one part of the repo lives in `.claude/rules/`, one file per area. Each
file's `paths` frontmatter scopes it, so Claude Code loads it only once it reads or edits a matching
file, and this file stays what every session needs. An agent that does not read `.claude/rules`
reads the file for its area before it starts.

| File | Covers |
| - | - |
| `toolchain.md` | lint presets, compiler settings, pins, installs, the test script flags |
| `effect.md` | how Effect and its platform modules behave; loads with any TypeScript |
| `state-machines.md` | the one shape every machine has, its walk and its chart |
| `web.md` | the PWA in general: router, Vite, Tailwind, shadcn, atoms, happy-dom |
| `web-chat.md` | the chat screen: thread, lift, virtualizer, rows, composer, catch-up |
| `web-herd.md` | the herd and machine screens, pushed screens, gestures |
| `stories.md` | the story catalog, its smoke test and the kitchen |
| `skeletons.md` | skullet, the sample it measures and the style policy |
| `frames.md` | the frame tool and what its checks mean |
| `transcript-pipe.md` | agent to hub to phone: watches, mailboxes, positions, resumes |
| `hub.md` | per-connection fences and the lock-screen answer |
| `claude-code.md` | what Claude Code writes: transcripts, pid files, hooks, slash commands |
| `agent.md` | the agent's costs, sockets, status budget, `fs.watch`, its service |
| `herdr.md` | herdr's readiness, timeouts, hangs and session changes |
| `probes.md` | checking the app against real data |
| `release.md` | the release workflow, the shared version, Bun's compile and TLS |

## Layout

- Shared code goes in a `packages/*` member, reached by package specifier — never a relative path
  across members. Not lintable in a flat layout (a sibling climb spells `../../other`, naming no
  directory), so it is on you. If the import you want is not exported, export it.
- `packages/tsconfig` has no `scripts` at all: it ships a tsconfig and nothing runnable.
- There is no root `tsconfig.json`. Every member owns its own and extends the shared base.

:::warning
A member that extends the shared base must depend on it, or the extends does not resolve:

```jsonc
// packages/<member>/package.json
{ "devDependencies": { "@crook/tsconfig": "workspace:*" } }
```

```jsonc
// packages/<member>/tsconfig.json
{ "extends": "@crook/tsconfig/base.json", "include": ["src/**/*.ts"] }
```

Bun links a workspace member into `packages/<member>/node_modules` only where something declares it,
and nothing hoists it to the root — so without that dependency the compiler reports
`File '@crook/tsconfig/base.json' not found` (measured). The second hop needs nothing: the
base reaches `@jliocsar/begone-slop/tsconfig` through the root install. TypeScript's `extends`
resolves a package specifier through the `exports` map, which is why that subpath carries no `.json`
— oxlint's `extends` is the one that cannot.
:::

:::warning
Every member with source needs a `test` script. The gate runs
`bun run --filter '*' --if-present test`, so a member without one is **skipped silently**, not
reported.
:::

:::warning
Every member's `test` script passes `--fsModuleCachePath node_modules/.vitest-cache`, and a new
member copies it. Vitest 5 caches transformed modules on disk by default (`fsModuleCache`), in one
directory at the workspace root's `node_modules/.vitest-cache`, and a run that finds the lockfile
hash changed deletes that directory whole. The gate runs the members' tests side by side, so after
an install one member's delete races another member's writes and fails the gate with
`ENOTEMPTY: directory not empty, rmdir node_modules/.vitest-cache` (measured: 1 of 6 gate runs
with the stored hash staled). The flag resolves against the member's own root, so each member
clears and fills only its own cache (measured: 12 of 12 runs with every member's hash staled).
:::

:::warning
A member is created together with its first source and its first test, never empty: `tsc` fails an
`include` that matches nothing (TS18003) and `vitest run` exits 1 when it finds no test files (both
measured). A placeholder file or `--passWithNoTests` would make the gate pass on a package that
checks nothing, so the package waits for the work that gives it code.
:::

A member exports leaf modules, never an index: `"exports": { "./*": "./src/*.ts" }`, so a consumer
writes `@crook/domain/Ids`, the same leaf-only rule the `effect` imports follow. The member's own
tests import it through that specifier too; the package resolves itself through its `exports`
(measured).

A helper only tests import is a fixture of the member that owns it, not a module under `src`. A test reads a transcript the way the agent does, by following it up to its caught-up mark, so it runs the path that ships and the transcript tail keeps no reads only tests made.

A fixture that another member's tests read stays in the member that owns it, exported as
`"./fixtures/*": "./test/fixtures/*"`, and the reader turns it into a path with
`new URL(import.meta.resolve('@crook/<member>/fixtures/…')).pathname`, which resolves under
`bun --bun vitest` (measured). A copy drifts from the capture it was taken from.

:::warning
A service's own `layer` leaves what the service depends on open: no service wires another one in.
Each app wires its graph once, at its edge, in named stages, and exports the stages its tests
reuse, so a test builds a real service over fakes of exactly what that service needs. A layer that
takes values rather than services, such as a root path or a store, still sits beside its service,
since it configures the service and wires nothing.

Services used to come in pairs: a `layer` that provided its own dependencies, and an open twin for
the tests that needed a fake. A dependency provided inside a layer stays the one it gets even when
a test provides another around it (measured), so every service a test wanted to fake grew a twin,
and one nobody had faked yet could only be tested over the real thing. Effect's own janitor app
keeps every layer open and wires once at the edge, and the twins went with that.

An app's entry runs the moment it is imported, so its stages live in a module beside it and the
entry only launches the result, which is what lets a test import them. The routes are a service
like any other and leave what they read open: the hub had its graph half in the routes and half in
its entry, and its fixtures declared a stage of their own.
:::

## Rules

Leaf imports only: `effect/Effect`, `effect/cli/Command`.

:::warning
Every barrel is banned — the `effect` root AND each subpath index (`effect/rpc`,
`effect/testing`, …). The subpath ones are what keep getting written. Enforced by a regex in
`no-restricted-imports`: a barrel is the bare root, `effect/testing`, or a single lowercase segment
under `effect/`, since every leaf module is PascalCase. Type-only imports are exempt.

Since `effect@4.0.5` the former `effect/unstable/*` modules sit directly under `effect/`
(`effect/rpc/Rpc`, `effect/cli/Command`) and `effect/unstable/*` is no longer exported (measured).
The same release made the `Config` constructors PascalCase (`Config.String`, `Config.Int`;
`Config.string` is gone), and a `Config` is itself an `Effect` (both measured).

`@effect/platform-bun` has a barrel root too; import its leaves (`@effect/platform-bun/BunSocket`).
**Not enforced**: the regex only knows `effect`.
:::

:::warning
A field that travels on the wire gets no `Schema.withConstructorDefault`, not even to spare other
fixtures an edit. The default lets a real producer forget the field and still typecheck, so the
missing data ships as the default. Add the field everywhere it is built instead.

Copying a `Schema.Class` instance with one field changed is `new X(Struct.evolve(x, { field: … }))`:
a spread of the instance is `typescript(no-misused-spread)`, and `Struct.evolve` copies the own
enumerable fields, which are the schema's (measured).
:::

:::tip
An app reads its own version with `import packageJson from '../package.json' with { type: 'json' }`.
The house tsconfig accepts it without `resolveJsonModule`, and Bun runs it (both measured). A
relative path inside one member is fine; the package-specifier rule is about reaching another one.
:::

The ping, the open timeout and the reconnect policy belong to a link, the agent's and the phone's alike, so they sit apart from the agent's RPC group under names that say so. None of them travels.

:::warning
Never read `_tag`. A read keeps compiling when a variant is added, so the new case goes unhandled.
Use `Match.tagsExhaustive`, so a new variant fails to compile, then `Match.tag`/`Match.tags`, a library
guard (`Cause.isTimeoutError`, `Exit.isFailure`, `Result.isFailure`), or `instanceof` where the module
instance is shared. Privacy isn't the argument: Effect declares `_tag` as a schema field and reads it
in its own docs. `Match.orElse` gives up exhaustiveness as well, so reach for it only where a new
variant really belongs in the fallback. Enforced: `begone-slop/no-tag-access`.

A predicate is one of two things. One that decides something about every variant, such as which
blocks a person typed, what starts a turn, or which failures retry, is exhaustive: the new variant
needs that decision. One that only asks whether a value is one named variant is `Schema.is(X)`, which
works on a tagged class and a tagged error alike, and needs no fallback at all.

Nested `reason` unions too — `SqlError`/`AiError` put the variant in `reason`, out of the failure
channel, so `catchTag` misses it.
Replacements per `references/core/error-handling.md`: `Effect.catchReason`, `Effect.catchReasons`,
`Effect.unwrapReason` + `catchTags`, or `Match.value(error.reason).pipe(Match.tagsExhaustive({…}))`.
Disable-comment only after all four fail; say which in the comment.
:::

:::warning
The other half of that: every error a call can produce in practice belongs in its **type-level**
error union, as a tagged error. Catch-all and `unknown`-shaped errors exist to SURFACE a gap, never
to be handled — catching one buries the missing case instead of naming it.

**When `Effect.catchTag('X', …)` refuses to typecheck, that is the signal**, not an obstacle. The
union is missing the error. Widen it where it is produced — the schema, the service signature, the
wrapper that swallowed it — and never loosen the catch to meet the code:

- structural probing — `Predicate.hasProperty(error, '_tag')`, `'code' in error`
- widening casts — `(error as { _tag?: string })._tag`
- catching a catch-all, then re-narrowing it by `status`/`code`/`message`

Only the second is machine-checked (it ends in a `_tag` read, so `begone-slop/no-tag-access`
rejects it — measured). The other two read as ordinary code; they are on you.

`Effect.retry`'s `while` takes a plain predicate, with no tag-based variant, so it gets one of those
two, and neither is a licence to read `_tag`.
:::

:::warning
Error schema fields must not shadow `Error`'s own. Fields are assigned onto the instance, so a `name`
or `stack` field replaces what identifies the error as an error — `Cause.pretty`, `String(error)`,
the stack header, OTLP `exception.type`/`exception.stacktrace` all read it (measured). Name for what
it holds (`userName`), not where it sits. `message`/`cause` stay legal.
Enforced: `begone-slop/no-shadowed-error-field`.
:::

:::warning
Railway oriented programming, everywhere — the lint rules and any tooling too, not just Effect code.
A computation is a chain of `Option`/`Result`/`Effect` combinators that short-circuits, not a ladder
of guards feeding a `let`. `Option.liftPredicate` to get onto the track, `filter`/`map`/`flatMap`
along it, `getOrElse`/`match` to get off. A running accumulator is `Arr.scan`, not a mutable one.

Type narrowing is NOT the failure track. `if (node.type !== 'CallExpression') { return Option.none() }`
at the head of a function is a guard, and routing it through combinators makes it worse. The rule is
about the value flow; it does not ban `if`.
**Not enforced**: no rule can tell a guard from a fold. Review catches this one.
:::

:::warning
Locality of behaviour: what belongs to a thing lives beside it. A schema's derived type is declared
next to the schema and shares its name — `const Spec = Schema.Struct({…})` then
`type Spec = typeof Spec.Type` — never gathered into a types module.

This is why `statement-order` leaves a type alias containing `typeof` unranked: type-defs otherwise
sort above constants, which would force every schema type away from its schema.
:::

- Errors are `Schema.TaggedError` with an `override get message(): string`: full sentence, names the fix where
  possible. One reporter prints `error.message`; an error without one exits silently.
- Module-level primitive constants are `SCREAMING_SNAKE_CASE` — they are the knobs and magic values,
  and the casing separates them from computed bindings. **Not enforced**: oxlint has no
  `naming-convention`, and the type filter that made the ESLint rule precise needs type info. Review
  catches this one.
- Descriptive, boring names. Long over clever. No abbreviations needing a decoder.
- Temp work in `tmp/` (gitignored), never `/tmp`.

:::warning
Code carries no comments. A name that needs a sentence beside it is the wrong name; a block that
needs one wants extracting. Enforced: `begone-slop/no-comments`.

The knowledge does not evaporate — it moves into this file or an area's rule file, as a decision, a lesson learned or an
invariant worth stating. An entry here names no file, symbol or line: those rot, and an entry pinned
to a line is a comment with extra steps. Write what was decided and why it held.

Two exceptions, both narrow. A `SAFETY:` comment is required beside every type assertion and is the
only prose the rule admits. Tooling directives — `oxlint-disable`, `@ts-expect-error`, triple-slash
references, shebangs — are not comments, and the rule leaves them alone.

A number you write anywhere must be one somebody measured. If you are reaching for a plausible one,
you do not have the fact yet.
:::

`begone-slop`'s `preset.json` carries the severities and is what `.oxlintrc.json` extends — it is
the list of what is on, so read it rather than restating it here. Its `README.md` describes every
rule.

The ones with behaviour worth knowing before you trip on them:

- `statement-order` — imports > type-defs > constants > functions > variables > modules > exports.
  Single-line `SCREAMING_CASE` constants form two groups, private above exported, no blank line
  inside a group and one around it. A private one may sit below an exported one only if it reads it.
- `statement-order` ranks a module-level `SCREAMING_SNAKE_CASE` array or `Map` with the single-line
  constants, so a private one sits above the exported group like a primitive does (measured).
- `expect-padding` — a run of `expect()` is ONE block: blank line around it, none inside. Applies to
  test files only, via an `.oxlintrc.json` override.
- `padding-line-between-statements` — the vertical-spacing spec, ported from `@stylistic`; oxlint has
  no equivalent. The spec stays declarative in `begone-slop`'s `preset.json`, as ONE array
  argument — the rule reads `options[0]` only — which oxlint validates against the rule's JSON
  `meta.schema` before the rule runs.
- `no-tag-access` — no `x._tag`, `switch (x._tag)`, `const { _tag } = x`. Defining a tag is fine.
- `no-shadowed-error-field` — no `name`/`stack` field on `Schema.TaggedError`/`Schema.Error`
  (measured on `begone-slop` 0.2.11; `TaggedErrorClass` isn't in Effect 4.1.2). tsgo's
  `error-payload-shadows-name` reports the same field.
- `no-comments` and `require-safety-comment-for-type-assertion` are one doctrine in two rules: prose
  is banned everywhere except where an assertion demands it.

## Probes

:::warning
A probe that starts a real Claude closes its pane, stops its named herdr session and deletes it in the same command that started it, never in a later one. A run cut off between the two left 19 Claudes running for about 11 hours and ran the laptop out of memory (measured). Deleting matters as much as stopping: the session file keeps the agents herdr started, so the next `server` on that name may bring them back (inferred, not measured). Start one real Claude at a time, never from a loop, a retry or a test, and use `herdr pane report-agent` whenever the state is all the probe needs.

A real Claude under a temporary `CLAUDE_CONFIG_DIR` has no login. The two spikes that needed one copied the `claudeAiOauth` entry of `~/.claude/.credentials.json` there and deleted the copy at teardown, in the same command that started the Claude (each run took about 40 s, with over an hour left on the access token). That entry also carries the refresh token, so a copy that outlives its run is a leaked login: drop `refreshToken` from the copy, check the access token has longer left than the run, and delete the copy in that same command.
:::

## Establishing a fact

Do not guess about Effect, oxc or Bun. Do not trust a plausible claim in a review.

:::tip
1. Read `node_modules/effect/src/**` — ground truth for API shape, and grepping it settles "is this
   idiomatic" (e.g. `S["Type"]` appears 98 times in `Schema.ts`). Before anything depends on
   `effect`, the hoisted copy is the same source: `node_modules/.bun/effect@*/node_modules/effect/src/**`.
   For oxlint and oxfmt, `node_modules/{oxlint,oxfmt}/configuration_schema.json` is the authoritative
   list of every option and rule — better than the docs, and it is what shipped.
2. Probe behaviour — throwaway `__probe.ts` in `tmp/`, run with `bun`, delete after. Probing oxlint
   is the exception: it skips gitignored paths, and `tmp/` is gitignored, so it reports "No files
   found to lint" (measured — it does this even with `--no-ignore`, and even for a project nested
   under the ignored directory). Probe it from a directory outside any ignored tree.
3. Record it here or in the area's rule file — never as a comment; `no-comments` rejects one anyway.
:::

:::warning
`src/` also carries `@internal` exports that the shipped declarations strip, so a name found by
grepping it can still fail to typecheck. `Schema.UnknownFromJsonString` is one, and
`effecttsgo/prefer-schema-over-json` suggests it in its message anyway; the public spelling is
`Schema.fromJsonString(Schema.Json)` (both measured on `effect@4.1.2`). Check a name found in `src`
for `@internal` before building on it.
:::

## Pull requests

Conventional-commit format for the PR title AND every commit subject: `fix(lint): …`,
`feat(tsconfig): …`, `docs: …`.

The description documents the change, nothing else:

- The summary is plain prose at the very top — no heading above it, no `### Summary`. The PR title
  is already rendered; do not restate it.
- Smallest heading allowed is `###`, and only when the description genuinely splits into sections.
  Never `#` or `##`.
- Prefer a code snippet to a paragraph. A ` ```ts ` or ` ```diff ` block showing the new shape beats
  prose describing it; add prose only for the "why" a snippet cannot carry.
- Cut anything that restates the diff, and anything that reads like marketing.
- **Never** a "Test plan", "Testing", or TODO checklist. Skip examples entirely for trivial fixes,
  internal refactors and doc-only changes.

Outstanding work, manual verification or review items do NOT go in the description or a comment.
Mark the PR **draft** and say what is outstanding in the chat that asked for it.

:::warning
Write the body to a file and pass `--body-file`; never inline it:

```sh
gh pr create --body-file tmp/pr-body.md   # write it with Write, not a heredoc
```

`--body "$(cat <<'EOF' … EOF)"` mangles backticks and backslashes in some shell/`gh` combinations —
inline code spans arrive as literal `` \` ``. `--body-file` sidesteps shell quoting entirely. If
`gh pr edit --body-file` silently no-ops on an older `gh`, fall back to
`gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@tmp/pr-body.md`.
:::

## Changing this file

Where review feedback gets settled once instead of repeated.

Trigger: repetition, or obvious generality. Asked twice = already a pattern, codify then. A first
request that is plainly general (`never read _tag` is about every file) gets promoted immediately.

Strongest enforcement available, in order:

1. An oxlint rule — machine-checked, cannot drift, often auto-fixable. Prefer a built-in; add a
   `begone-slop` rule, in its own repo and with its own tests, only when oxlint has none.
2. A line here, when it holds everywhere, or in the area's file under `.claude/rules/` when it
   holds in one part of the repo — every agent reads it, but prose can be misread. A one-off
   measured fact goes in the area's file, stated as a fact rather than a rule. A new area gets a
   new file, with `paths` that match where the work happens, and a row in the table above. Never a
   comment; `no-comments` rejects one.

Codify in the same change as the fix, never "later"; a pattern living only in a conversation dies
with the session.

:::warning
Rules are not immutable. When the user contradicts one, fix the rule — do not special-case the call
site. `expect-padding` was built from a misread brief and had to be inverted; that was a bug in the
rule, not licence for an exception.
:::

Do not over-codify. A preference about one file, or a judgement needing taste, is not a pattern.
