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

The `effecttsgo/*` Effect rules come from two `@effect/tsgo` presets that `.oxlintrc.json` extends:
`recommended` and `effect-native`, which bans the globals Effect replaces — `process.env`, the
global `console`, `Date`, `fetch`, timers, `new Promise`. `recommended` carried those itself until
tsgo moved them out, so a bump that only follows `recommended` silently drops them (measured going
from 0.36.1 to 0.64.1). They are type-aware, and the presets turn type-aware mode on — which is why
no `--type-aware` flag appears in the scripts.

The tsgo rules that are off say why beside themselves in `.oxlintrc.json`. Two are off because
their quickfixes write what begone-slop rejects: a map to `undefined` becomes `Effect.asVoid`, and a
catch returning `Effect.void` becomes a log-less `Effect.ignore`. `unstable-api-usage` is off
because crook is built on the modules Effect tags unstable — the platform services, SQL, RPC, atoms
and `@effect/vitest` — so it flagged every use (1,679 on the bump) and could single out none.
Schema classes carry no brand: the language-service plugin limits `brandedSchemaClasses` to
`Error` and `Opaque`, since a tagged class's literal `_tag` already keeps two classes apart and a
plain `Schema.Class` here is a wire shape decoded at a boundary.

oxlint's `promise` rules decide whether `x.catch(…)` is a Promise call by looking at the receiver,
and they treat a namespace import as one that might be a Promise. So `Effect.catch` and
`Stream.catch` count as Promise chains (measured on oxlint 1.90.0). `prefer-await-to-then` reports
each one that isn't under a `yield` or an `await`, which is why it's off. `valid-params` is a
correctness rule and stays on, but it rejects the data-first `Effect.catch(self, handler)` as a
`Promise.catch()` with two arguments, so use the pipe form. Never rewrite a catch into something
else just to get past either rule.

The preset ships most of them as `warn`, so every lint invocation passes `--deny-warnings`: a
warning that cannot fail the gate is one nobody fixes. Downgrade individual rules in
`.oxlintrc.json` rather than dropping the flag.

`.oxlintrc.json` also enables oxlint's own `correctness`, `suspicious` and `pedantic` categories.
Pedantic is the one that bites, because its size and shape caps were written for ordinary
TypeScript rather than for this style. `max-classes-per-file` is off for exactly that reason: one
tagged error class per failure reason is the error doctrine here, so a module that can fail two
ways already declares two classes, and a service tag makes a third. A cap of one never shrinks a
module — it scatters one concern across several files and leaves the import graph with nodes that
exist only to satisfy a linter. Its sibling `max-lines` is raised from a default of 300 (measured) to 1000, for the same
reason: a line cap relocates code rather than shrinking it, and a module split to sit under
one is a module the graph did not ask for.

:::warning
`prepare` runs `effect-tsgo patch --oxlint`, which patches the oxlint and TypeScript binaries in
`node_modules`. Without it the Effect rules do not run. It is not optional and it re-runs on every
install — do not "simplify" `prepare` down to `husky`.

It also validates that `oxlint`, `oxlint-tsgolint` and `@effect/tsgo` are a supported triple, so
bump the three together. tsgo 0.58 added `effect-tsgo oxlint` and `effect-tsgo tsc`, which run
patched binaries without touching `node_modules`; crook still patches, since editors and plain
`tsc` launch the stock binaries.

Any reinstall reverts the patch, and `prepare` then refuses to redo it because its backups still
exist — `Unknown plugin: 'effecttsgo'` is what that looks like. Run `bunx effect-tsgo unpatch
--oxlint` first, then `bun run prepare` (measured, twice).
:::

:::warning
`typescript`, `oxlint`, `oxlint-tsgolint` AND `@effect/tsgo` itself are pinned EXACTLY (no `^`).
`@effect/tsgo` ships prebuilt artifacts for specific builds of the other three and fails with
`ReplacementUnavailableError: Missing packaged artifact` against any other one. Bump them with
`@effect/tsgo`, or not at all; its README lists the versions each release supports.

The caret is the trap, not the version: `@effect/tsgo@0.36.1` carried oxlint artifacts for `1.76.0`
and `1.77.0` only, so `^1.77.0` resolved to `1.78.0` on a fresh install and the patch died
(measured). A caret on `@effect/tsgo` is the same trap from the other side: a release that drops the
pinned oxlint build is one install away. A committed lockfile hides both until someone clones
without one.
:::

Effect diagnostics are reported by oxlint only: the shared base configures the language-service
plugin with `diagnostics: false` so they do not appear twice. That block inherits through `extends`
— measured, along with the fact that a child config can set `diagnostics: true` to get the compiler
reporting them again. `tsc --showConfig` omits the plugin block, so it cannot confirm either; a
floating Effect under `tsc --noEmit` can.

The published base follows <https://www.effect.solutions/tsconfig> minus what a no-emit Bun project
cannot use, and `begone-slop`'s README lists what it keeps. It carries no plugin block. Everything
local to this repo lives in `packages/tsconfig/base.json`, which today is `types: ["bun"]` and the
language-service plugin entry.

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

A helper only tests import is a fixture of the member that owns it, not a module under `src`. A test reads a transcript through the follow the agent runs, up to its caught-up mark, so a read the app never made did not have to stay on the service for them.

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
The `effect-best-practices` references still spell the old paths; drop the `unstable/` segment.
The same release made the `Config` constructors PascalCase (`Config.String`, `Config.Int`;
`Config.string` is gone), and a `Config` is itself an `Effect` (both measured).

`@effect/platform-bun` has a barrel root too; import its leaves (`@effect/platform-bun/BunSocket`).
**Not enforced**: the regex only knows `effect`.
:::

:::tip
Arrays have no `.pipe`. Chaining `effect/Array` calls, which `begone-slop/no-nested-effect-array-methods`
asks for, goes through `pipe(xs, Arr.map(…), Arr.prependAll(…))` from `effect/Function`. Several layers
feeding one go in a single `Layer.provide(target, [a, b, c])`, which is what
`begone-slop/no-cascading-layer-provide` wants.

A data-last combinator stored in a variable before it meets its input — `const retry = Effect.retry({ … })`
— infers `unknown` for the error, and `effecttsgo/any-unknown-in-error-context` reports every effect it
touches. Apply it inline (measured).

`Stream.zipLatestAll` emits nothing until every input has emitted once, so an input that waits
for something to exist, such as a folder Claude has not made yet, silences the whole stream
(measured: a watch of background work hung until it read the current state up front and emitted
it).

`Effect.filter` with an effectful predicate and a `concurrency` option returns what it keeps in
the order the predicates finished, not in input order (read in `effect@4.0.5`'s source; a test
saw a sorted list come back shuffled). Where order matters, `Effect.forEach` into `Option`s and
`Arr.getSomes` keeps it.

A fiber forked into a scope that closes before the fiber first runs never runs any of its effect
(measured: a step forked from inside a `forkScoped` fiber never started when the session scope
closed right after the fork). Work that must happen once it is accepted is forked into the scope
that owns it directly, by the fiber that accepted it, and only the follow-up goes in a child.

An `Effect<A>` is assignable to `Effect<void>`: a service method typed `Effect<void>` accepts
`Queue.offer(…)` or `Effect.forkIn(scope)` as they are, and `begone-slop/no-effect-asvoid` rejects
the `Effect.asVoid` that would only satisfy the signature (measured: removed in three places, the
typecheck still passed).
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

:::warning
The agent and the hub release under one version and bump together. The phone compares an agent's
version with the hub's to offer "update agent", so a hub-only bump would flag every machine though
no newer agent exists. Versions stay plain `major.minor.patch`: the hub reads its own strictly, so
its tests fail on anything else, and an agent version it cannot read shows as no version rather
than keeping the machine offline.

A bump writes the version into every `package.json`, the root's and the workspace entries in the
lockfile included, and into the herdr plugin's manifest, which a test holds to the agent's
version. Run the gate on the bump commit before pushing its tag: `check-version` reads only the
two apps, so a tag pushed after it alone failed the release gate on the manifest (measured).
:::

:::caution
`tsc` clean is not lint clean. oxlint's type-aware pass typed an `Effect.all` over a record of
effects, each wrapped in its own `catchTags`, as `any` in the error channel while `tsc` typed it
fine; the same two effects joined with `Effect.zipWith` typed fine under both (measured). When
`any-unknown-in-error-context` fires on code `tsc` accepts, split the expression before blaming
the code.
:::

:::tip
`@effect/vitest`'s `layer(L)(name, (it) => …)` hands out an `it` without `.live`. A test that needs
the real clock or real IO (sockets, temp dirs) passes `layer(L, { excludeTestServices: true })` and
keeps writing `it.effect`.

A test that moves the `TestClock` past an effect which does real IO first, such as a launch that
stats its folder, waits for a sign the IO is over, like the request the effect sends next, before
it adjusts. Otherwise the adjust can run while the IO is still out, and the sleep registered after
it never wakes. Two such tests failed only with every member's suite running at once, in CI and
locally, and passed alone (measured).
:::

:::warning
`Effect.provide(layer)` builds the layer for that one effect and closes it when the effect
returns. A client built that way, such as an `RpcClient` over a socket protocol, loses its
connection the moment its constructor returns and never dials (measured). Build the layer into
the scope that should own it, with `Layer.build`, and provide the resulting context.
:::

:::tip
`Queue.fail` lets a consumer take everything buffered before it sees the failure, so failing a
queue to end a stream drops nothing already queued (measured). `Stream.runCollect` over that stream
still reports only the failure, so a test that needs the items as well collects them with
`runForEach`.
:::

:::tip
A parked `Queue.offer` is resumed synchronously inside the call that takes its message: the queue
resumes it through `Effect.callback`, which runs the offerer's fiber in place. What the offerer
does next has already run by the time the taker resumes, unless its op budget runs out right
there, so a test cannot slip an interrupt between the offer and its next step (measured on
`effect@4.0.5`). Guard such a gap by making the consumer idempotent, and test that part on its own.
:::

:::caution
`promise/prefer-await-to-then` reads `Stream.catch(…)` and `Effect.catch(…)` as promise chaining and
rejects them, except inside a `yield*` expression, where it stays silent (measured). Writing the
pipeline as the body of an `Effect.fn` generator, `return yield* stream.pipe(Stream.catch(…), …)`,
is honest code that passes; do not spell the catch as a `catchTags` list to dodge it.
:::

:::tip
Every end of an effect `Socket`, a clean close included, surfaces as a `SocketError` whose reason is
`SocketCloseError` (read in its source; a peer's FIN is code 1000). A stream that should simply
end there catches that reason with `Stream.catchReason(…, () => Stream.empty)`, inside a
`yield*`; `begone-slop/no-silent-error-swallow` rejects the `Effect.catchReason` that returns
`Effect.void` (measured).

A socket server built without `allowHalfOpen: true` closes a connection the moment it reads the
client's end, before its handler has done anything with the bytes; with it, the connection closes
when the handler's scope does, so a client that waits for the close knows the handler finished
(measured: a handler sleeping 300 ms held its client 312 ms with it, 11.5 ms without). The handler
acquires the reader in its own scope (`Socket.readerBytes`) for that to hold; `Socket.toStream`
scopes the reader to the stream and closes the connection when the stream ends.
:::

:::warning
An effect `Cache` lookup that every caller abandons is interrupted and dropped from the cache, so
the next `get` runs it again (measured). Where running twice is the bug — anything that types into
a terminal — make the `get` uninterruptible, so a started lookup always finishes and is remembered.
:::

:::tip
`Stream.switchMap` interrupts the previous inner stream and waits for it to end before it starts
the next (read in `Channel.mergeAll`), so the next stream can undo what the previous one wrote, such
as a cache it saved into, without racing it (measured: a test that fails with the steps reordered).

An effect made uninterruptible still times out. `Effect.timeoutOrElse` races it in forked children
that are interruptible whatever the parent is (read in `raceAllFirst`), so a step that must finish
once started can be uninterruptible and stay bounded by its own timeout.

An `Atom.fn` result outlives the component that showed it. A sheet that must open clean writes
`Atom.Reset` through `useAtomSet` when it opens, and skips it while the call is in flight, since a
reset interrupts the running effect.
:::

:::warning
Effect's `Semaphore` is not fair (read in its source, measured on `effect@4.0.5`): a release wakes
the waiters on a scheduled task, so a fiber that takes the permit again right after releasing it
gets in first. A loop of instantly answered long polls starved another caller for 300 test-clock
seconds. Where several fibers share one permit and one of them loops, hand the turn to the oldest
waiter explicitly.
:::

:::tip
A `Result` is not yieldable inside `Effect.gen` in `effect@4.0.5`, whatever the
`effect-best-practices` table says (measured: a type error). Lift it with `Effect.fromResult`.

`Effect.andThen(effect, f)` runs what `f` returns as an effect: an `f` that only does a side
effect and returns nothing dies with `Not a valid effect: undefined` (measured on `effect@4.0.5`).
Write the step in an `Effect.gen` body, or map with `Effect.map`.

`Arr.filterMap` takes a function returning a `Result`, not an `Option`, in `effect@4.0.5` (measured: a
type error). Keep an `Option` pipeline on `Arr.flatMap` or `Arr.getSomes`. `Arr.replicate` and
`Arr.makeBy` clamp the count to at least 1 (read in their source), so a count that can be zero is
guarded before the call.

`RpcTest` wires client to server without serialization (read in its source), so it cannot catch a
wire type that fails to encode. Round-trip such a schema through
`Schema.fromJsonString(Schema.toCodecJson(schema))`, which is the codec the NDJSON serialization
uses, or test over a real socket.

A socket handed to an effect socket server's handler writes nothing until the handler has acquired
its reader: the writer waits on a latch the reader opens (read in the platform source). A Unix-socket
server that answered as soon as a client connected, then closed, made a Bun client's connect fail
with `ECONNRESET` on most attempts (measured, Bun 1.4.3). The client sends its request first, and
the server answers once it has read it.
:::

:::warning
A `Stream` piped through `Socket.toChannel`/`toChannelString` closes the socket's write side when the stream ends. A server that treats a half-closed client as gone (herdr does) drops the request before answering, so a request-reply over a socket sends its line with `Stream.concat(Stream.make(line), Stream.never)` and stops at the first reply (measured). The tail belongs inside the one function that opens the connection, never at each call site, where the next caller forgets it.
:::

The ping, the open timeout and the reconnect policy belong to a link, the agent's and the phone's alike, so they sit apart from the agent's RPC group under names that say so. None of them travels.

:::tip
A member that runs on Bun and touches Bun-only APIs in tests (`BunHttpServer` reads the global
`Bun`) sets its `test` script to `bun --bun vitest run`. Plain `vitest run` runs on Node, where that
global does not exist (measured).
:::

:::warning
An RPC handler's `headers` over a WebSocket are the upgrade request's headers with each call's own
headers merged over them, and the call wins (measured). A client can overwrite any upgrade header
per call, a proxy-injected one included. Identity a proxy vouches for is read once at the upgrade
and bound to that connection, one RPC server per connection, never read back from handler headers.
:::

:::warning
Never read `_tag`. The `_` prefix means private. Use `Match.tag`/`Match.tags`/`Match.tagsExhaustive`,
a library guard (`Cause.isTimeoutError`, `Exit.isFailure`, `Result.isFailure`), or `instanceof` where
the module instance is shared. Prefer exhaustive so a new variant fails to compile.
Enforced: `begone-slop/no-tag-access`.

Nested `reason` unions too — `SqlError`/`AiError` put the variant in `reason`, out of the failure
channel, so `catchTag` misses it and some `effect-best-practices` snippets write `error.reason._tag`.
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

`Effect.retry`'s `while` takes a plain predicate, with no tag-based variant, so the tag-free form is
`Match.value(error).pipe(Match.tag('X', () => true), Match.orElse(() => false))`. Verbose, and still
not a licence to read `_tag`.
:::

:::warning
Error schema fields must not shadow `Error`'s own. Fields are assigned onto the instance, so a `name`
or `stack` field replaces what identifies the error as an error — `Cause.pretty`, `String(error)`,
the stack header, OTLP `exception.type`/`exception.stacktrace` all read it (measured). Name for what
it holds (`userName`), not where it sits. `message`/`cause` stay legal.
Enforced: `begone-slop/no-shadowed-error-field`, but only on the pre-4.0.5 class names (see below).
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

The knowledge does not evaporate — it moves into this file, as a decision, a lesson learned or an
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

:::warning
That preset sets `"plugins": []`. Without it, extending the preset re-enables oxlint's own default
plugin set (`unicorn`, `oxc`) on top, which fails the gate on rules nobody chose (measured: 7
reports). If you want those plugins, name them in this repo's own `plugins` array — later config
wins.
:::

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
- `no-shadowed-error-field` — no `name`/`stack` field on `TaggedErrorClass`/`ErrorClass`. It does
  not know `effect@4.0.5`'s names yet: in 4.0.5 the classes are `Schema.TaggedError` and
  `Schema.Error` (`TaggedErrorClass` is gone), and the rule stays silent on a `name` or `stack`
  field there (measured). The fix belongs in `begone-slop`; until it ships, this one is on review.
- `no-comments` and `require-safety-comment-for-type-assertion` are one doctrine in two rules: prose
  is banned everywhere except where an assertion demands it.

:::caution
oxlint's JS plugin support is **alpha and explicitly not semver-bound** (per its shipped config
schema). Every one of those rules rides on it, so an oxlint upgrade can change their behaviour
without a major bump. The plugin's own test suite is what catches that — after bumping oxlint here,
bump and test it there too rather than assuming the pair still agree.
:::

## State machines

:::warning
A UI state with more than one way in or out is a machine, and every machine has one shape. Plain
reducers, no library: a `Schema.TaggedUnion` of states, one of events, and a total
`transition(state, event)` written with `Match` that returns `[state, commands]`. Thread scroll and
the pushed-screen and covered flags stay out on purpose: they write to the DOM per frame and are
heavily measured, so their frame-level writes do not belong in a table.

Commands are data and `transition` runs nothing, so the table is what a test walks. Whatever drives
the machine runs each command and feeds the event it returns back in. An atom drives a machine whose
inputs are atoms, and it runs commands through an `Atom.fn` on the hub runtime, one at a time, so a
new command interrupts the one running, and such a machine's walk holds each step to one command. A
service that owns the connection drives its own machine the same way, through its state's ref, with
the commands' fibers in the scope they belong to.

A state that waits on a command carries a token, a counter or whatever already names what it waits
for, the command and its finished event carry the same one, and `transition` drops a finished event
whose token is not the state's. Interrupting is not enough: a state that moves on without starting
another command leaves the old one running to its end. A timer forked into a scope that ends with
what it waits for needs no token, which is the one exception: a link's notice timers die with their
session.

Every machine has a walk, used from a test: the events to try from each state, a stale token
included, the invariants of a state, the rules of an arrow, the states it must always be able to get
back to and the ones it may end in. The walker reports a broken invariant or arrow with the shortest
path to it, a transition that throws or returns what the schema refuses, a state nothing reaches, a
state that can no longer get home, an event nothing tried and a state space that keeps growing, and
its own test shows each one failing. Two states that differ only by a token are one state: the
walk's identity drops it, or a counter makes the walk endless. The walk gives up at 256 states, a
guard and not a measurement: the machines here have 10, 11, 8, 117, 6, 6, 3 and 3 (measured), so reaching it means a
token got into a state's identity.

The shape and the walker live in a member of their own, which the phone and the hub both depend on, so an app reaches no other app for code it runs. The hub's first machine imported them from the phone's member. They were pure, so nothing broke, but the graph lets an app be read only for a value both sides must agree on. They stayed out of the domain member because there a machine means a laptop, and a domain leaf with that name would read as one, which is also why their member's name says state machine in full. The machines themselves stay with their apps, and so does whatever drives one through atoms. The compiled hub takes the shape and leaves the walker, which only charts and tests import (measured in its bundle's inputs).

The element that shows a machine carries `data-machine` and `data-state`, the state's name, read
through the union's guards since `_tag` stays unread. The frame tool's mark table is the one place
that says which selector means which state: a mark on a machine names the machine and its states,
and a test holds those names to the machine's table, so the table, the stories and the frames share
one vocabulary. A state with no mark can still be named: the frame log records every machine's state
per frame and the contact sheet prints it, and a state that shows nothing, such as a quiet redial,
therefore cannot fail as a flash. A generated Mermaid chart sits beside the machines, regenerated
with `bun run charts`, and a test holds it equal to the table. Plain Mermaid over `/statechart`:
that skill model-checks a separate TLA+ spec, a second copy of the table that needs Java and TLC,
while the walker runs the real function.
:::

:::tip
Whether a chat's agent is working is one machine, and the header's word, the Working row, the composer's Stop and the queued label all read one table derived from its state, so a word and a row that disagree cannot be written. Its inputs are the herd and the transcript's turn evidence, and the transcript reaches the screen deferred, so it folds during render over the deferred lines rather than in an atom: the row and the answer that ends it have to commit together, and an atom sits on the latest lines, ahead of the rows (reasoned, not measured). A subagent's screen folds the same machine over its own run.

Before it, each read its own check. The row left whenever the newest item was a running tool and came back on the next line, while Stop went on herdr's word, so a turn with tools showed Stop with no row for 98 to 100 frames, and an answered prompt 51 to 52. The check looked only at the last item, so a running tool grouped under another kept the row beside it for 1415 ms. Measured at 390x844 and 4x CPU throttling in Chromium, three runs each, from each story's first step, a turn with two tools went from 3 row mounts and 3 ghosts to 1 and 1, an answered prompt from 2 and 2 to 1 and 1, and a subagent's turn from 3 and 3, one of each before its first step, to 1 and 1. Layout shift held: 0.0006 and 0.0006, 0.0004 and 0.0004, 0.0039 and 0.0037 to 0.0039. One story gains a shift or two, the header's word changing twice as herdr catches up with an answer.

An answer that lands before herdr's flip off reads as `done`, with Send, and the flip that follows carries no news: the row and Stop leave on the answer. A pane in the focused tab goes to `idle` instead of `done`, so the word there reads `done` for the gap and then changes (reasoned from herdr's states; the gap was 150 ms in a story, not measured on a real pane). A failed watch has no evidence to read, so the row and Stop follow herdr alone beside Try again; before, the row left while Stop stayed.
:::

:::tip
The link's machine knows what it just went through, and the schedule and the page signals tell it what happened; it decides nothing about when to dial. Screens read one tagged view derived from it, and what dims, what is open and what the banner says are each an exhaustive match on that view, so a view that dims without saying why, or stays open while a call would be refused, fails the walk. A cold start used to dim a cached herd for its first second with no banner and paused the composer with it, which the frame tool read as a flash on every launch (measured: 15 frames, 524 to 567 ms). A dial now reads as live.

A call made while the link dials holds in the fiber that made it. It goes out when the new connection has its first herd, and fails when a failure lands on the banner or after the 15 s the hub gives a machine to come back, whichever is first. A dial nobody answers would otherwise hold it for as long as the socket stays unanswered: effect's browser socket holds a write until it opens, with no bound of its own (read in its source).

A herd update from another machine re-rendered everything above the screens, 10 of 10 updates for each of the gate, the shell, the toast host and the action sheets, because the connection view carried the sync time and was rebuilt on every herd. A sync time now sits only in the views that show one, under structural equality: 0 of 10 (measured by counting commits through React's devtools hook in the DOM tests).

React registers with that hook when react-dom first loads, and Vitest leaves `node_modules` out of its module graph, so `vi.resetModules` cannot make it register again: a hook installed in a test file counted nothing (measured). The DOM setup installs it as its first import, before testing-library loads react-dom.
:::

:::tip
A machine's connection blinking is not the machine being gone, and the phone gave the two one look: the card replaced the composer and took the keyboard with it. Measured with a local hub, agent and proxy, from when a phone sees the machine leave online to when it sees it back. A socket dropped from a healthy agent took 25 to 29 ms; one dropped again and again, while the backoff grows, 114 ms to 5042 ms; an agent process restart 219 to 231 ms; a hub restart with 2 s of downtime 215 to 218 ms, and with 6 s 3688 ms; a network blackout of 3 s 17 ms, 7 s 32 ms, 12 s 5418 ms and 20 s 12048 ms, all under the 15 s the hub already gives a machine. So the phone keeps the dock for those same 15 s. The first second of it shows nothing at all, since a healthy machine's single drop never came near it.

A restarted hub lists a machine offline with no reconnecting first (measured), so the phone cannot wait for the hub's word: going from a live pane to offline starts its own grace. It cannot compute that grace from the machine's timestamps either: after a restart they say when the machine was last seen, on the hub's clock. It times it from what it saw, and a machine already offline when the chat opens goes straight to the card.

A send for a machine on its way back holds until the machine is online and the link is up, under one bound, the same 15 s. When the bound runs out with the link up, the call goes out and the hub answers for the machine; with the link down it fails as not connected. Two holds in a row would stack to 30 s (reasoned, not measured). Going back to the chat restarts the wait, since the machine lives only while its chat is open, and a phone that slept through a whole drop gives a machine long gone the same 16 s: nothing it holds tells that from a hub restart.

The card takes the composer's cell at the composer's height, 102 px at 390 and at 430 wide, in light and dark. A machine's name long enough to wrap made it 106 and pushed the dock up 4 px, so the title truncates (measured).

The drop's own time is the token for a wait, so the machine needs no counter: the hub moves it on every drop. A machine sees a herd's reading only when it changes, so offline landing while a drop is still quiet can only be the hub's reconnecting running out, and that goes to the card.
:::

:::tip
A spinner keeps one rule, in one component: it shows a second after a wait starts, and once shown it stays 400 ms and then fades. The second is the link notice's and the 400 ms is the frame tool's limit of 24 frames at 60 Hz, both reused rather than measured anew, and they share one module so they cannot part. A wait over within the second shows nothing and moves nothing: the glyph it stands in for stays where it was, and it takes no room beside a label until it shows. A line that exists only while it waits holds the room from the start, since its words would move otherwise. Before this a Send answered 1.1 s after the tap showed no progress at all, 0 of 280 frames; now it shows 27 frames, 549 ms, with no finding (measured in Chromium at 4x CPU throttling, one run of each). Only the spinner waits: a word such as "Saving…" still changes on the tap, since the tap needs an answer. A state whose own machine has already waited, the banner, the pill, the away card and the pull gesture, draws the bare glyph, with no machine of its own, and shows at once. A spinner whose host goes away with its state goes with it, whatever its hold says: a chat closed from its sheet took its Working row's spinner along after 8 and 13 frames, under the sheet and on its way out, so that story lists it as a finding some runs show.

The Working row owns the only spinner during a tool. A running tool's own row keeps a still dot, so a turn never shows two at once.

A command the hub answered is no longer waited for without end. Once it answers, the herd has 15 s to show the result, the same 15 s the hub gives a machine to come back, since a herd that cannot show it inside that means the machine is gone or the command did not land. The 15 s count from the answer's own time, because the wait's atom lives only while a screen reads it: a sheet reopened after them says so at once rather than starting over. Past that, the action stops reading as underway and says crook sent it and the machine has not shown it. It may still land, so what the herd shows later still finishes it and takes the note away. Before, "Saving…" and "Opening the chat…" were still up after 16 s of a herd that never moved (measured in the story harness). A test notification, which nothing in the herd confirms, reads Sent for as long as a toast shows, 3 s, where it used to stay until the screen left (still up after 6 s, measured the same way). That wait is the same machine, one per command, so it has no element to mark and the note is what shows it. A retry after it takes a fresh key, because the hub replays a known key's receipt instead of acting again. The bound is a context reference with the 15 s as its default, and a story sets its own, because the smoke test plays stories one after another and 15 s each would cost more than the rest of the suite.

A launch's line takes the place of the button below the field, which is disabled throughout a launch anyway, at that button's 44 px, and holds until the chat replaces the screen. Start through to the chat grew the dock 76 px and took it back, 0.0964 of layout shift over 3 shifts; now the dock does not move, and only the line's words do as the chat's button joins them, 0.0011 (measured in Chromium at 4x CPU throttling). The note that the pane has not shown still grows the dock, by 116 px at once.

A new agent's launch keeps one call per attempt, so its bound has one call to read, and the call is no longer tied to the screen (read in the code, not measured). An audit said a failed start could show on a screen opened later because the failure was not gated by its attempt. It could not, by leaving and coming back: the old call's atom went with the screen, and the test that leaves and comes back passes on the old code too (measured). That test holds the behaviour, not a fix.

A command that finishes while a machine's atom computes its first value has no state to step from yet, since the atom has returned nothing. A wait that had already run out finished there: traced, the event reached the dispatch with no value and was dropped, and the action stayed at Sent, read 120 ms later. The atom keeps such events and folds them over its first state before it returns.

A composer's failure has an exit other than the next send. A refused prompt holds while the field holds the words it refused, which the failure itself puts back, and clears once the draft moves on. A refused Stop has nothing to do with the draft: it clears on the next press or when the turn ends. A refused prompt outlives a turn ending, because the words are still unsent. Before, both stayed through an edit or the end of the turn (measured in the story harness). A failure lands one commit after the state that causes it, since those inputs reach the machine from effects: over 5 of 5 refused sends one frame sat between the spinner leaving and the failure line, 37 to 80 ms, showing an idle Send and nothing wrong (measured in Chromium at 4x CPU throttling). That frame stays, since it reads as neither a flash nor a state.

The Background dock and its summary were reported to land apart, the dock on its second tick and the summary on its own timer. They do not: one timer wakes the screen, the dock reads the clock as it renders, and over 4 of 4 runs of a dock that ran its full 14 s the summary's row mounted one frame before the dock began to fade, 7 to 9 ms apart (measured in Chromium at 4x CPU throttling).
:::

:::warning
A lock-screen answer waits for its machine; no timer retries it. The retry it replaced ran every 15 s with no limit and audited each try: 1 row after 5 s, 241 after an hour and 5761 after a day of a machine away, on the hub's real services over a fake Hark and the test clock (measured). Now a machine away for 23 hours costs 0 rows, and the answer costs 1 when its fate is known (held by a test).

The worst bug here is an old answer landing on a new dialog, and an ask id alone cannot prevent it. A dialog read off the screen is named by its fingerprint, so the same dialog asked again carries the same id (read in the derivation), and the agent's own check compares only the id. The old retry also fired as soon as a link was up, before that link had published anything: a command was routed with no state from that connection (measured). So a held answer goes out only over the link that published the state it judged, when that state shows the same terminal, state change sequence and ask id, by the same rule the notification plan judges with, and a test holds that the same id under the next sequence is never answered and raises its own prompt. What is left is a dialog changing in the moment between that state and the keys, which the wire has no field to close.

A machine is back when its newest link has both attached and published, in either order. An agent's session starts its attach and its publishing side by side, so the hub can see either first (reasoned from the session); every session's publishing starts from the current state (read in the agent), which is why this needs nothing new from an older agent. It has to be per link, because a redial overlaps the link it replaces: the hub reads a silent socket as live for seconds after the agent left it, so a machine that merely reads online with a state on file can be holding the dead link's state. A send names the link it judged and is refused as offline if a newer one has attached since, and goes back to waiting. A publish that lands late from an older link changes nothing. A state that cannot tell, herdr lost or a row reading unknown, keeps the wait.

A send that timed out with the link still up is not sent again until a newer state or a new link. The timed-out command is still in that link's queue and the agent replays by key (read in both), so a timer added nothing but rows.

A held answer ends a day after Hark says it was answered, the longest a prompt stays open, and the time comes from Hark's own read, so a restart cannot reset it. A read with no such time starts the day at the read (none measured; the field is optional in Hark's schema). Before there was no end, and an Approve days old could land on a dialog the user had long forgotten. Past that the phone sees what it sees for any refused answer: the prompt reads answered, and the pane reads needs you once its machine is back.

The answer was already durable, and stays so without a new table: it lives at Hark, and the sent notification's row says to read it again after a restart (measured: a restart of the old hub routed it once the machine attached). The audit table is what says it concluded, so a restart neither sends nor audits again. A row saying offline or timed out concludes nothing, which is what an older hub's retries left behind (a test seeds them). A hub stopping writes no row for an answer still held or still out, since the restart resumes it.

This is a machine rather than one effect because it has six ways out, a delivery, a refusal, a state that moved on, a withdrawal, an age limit and a send that may not have landed going back to waiting, and the rules worth holding are about arrows: a send only from a hold on that hold's own open, one fate recorded on the way into the end, nothing after it. Whatever watches the link or the clock is one fiber per hold, in a scope that ends with the answer, inside the notifier's scope.
:::

## Web

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
- A live batch lands without a fade of its own: the lift that carries it into view is the one
  animation, and the Working row it replaces leaves as a ghost on the exit token.
- What a failure says to the phone and what an operator needs are two texts. A failure's message is
  what happened and what to do, in words, with no pane id, ask id, idempotency key, env var or
  database text, and its fields stay on the wire as they were, since older phones and agents decode
  them. A disk failing under the hub reads "could not save that" on the phone, and the database's own
  words and the setting to check go to the hub's log as it refuses the call.
- A session can hold lines and no rows: of the real transcripts in the catalog, three hold only
  redacted thinking, entries a newer Claude wrote, or notices for runs outside the slice. Those read
  as nothing crook can show, not as no messages, because the second says something untrue about the
  session. Thinking itself draws nothing, on purpose.
- A subagent run that started, with its session gone idle and no roster to say otherwise, has
  nothing vouching for it: the dock read "1 running 15d" on a real transcript. It reads as
  unconfirmed there, the word that work nothing said ended already has, and it leaves the count.
- A pane closing says nothing about whether a run failed, so a run cut off that way reads "pane
  closed" with a neutral dot rather than red.
- A chat's title holds its room before the link's first value, invisible rather than absent, so
  nothing moves when the name lands, and after that value a pane the herd has no name for reads
  "Chat". It used to read the raw pane id in both.
- A blocked agent reads "needs you" wherever its status is put in words, the same words the tab
  badge and the machine counts use; "blocked" is herdr's word, not the user's.
- The herdr lost pill keeps one line beside a machine's badge and update pill. On a card the three take 226.4 px of 285 at 375 wide and of 300 at 390, and in the machine's header, with its narrower gap, 214.4 of 319 and of 334; at 320 the card has 3.6 px to spare. A long name truncates and leaves that row alone. The Herdr row stays 44 px tall as a version and as a lost time. The pill arriving moves the update pill sideways in one frame, 79.8 px on a card and 73.8 in the header, for 0.00076 and 0.00124 of layout shift, with the row's own value in the second (all measured in Chromium, the shifts at 390x844 and 4x CPU throttling).
- A one-shot Bun script keeps `Effect.provide` at its entry and disables
  `effecttsgo/strict-effect-provide` there, as the rule's own message allows at an entry point.
  The long-running members' `Layer.launch` form does not carry over: it never returns, and the
  script hung until killed (measured).
- The router percent-encodes a path param, so a herdr pane id like `w1:p3` sits in the URL as
  `w1%3Ap3`, and the route's params hand it back decoded (measured). A memory history started at
  the unencoded path keeps it as typed, so a test that compares the location with one the router
  builds starts at the encoded path (measured: the close from the chat never went back otherwise).
- A hook that hands back an `Effect` is a zero-argument function returning a lazy Effect, and
  `effecttsgo/lazy-effect` rejects it (measured). Code that needs the router takes it as an
  argument, typed `RegisteredRouter`: `AnyRouter` types `history` as `any`, and the type-aware
  rules reject every call on it (measured).
- The Hold Button's label follows what its parent says. It used to show its complete label for
  1200 ms after a hold and then go back, so a Forget still out read "Hold to forget" again while
  it was still pending (measured at 1400 ms in the story harness).
- A grid with no column template gives each item an `auto` column, which grows to the item's
  min-content, so a `truncate` inside it never truncates and a long agent title pushed its card
  past the screen on real data (measured). A grid whose items must shrink takes `grid-cols-1`,
  whose `minmax(0, 1fr)` lets them.
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
- `Effect.catchTag` does not typecheck over a generic error union such as `Failure | RpcClientError`
  (measured: TS2345, the tag narrows to `{ readonly _tag: unknown }`). A `Schema.Error` there is
  caught with `Effect.catchIf(Schema.is(X), …)`; `instanceof` is the other spelling, and
  `effecttsgo/instance-of-schema` rejects it.
- An atom over a `Stream` adds `Cause.NoSuchElementError` to its error channel, for a stream that
  ends before its first element, even one that never ends (measured: a type error). A prop that
  takes the atom's result names that error too.
- Every atom that talks to the hub runs on one `Atom.runtime`. A component test seeds the registry
  with `Atom.initialValue(runtime.layer, fake)` and renders the real route tree; a test that
  renders a route without it dials a real WebSocket and fails with `ECONNREFUSED` (measured).
  Seeding a derived atom such as the connection or the needs-you count does not stand in for
  it: the registry still builds the atom, keeping the seeded value, so its reads reach the
  runtime and dial all the same (measured). Seed the runtime's layer.
- The chat's views are a function its atom runs, not a service. They hold no state between keys, one atom calls them, and no test replaces them: a test fakes what they talk to by seeding the runtime's layer, and a service would be one more thing every seed has to build. Their inputs stay atoms because they subscribe before forking anything and read the latest value at given moments, so streams as inputs would only move that work into an adapter that still holds the registry.
- An effect atom re-runs whenever anything it reads changes, and the re-run interrupts the effect
  still in flight. One that reads the whole herd re-ran its hub call on every herd change from
  any machine (measured: five calls where one was due). It reads a derived atom that holds only
  its decision instead; atoms compare values with `Object.is`, so a boolean that did not flip
  wakes nothing.
- Shiki's hast names an element's classes in `properties.class`, a space-separated string, not in
  hast's usual `className` array (measured on 4.5). A walk that looks for `className` finds no
  line and renders every block plain; test the walk against a real highlighter's output.
- A stream atom marks every value it emits as `waiting` until its stream ends (read in
  `Atom`'s stream constructor), so the result of an atom over a stream that never ends, such as a
  chat's transcript, is waiting from its first value on and says nothing about a refresh. So the
  chat's atom emits a machine's state, which holds both the view on screen and the fold still
  being read: the thread's "Catching up" capsule and the pending Show earlier and Try again rows are
  each a tag of that state, and a screen reads nothing else. The cue hides while the chat is
  dimmed, since the dim already says the hub or the machine is away, and once the pane no longer
  runs Claude, whose transcript never catches up. A failed watch is not catching up, and pressing
  Try again is a tag of its own.
- A read that ends within a second says nothing. The cue, a pill in the header when these were measured, used to show as soon as a watch
  resumed, and on a reconnect and a foreground return it held 17 frames (317 ms) and 14 frames
  (238 ms), each with its spinner, and read as a flash every run. Waiting the second a link's
  notice waits, neither shows at all. Once shown it stays until it has held 400 ms, the frame
  tool's limit: a read landing 1.8 s after the tap showed the cue at full opacity for 36 frames
  (all measured in Chromium at 4x CPU throttling).
- The cue, the failure rows and the rows read one state, deferred once, so they commit together:
  on that 1.8 s read the cue starts to fade in the frame the rows land (measured as above). The
  rows are slow to render and the deferred read can skip a state on its way: a read landing about
  1.1 s after the tap went from held rows to landed rows with the state that says catching up never
  committed, so the cue first showed in the frame the rows landed, and held its 400 ms over a read
  already done, 37 frames with its fades (measured as above). The atom cannot know what committed.
- "Catching up" floats over the top of the thread because a pill in the header took its room from
  the title: at 390 wide the title went from 286 px to 168 with it, or to 186 with a running count,
  and with both up at 375 wide it had 53, moving whenever one came or went. Over the thread it takes
  nothing: the title held 271, 286 and 326 px at 375, 390 and 430 wide in every frame of a slow
  catch-up, the capsule up for 57 to 58 frames as the pill was. Layout shift read 0 before and after
  (all measured in Chromium), so the score never saw that reflow: a title narrowing moves no box's
  start (reasoned). The capsule's blur costs nothing the frame tool can read: a p90 frame of 18.0 ms
  under the pill and 17.3 under the capsule, at 4x CPU throttling (measured, one run each).
  It covers the row beneath it and takes no touch: in Chromium with touch emulated, a tap at its
  centre opened the tool call under it, a finger scroll starting on it moved the thread 286 px and
  let go of the end, and a swipe from the screen's edge at its height went back. With the keyboard
  emulated it stayed 8 px under the header over a thread 324 px tall (each measured once).
  The connection banner lies over the same place in a higher layer and hid the capsule whole, for
  all 19 to 20 frames they were up together, at both phone widths in both themes. The capsule now
  rides the slide a tab screen's content takes, so it rests 9 px under the banner, 28 to 29 frames
  together on a reconnect in 3 of 3 runs with no layout shift. The thread itself stays put under both
  (all measured in Chromium). A capsule beside a skeleton is a forbidden pair in the frame tool:
  the states that say catching up each hold a view and a skeleton means there is none (read in the
  machine), and the sweep holds that.
- A chat counts its running subagents only in its dock. The dock counts every running subagent of
  the session, a foreground one included and marked "Claude waits on it", and its chip opens that
  run's screen in one tap, as a tree row does. So the header's count added only a scroll to the
  tree, and it went with the scroll. A run launched inside a hole shows in neither, and a run no
  roster has named yet opens from neither, as before (read in their source). The count on a
  machine's card comes from the agent, and never read what the chat counts.
- A catch-up that lands before the cached rows ever committed gets its divider like any other. What
  is new is what the cache did not hold, whichever rows the chat got to show: the fold keeps the
  lines the cache held when the read ends, and the screen turns those into row keys. A chat kept on
  the device with its answer already waiting goes from nothing to rows and divider in one commit,
  with no layout shift, where judging from the first rows rendered showed no divider and failed its
  story (both measured in Chromium at 4x). Only a chat read from the store can get there, since one
  reopened from memory holds the cached view in its first render (measured). Turning the lines into
  keys costs one pass at the landing: 4.7 ms at 62 lines, 11.4 at 586, 14.5 to 19.5 at 1110 to 1406
  (measured on the dev server at 4x).
- The agent applies a watch's tail only from offset 0 and keeps it per watch (read in its source),
  so a watch that read one session whole reads the next one whole too. The phone restarts the watch
  when a session read whole changes, with the tail, and drops what the old watch still delivers
  until the new one has been asked, so Show earlier is offered again on the next session.
- An agent too old for the caught-up mark gives no sign that a session is empty, only silence after
  its open, so the phone keeps the skeleton for the same second before it says "No messages yet"
  (reasoned, not measured). With rows on screen it never says so, and a rejected resume keeps them
  until the agent's first chunk replaces them. A file left truly empty behind such a rejection
  therefore keeps showing the old rows until Claude writes again (reasoned, not measured).
- A chat with nothing cached whose pane closed or whose Claude exited showed a blank thread above
  the card. It says the phone has no messages, as a machine that is away does.
- A close from the chat that stayed on the chat, blank, for the rest of a story was the story and
  not the app. Every story started at a pane id the router would have encoded, and a memory history
  keeps a path as typed, so the back navigation's comparison never matched. With the encoded path
  the chat goes back to the herd and the toast shows, with no blank (measured). A witness of the
  toast alone passed either way, since the toast shows on the chat too: a story about arriving
  somewhere names something only that place shows.
- A thread skeleton holds for a flash's limit, 24 frames and 400 ms, whichever takes longer, and rows that arrive meanwhile wait out the rest. Before it, with nothing cached, it held 9 to 13 frames (233 to 369 ms) on a reconnect story and 10 to 17 (232 to 489 ms) on a foreground return over three sweeps, because the catalog's fake hub answers as soon as the screen mounts; with it, neither flashes (measured). A real hub's caught-up mark came 381 to 981 ms after a reload's first commit, so a real open rarely waits on the hold, and a phone is not measured. The other way out, a delay before it shows, leaves a blank panel while the chat slides in (reasoned, not measured).
- Catching a chat up is bound by round trips, not by any hop's own work. The hub writes a
  transcript message to the phone only after the phone acknowledged the one before. Before
  transcript events were coalesced, it also held one event per phone, so the agent's next event
  waited on that round trip too, and the numbers in the rest of this entry are from then. Run
  locally with every hop timed, a cold open with the 512 KB tail reached the screen 72 ms after
  the phone asked, and the agent began its watch under 1 ms after the hub registered it, so the
  wait sits in the number of events times the phone's round trip. With the agent reading 64 KB per event, 800 KB
  written since the phone last looked took 14 events and 14.3 s at an emulated 1 s round trip,
  and 4.4 s at 300 ms; reading what the file holds in events of up to 1 MiB took 2 events, 2.2 s
  and 0.8 s. Show earlier on a 3 MB transcript went from 48 events and 14.9 s to 5 events and
  1.7 s at 300 ms (all measured against a local hub and agent through a proxy that delays each
  WebSocket message). Fewer, larger events are the lever; a smaller read size is a regression.
- Neither the agent nor the hub waits on the phone per event. Each keeps what is pending for a
  watch in a mailbox that merges as it goes: chunks that continue each other join into one, a
  later skill list or subagent roster replaces the earlier one of its session. The agent publishes
  everything its mailbox holds as one call and keeps reading while it waits for the reply; the
  hub replies once the updates are in the phone's mailbox, and the phone gets everything held
  since its last acknowledgement as one message. A caught-up mark merged that way can name an
  offset before the end of the joined chunk, which the hub lets through. A mailbox takes no more
  once it holds 1 MiB of read lines, so a slow phone holds the agent back instead of filling the
  hub, but always takes a failure. There is no time debounce: merging only happens while a
  message is already out, so an idle pipe adds no delay.
- The agent publishes a batch through its own call, and the hub still answers the single-update
  call an agent from before coalescing makes. A hub is the side that updates first, and an agent
  behind it stays online until the phone offers to update it, so dropping that call would leave
  every older agent's chats without transcripts.
- The hub alone decides what a phone has already been sent. It keeps one delivered position per
  watch and judges each update as it arrives: it drops an open of the session the phone is
  already in and any roster, skill list or caught-up mark of another session, and refuses a chunk
  that does not continue the position, so the agent restarts from there. The phone applies
  whatever arrives and keeps a position only to resume from. The agent sends from where its own
  read reached and resends freely, a repeated open on every resume included; the hub could only
  hand that cursor over after a round trip. An older agent gets the same filtering, since it
  happens at the hub.
  The position moves in the same transaction that puts the update in the phone's mailbox. Done
  as two steps, an agent connection dropping between them would leave the position behind what
  the phone holds, and the agent's resend from that position would reach the phone twice, with
  nothing downstream left to drop it (reasoned from the interrupt points, not measured).
- A caught-up mark names the offset the agent read to, so the hub refuses one past the position it
  holds, exactly as it refuses a chunk that does not continue it, and the agent restarts from there.
  A pane going A, B, A while the open of B still sat in the agent's switch queue read its cursor as
  the end of A and sent only the open and the mark, while the hub's position fell to the start of A:
  an empty thread saying it was caught up (found by the model, and walked through the real relay).
  The refusal is at the hub, since every agent that sends the mark names that offset and restarts
  when refused, so an older agent is covered too.
- A publish that dies of a defect ends its watch with nothing to restart it, because the agent's
  demand stream only moves when the set of watches does (measured in a probe of the agent's real
  serve loop). The agent tells the phone the watch failed, so the hub drops the watch and the phone
  offers Try again, the same as a read that dies. If that call dies too, the watch waits for the next
  connection or re-watch.
- A watch's stream cannot end with the connection lost while the phone still reads the link as
  connected. An RPC socket's failures, a message that will not decode included, reach every live
  request, the herd's among them, and the link reads as connected only while that herd stream runs,
  so the link flips and the watch restarts (read in the RPC client's and the link's source, not
  measured).
- A publish from an agent connection that has died can still run at the hub after its successor's.
  The RPC server forks a handler for each request frame it reads, and nothing orders two sockets.
  With a proxy holding the client's bytes, the client dead by its own ping timeout and its successor
  already publishing, releasing the first held frame ran the call in 10 of 10 runs: the phone got
  the finished session back with its lines repeated, and the next live chunk was refused. Released
  in one read with the ping and close frame behind it, the call never ran, in 10 of 10: the handler
  was forked into a scope that closed first (all measured). So it takes a gap at the hub between
  the frame and the end of its socket. The hub closed a silent socket 12.0 s after it fell silent,
  while the agent gives up 5 to 10 s after its last frame and redials, so the hub still reads a
  socket the agent has left (one run measured). A network that delivers the oldest segment before
  the rest is reasoned, not measured.
- The hub fences publishes per connection. Each upgrade mints a link with a rising number, and a
  link stops counting once a later one asks for demands. A call on a link that stopped counting
  drops what is left of its updates and still replies with success, so nothing changes on the wire
  and an older agent is covered too: every publisher got its watch ids from the demand stream. The
  fence moves at the demand and not at the upgrade, so a dial the agent gave up on, which never
  speaks, fences nothing. A client speaks only after its upgrade's reply and redials only after
  giving up, so the numbers follow the agent's own order, and an older link asking late cannot move
  the fence back. A publish parked on a full mailbox wakes when its link is replaced and lets go,
  rather than delivering once the phone drains.
- A watch's delivered position lives beside the watch, outside the set the agents' demands are
  built from, so only a watch that comes or goes works out a machine's demand again. Updating
  the position inside that set recomputed the demand once per event: 21 events cost 21
  recomputations before, and none after (measured with a counting tracer).
- A burst of writes behind a publish arrives in fewer publishes than writes, not always in one. A test that wrote three lines and waited 80 ms for the agent to read them saw two in the next publish in one loaded gate, and all three in 12 of 12 runs with sixteen busy loops beside it (measured). A file event that lands during a read is kept (read in the tail), but a write landing right after a delivered event gets no event of its own, so then the rest follows on the watch's second look. So a test holds that everything arrives in fewer publishes than writes.
- A test that publishes twice and expects two deliveries takes the first before it publishes
  the second. The mailbox joins whatever the phone has not taken yet, and whether the phone's
  fiber got a turn in between hung on unrelated work in the hub: dropping a per-event update
  made two chunks a test expected apart arrive joined (measured).
- The agent holds a session it opened until it has caught up on it, so the backlog, the
  caught-up mark, then the skills and roster land in one message, and the skills never go first.
  A subagent watch whose file does not exist yet therefore sends nothing until it does; the phone
  waits for the caught-up mark from a current agent anyway, so it shows the same.
  The hub cannot hold the same way: an agent too old to send the caught-up mark would leave the
  phone with nothing, so it forwards whatever it holds.
- Coalescing measured against a local hub and agent in one process, each socket behind a proxy
  delaying every WebSocket message 150 ms (an emulated 300 ms round trip), on a 3 MB real
  transcript with a subagent folder: a cold open with the 512 KB tail went from 6 messages and
  1.85 to 1.91 s to 2 messages and 0.70 to 0.71 s, the second carrying only the subagent roster;
  a resume with 5 new lines went from 4 messages and 1.51 to 1.54 s to 2 messages and 0.62 to
  0.65 s, against a floor of 0.6 s for phone to hub to agent and back; ten writes 20 ms apart
  went from 10 messages and 3.07 s to 2 messages and 0.61 to 0.63 s. Ten writes with no gap were one
  message both before and after, since one file event read them all.
- A resume over a gap wider than one read of the agent skips it, and costs one message however wide the gap. On a real 118 MB transcript at an emulated 300 ms round trip (a local hub and agent in one process, each socket behind a proxy delaying every WebSocket message 150 ms, three runs each), a 20 MB gap went from 13 messages and 4652 to 4738 ms to 1 message and 791 to 809 ms, and a 118 MB gap from 70 to 71 messages, 24 MB and 23106 to 23827 ms to 1 message, 0.01 MB and 768 to 810 ms, against the floor of 0.6 s for phone to hub to agent and back. A whole read pays what it always did: 13 messages and 4756 to 4768 ms over the same 20 MB. Run again with every event through the chat's machine from a cached view, the 20 MB gap took 789 to 871 ms and the 118 MB one 756 to 821 ms, landing as a catch-up with one hole, and the machine's own work was 0.27 to 1.09 ms per resume, 3.89 to 10.48 ms over the whole read (all measured).
- The skip starts past one read, 1 MiB, rather than wherever the tail would land past the resume. A 786 KB gap read whole already cost 1 message and 822 to 844 ms, and a hole there would save nothing and leave a row to press; a 1.16 MB gap read whole cost 3 messages and 1428 to 1464 ms (all measured).
- A skip changes nothing on the wire: it is the omitted-lines chunk a cold open sends, at a later offset, and it continues the hub's position like any chunk. An agent too old to skip never sends one. An older phone shows the row and its button still reads the whole file, but it can strand a sent prompt's row, since only a current phone ends that wait at a hole (reasoned, not measured).
- A resume's offset is checked before it can be skipped, so one past the end or inside a line is still refused rather than hidden behind a hole.
- A thread can hold a hole in its middle, so whatever reads it can no longer take the row at the start of the file for the only one. A tool call above a hole has its result possibly inside it, so it reads as stopped rather than running forever, and a prompt sent before a hole may have landed in it, so the hole ends the wait for it. The row a cold open starts with is not a hole and ends no wait.
- The phone's cache hands back a view holding at most one hole: everything down to the hole before the newest folds into one row at the start of the file. A chat opened from it holds at most two once the next gap lands, and 40 reopens over a gap each settled at 6 lines (measured in a test). The fold happens before the chat shows, so a catch-up still sees the cached rows as a prefix of what it lands on. A gap under one read adds its lines as any catch-up does, so that growth stays what it was.
- A chat left open does not fold: it gains a hole and a tail for each reconnect over a wide gap, until the next open folds them (the model walks three in a row through the real relay and view). Folding on the spot would take rows from under a reader scrolled up to them, and each reconnect now adds a tail where it used to add the whole gap, so it waits for the next open by decision: the user chose that over merging rows while a chat is open.
- The model reaches a cold open's row directly followed by a hole, when a reopen lands before the tail did: two rows reading the same and pressing the same. Every rule holds on it, and it stays that way.
- The catch-up divider sits above the hole row and names only the times of the rows it landed, since a hole carries no stamps. The rows under the divider read in order as what happened on the laptop, the hole first (seen on the contact sheets).
- Show earlier has to stay pending until the rows it waits for commit, so the label and the rows read one deferred state. Read from the latest state while the rows read a deferred one, the label went back to Show earlier for 6 frames, 82 ms, between the whole view arriving and its rows landing. On one deferred state it holds from the tap until the frame the rows land, over 53 to 59 frames, with no frame of Show earlier between and no layout shift at the landing, in all three stories of a hole (measured at 4x CPU throttling).
- To the chat's machine a resume over a gap is one more chunk, with no event or case of its own: held back behind the cached rows, landed by the caught-up mark as any catch-up is. Its walk tries one from every state and holds it to the arrow a chunk of lines takes there, and its chart came out unchanged. A special case for it fails that rule (measured).
- A chat read whole stays whole when it reopens from the phone's memory, so a gap since then is read in full rather than skipped, and it stays whole until the session changes or the store is what answers: a stored view is never whole. Showing the whole chat is what the user asked for, so this stays.
- Rows landing while a thread follows used to show one blank frame, with or without a hole: a pin writes the scroll position before the virtualizer has heard of it, so what it rendered sat off screen for that frame, 55 to 63 ms over a tail of 120 rows, and 58 ms over the same rows with no hole (measured at 4x CPU throttling). A following thread now always renders the rows at the end beside its range, and all 36 timeline stories run with no blank there.
- A catch-up longer than the screen used to land with the top of the screen empty: the thread jumped to its end and lifted by up to a screen, and the rows that lift showed above the end's range were not rendered. A landing held 348 to 392 px with no row for 4 to 7 frames, 91 to 111 ms, with a hole or without one, and over rows taller than the estimate the whole 660 px for 1 to 3 frames, 65 to 84 ms, which also read as blank (measured at 4x CPU throttling, 390x844, three to six runs of each). The rows the screen will show now render before the first paint, so a landing is still one lift capped at a screen and its rows still arrive together; with the fix, no band past the thread's own spacing from the first step on, in eleven runs of each story at 390x844 and 430x932 (measured at 4x).
- Which rows the screen will show is only known from heights, and a row's height is only known once it rendered. A thread commit took about 50 ms at 4x on the dev server, so the count of commits is the cost. Walking up from the end by the estimate took six commits and a worst frame of 368 to 404 ms; naming the rows from the height of those already measured, and holding what was rendered, took three and 162 to 177 ms (measured). Against the same stories with the fix reverted, a landing's worst frame went from 111 to 140 ms to 159 to 184 ms on short rows, from 83 to 94 ms to 84 to 102 ms on turns of mixed height, and from 41 to 43 ms, with the blank, to 168 to 260 ms over tall rows (measured as above). A busy machine read higher on both sides: 181 and 213 ms with the fix reverted, 365 and 601 ms with it. A production build is not measured.
- Capping the lift at what is rendered lost to rendering what the lift shows. It kept the landing's worst frame at 107 to 134 ms and lifted 252 to 296 px instead of 660, but a short catch-up that lifts 98 px lifted none, and over tall rows the screen still held 216 px with no row for 4 frames, 103 ms, with the lift at 0: the rows at the end's range do not reach the top even at rest, so the range is what falls short, not the lift (measured as above).
- A long landing leaves 40 rows rendered where the rest state holds 23, until the next render trims them (measured).
- A hole's row and the line that fills it used to share a key, the line's offset and index, so the filled row kept the hole's measured 80 px while it rendered 32, and the rows below moved only after a ResizeObserver reported it: Show earlier landing left 60 px with no row for one frame of 14 to 64 ms in all 14 runs, and in pictures. TanStack Virtual measures through its ref only at mount, and that report renders in a later task (read in its source). Keyed apart, a filled row mounts and measures in the commit that lands it, with no band in 3 of 3 runs at 390 wide and 1 of 1 at 430, a thread still following keeping the row under the hole at 185 px and one scrolled up to it the row above at 293 px in every frame, the lift at 0, Show earlier pending from the tap until the rows land with no frame of Show earlier between, and no layout shift at the landing (measured at 4x CPU throttling). The landing's worst frame stayed within what it moves from run to run: 49 to 64 ms before and 51 to 59 after, 58 to 73 and 61 to 79 scrolled up to the hole, 128 to 142 and 139 to 148 still following (four runs each, measured as above).
- A row that truly changes height under its key still moves the rows below it a frame late, for the reason above. Over a sweep of all 43 timeline stories no row reported a height other than the one it was measured at, so no story reaches that path and nothing checks it (measured with the same tracing). Which rows can do it on real data is not measured.
- A browser asks for a font only once text needing it lays out, so a chat whose rows were the first text to want it measured them in the fallback font. The font landed before the next frame, while the commits after the mount still held the main thread: a prompt measured 76 px where it renders 52, and 36 px stayed empty between rows for one frame of 47 to 87 ms in 11 of 11 runs at 390 wide; at 430 three tall rows measured 608 where they render 560, 60 and 64 px empty on the first frame (measured at 4x CPU throttling). Asking for the three families when the app's entry runs has them in hand before those rows commit, and waits for nothing: no band in 3 of 3 runs at 390 wide and 1 of 1 at 430, the band back in all four with only that ask taken out, and the first frames' worst frame at 325 to 338 ms against 325 to 343 (measured as above). In a production build, unthrottled and on a screen with no mono text, all three answered 64 ms before the first contentful paint (measured once). The ask names no text, so of the 11 faces only the three whose range covers a space load, and a chat in another script still swaps its own faces late (reasoned, not measured). A font slower than the first rows still swaps under them, and a phone with the service worker behind it is not measured.
- A scroll position written further than the rendered rows reach shows an empty thread for one frame when the frame comes before the virtualizer's render: a story's write of 0 from the end of 47 rows read 660 px with no row at the lift of 0, and the screencast shows that frame with nothing between the header and the dock, so the tool told the truth (measured once at 4x, 1 of 43 stories in a sweep; 2 of 229 story runs before it). The write was 0.7 ms before the frame and the render landed 30 ms after. A finger's scroll moves far less than the overscan per frame (reasoned, not measured); the one write the app makes itself is the jump to the end, which renders the end beside the range.
- Filling a hole is not new content at the end, so it lifts nothing. With the lift, a thread still following when the whole file landed lost its rows for 115 ms and glided the row under the hole from 668 px back to the 361 px it had been at. Without it, that row read 185 px in every frame before and after the landing, and a thread scrolled up to the hole kept the row above it at 293 px while the filled rows opened under it and pushed the rest down (all measured at 4x CPU throttling, 390x844).
- A playback speed scales only the delays between a story's steps, and a chat's slide-out does not scale. The reopen catch-up story lost its divider at twice and four times the speed because its tap fell inside the slide-out, so the chat never left and the rows landed as live lines: its thread went from Current to Current and never held anything, 4 of 4 runs with the wait for the chat to leave taken out. With that wait it ends on its divider at 0.5, 1, 2 and 4 times the speed, 2 of 2 each, and at 8 and 16 with even the wait for the held rows taken out (all measured in Chromium, at 4x CPU throttling except the 16). How fast the rows land was never the cause.
- A real resume does not land before the chat's first commit. The chat's first commit with a view comes before the request even leaves, so a shorter round trip cannot get ahead of it. Tapping a card on a local hub and agent, a real transcript and a stand-in Claude, the Chromium dev server at 4x and at an emulated 300 ms round trip: first commit 55 to 91 ms after the tap, the resume going out 267 to 391 ms after it, the caught-up mark arriving at 899 to 1055 ms and the rows committed at 1038 to 1327 ms, a 1.3 MB gap among them. At 1x those were 18 to 22, 94 to 105, 710 to 735 and 746 to 768 ms. With the proxy delaying nothing, at 4x: 68 to 114, 450 to 473, 619 to 663 and 783 to 859 ms. Reloading the page onto the chat, timed from navigation at 4x, the first commit takes 909 to 2887 ms and the mark still arrives 782 to 981 ms after it; with the proxy delaying nothing, 381 to 486 ms after it. At 20x with the proxy delaying nothing the first commit still came first: 406 and 420 ms against a mark at 2267 and 2310 on a tap, and 6251 to 8308 against 8083 to 10207 on a reload. A production build and a phone are not measured.
- Effect RPC sends each array a stream handler emits as one message and waits for the client's
  acknowledgement before pulling again (read in its server source), so a stream that emits a
  whole mailbox take as one array costs one round trip. `Stream.fromEffectRepeat` followed by
  `Stream.flatMap` over `Stream.fromArray` and by `Stream.mapAccum` keeps that array whole
  (measured).
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
- Claude Code writes a session's jsonl one entry per content block, each carrying the API message
  id, but only once the whole message has finished: over three messages of one session (Claude
  Code 2.1.309 in a TUI pane, the file polled every 10 ms) every write held whole messages. A
  text block and the tool_use after it landed in one write about 585 ms after the text's own
  timestamp, the text's line already holding the message's final `stop_reason`; a 2202-character
  answer landed as one line about 9 s after its request, 118 ms after its stamp; no write ever
  left a partial line. Nothing can stream text to the phone, so the chat reveals each landed
  batch instead of pretending to type it.
- Claude Code always says in the transcript that a turn is over. Over 60 local transcripts, 559 of
  the 569 turns that got an answer ended with a `turn_duration` system entry, an assistant entry
  whose stop reason is not `tool_use`, or an interruption, and the other 10 were still running
  (measured). `turn_duration` alone was in 549 of all 728 turns, unanswered ones included, and the
  answer's own line carries its final stop reason, so the end lands with the answer. The Working row
  therefore leaves on that evidence when it is stamped after herdr's flip to working (both stamps
  come from the laptop's clock), and stays after herdr goes idle while the turn is still open in the
  transcript. With herdr's idle flip reaching the phone before the answer, the row used to leave on
  the flip and the answer land on its own afterwards; now both change in one frame (measured in
  Chromium at 4x CPU throttling).
- A compaction someone typed ends its turn, and an automatic one does not. Over 48 compact boundaries in local transcripts, none of the 34 `manual` ones was followed by an assistant line (28 by a user line, 6 by nothing), and 10 of the 14 `auto` ones were (the other 4 by a user line). Before a manual boundary counted as the end, a typed `/compact` left the turn open for good: the Working row stayed after herdr went idle, beside Send, for 359 to 362 frames, until its story ran out (measured in Chromium at 4x CPU throttling).
- A background task that finishes while Claude is busy reaches the transcript as an `attachment`
  entry of type `queued_command` whose `commandMode` and `origin.kind` are `task-notification`,
  carrying the same `<task-notification>` text a `user` entry carries when Claude was idle. A
  subagent's meta does not always get `finished`: of 31 local metas without it, 30 were
  background runs, every one had a notification for its tool use in its session's transcript,
  and 14 had it only as such an attachment (measured on the laptop). A subagent's own transcript
  does not say it ended either: 53 of 88 finished background subagents ended on a tool result,
  as one mid-run does. So the agent decides each subagent's status from its meta and the last
  notification naming its tool use anywhere in the session file, and sends that in the roster;
  the phone takes the roster's outcome before anything it infers from the lines it holds.
- Scanning a whole transcript for notifications parses only the lines that carry the tag: a
  118 MB transcript of 24363 lines took 40 to 87 ms that way and 280 to 315 ms parsing every
  line (measured in Bun on the laptop).
- A whole-file read for notifications and background work cost a chat twice on every phone unlock,
  since the chat's roster and its background watch each read from byte 0 again: on the 118 MB
  transcript 1057 to 1175 ms of CPU, 550 to 619 ms of wall time and a peak of 143 to 144 MB, on a
  process that idles at 54 MB. Their markers are one set, so one read per session feeds both, and
  the running count already keeps that read alive for every Claude pane. A chat arriving at it
  then cost 7 to 25 ms of CPU and 3 to 13 ms of wall time, reading nothing (three runs of five
  arrivals each). With no count holding it, one arrival reads the file once: 292 to 718 ms of
  CPU, a peak of 129 to 137 MB. Searching a line's bytes for the markers rather than decoding it
  first took the two old reads from 1057 to 1175 ms to 737 to 800 ms, and left the peak alone;
  neither `--smol` nor reads of 64 or 256 KiB lowered the peak (all measured in Bun on the laptop).
  The price lands on the running count, which now carries the whole scan for every Claude pane
  once per agent start or session: on the 118 MB transcript, its first read went from 451 to 475 ms
  of CPU to 571 to 691 ms, on an otherwise quiet laptop. Run side by side at a load average near 18, the
  count's own markers alone took 729 to 747 ms and the whole scan 1159 to 1239 ms, at 118 MB, 476 to
  527 and 758 to 782 at 32 MB, and 42 to 46 and 41 to 56 at 0.4 MB, with the peak the same at each.
  So one chat opened per agent start already pays for it (reasoned from those numbers).
- Claude Code 2.1.312 names background work in the transcript like this (measured in local
  transcripts and a probe session). A background Bash's tool result opens with `Command running
  in background with ID: <id>. Output is being written to: <…>/tasks/<id>.output`, and its
  `toolUseResult` carries `backgroundTaskId`; one moved there by its timeout opens with `Command
  did not complete within its 120s timeout and was moved to the background (ID: <id>)`. A
  Monitor's result opens with `Monitor started (task <id>, expires in …`, with `taskId`,
  `timeoutMs` and `persistent` in `toolUseResult` (18 such results locally, none persistent). A
  successful TaskStop answers `{"message":"Successfully stopped task: <id> (<command>)", …}`. A
  shell started from a plugin's tool call has no Bash tool use in the transcript: only its result
  text and its notice name it. Each Monitor event arrives as a `<task-notification>` carrying the
  task id, a summary and an `<event>`, with no tool-use id and no status; the notice that ends it
  carries a status like a shell's. Every launch text opens its tool result, so a match anywhere
  else is a quote, such as a Read of a transcript.
- A running background Bash is a child of the Claude process, found through
  `/proc/<pid>/task/*/children`, and its standard output is the task's output file; a Monitor's
  process holds no such file. One liveness check from the session's pid file to the open output
  files took 0.32 ms of wall time and 1.17 ms of CPU (measured on the laptop). A kernel without
  those `children` files cannot say which shells run, so their absence means unknown, not gone
  (reasoned, not measured). The agent calls a shell gone only once its first miss is a full
  recheck old, so a shell that exits normally is not flagged in the moment before Claude's
  notice lands, however often its other work changes.
- Which process runs a session is read from the pid files the agent already follows, only the ones naming that session, rather than from the whole folder at every look. A pane's process is the exception: its environment names its root, which nothing may be following, so its one pid file is read directly. Decoding a pid file and holding its start time against the process sit together for both. A look that lands before the watch has read a new file reads as not knowing, which the shell check already answers for a process it cannot name, and its next look settles it (reasoned, not measured).
- The agent counts the running subagents of every Claude pane all the time, not only while a chat
  is open: it follows each session's subagent roster, settled by its notices the same way the
  chat's roster is, and puts the count on the agent's row only when it changes, so a roster change
  that leaves the count alone sends no herd update. On the 118 MB transcript a watch took 210 to
  260 ms (406 to 517 ms of CPU) to its first count, and 1.9 to 2.9 ms of CPU per line appended,
  at 2.8 KB a line on average (measured in Bun on the laptop, 200 appends, four runs). The count
  is an optional key on the wire, so a row from an agent too old to send it decodes as not knowing
  it, and its card shows none.
- A background run outlives Claude's turn, so an idle session does not end it; it only stops the
  run's elapsed time, since nothing then says the run is still going.
- A thread shows one session, and there is no way back to an earlier one on the phone: the old file
  stays on the laptop and `/resume` reaches it. An open of another session starts the view over,
  and the agent reads nothing further of the session the pane left, since the phone would throw it
  away. Everything that counts on a thread only growing starts over with it: the wait for a sent
  prompt, whose count can fall and strand a row (measured), the catch-up, the always notes, and
  the thread's following, size cache and lift. The draft is the user's words about the pane rather
  than about one session, so it stays.
- The transcript says which of `/clear` and `/resume` changed a pane's session. Measured on a real
  Claude Code 2.1.317, the pid file's session id changing within 5 s of either: `/clear` starts a
  new file holding a meta caveat, a `user` entry `<command-name>/clear</command-name>` and an empty
  `local_command` output; `/resume <id>` keeps that id and file, with no fork, and appends only
  bookkeeping (`last-prompt`, `session-owner`, `atis-latch`, `cost-state`), no command line and no
  user line. Over 151 local main transcripts all 9 `/clear` entries are `user` entries at line 3 or
  4, near 1.2 KB, so any tail of a short new session holds one. A session that itself began with
  `/clear` keeps that row at the top whenever a read reaches its start, a resume or a cold open
  alike (reasoned, not measured). A bare `/resume` that is cancelled writes a `local_command` entry
  reading `Resume cancelled`, and changes nothing.
- A thread remounts when a session it knows changes to another, not when its first session
  arrives. Remounting on the first one threw away the following that had already pinned the
  thread to its end (measured: a test opened at the top instead of at the bottom).
- A `translateY` on the thread's content extends its scroll container's scrollable overflow by
  the same amount: in Chromium 156 a 1000 px child lifted by 100 px gave the container a
  `scrollHeight` of 1100 and a bottom `scrollTop` 100 px further down (measured). While the
  reveal's lift is up, the thread subtracts it before it judges whether it sits at the bottom or
  scrolls there; otherwise the slide read as the user scrolling away and the thread stopped
  following on every batch taller than the follow threshold.
  Scrolling there means `scrollHeight` minus the lift minus `clientHeight`. Asking for
  `scrollHeight` minus the lift alone lets the browser clamp at the lifted bottom, so a batch
  landing mid-glide counted the lift still up as growth, doubled it, and the scroll was clamped
  down under the shrinking lift for 37 to 38 frames of a six-batch burst, the glide stopping short
  instead of easing out. With `clientHeight` subtracted it was 2 to 3 frames (measured in Chromium
  at 4x CPU throttling, batches 100 ms apart, two runs each).
- A lift's first frame read as late in the log and never reached a screen. Motion renders an
  element in a microtask after every commit that re-rendered it, from its motion values as they
  stood (read in its source), and a transform derived from other motion values catches up only in
  Motion's next animation frame. So the transform the pin writes by hand was overwritten with the
  one from before the lift, and stood that way until that frame. A read in the first animation
  callback then saw the scroll moved and the lift missing: at the end of 120 lines, a row 37 px up
  for one frame and back in 20 of 20 runs of output landing in a later batch, and 5 px in 20 of 20
  of command and output in one write, where a measure's second commit left only its own part behind.
  A read after the frame's animation callbacks saw it in 0 of 20 each, and so did the bubble's place
  in the screencast's pictures, since Motion's frame runs before the paint that follows the commit
  (measured in Chromium at 390x844 and 4x CPU throttling). An earlier count of 2 of 7 and 1 of 2
  is what a read in another place among those callbacks would give (reasoned, not measured). The
  thread sets the derived value in the step that pins, so all three now read 0 of 20 each. Across
  all 57 timeline stories no pin landed between those two reads (measured), which is where such a
  frame would be painted (reasoned). It mattered past the log: a pin in a second commit before that
  frame read a scroll height short of the lift and left the scroll up by the lift. A test
  holds that, and none of the 57 stories reached it (measured). The transform written by hand stays
  beside the motion value: Motion only writes in a microtask or a frame, and a pin in the commit
  flushed right after, before either, reads the scroll height through it.
- A pin waits for the commit that holds what its rows measured, so a lift takes what landed and no
  row drops first. A pin used to raise the lift by the rows' estimates in the commit they mounted,
  and the next commit moved only the scroll back, so the difference stayed in the lift and every row
  dropped by it in the frame they landed, then glided up. It reached pictures. Following a band of
  the thread through the screencast, the first picture after the landing read 12 px on a send at
  the end of 120 lines and 92 to 94 px on a short catch-up, 20 of 20 runs each. That catch-up's rows
  fit the screen once measured, so it glided 98 px for nothing. Now the send lifts 84 px rather than
  96 and that catch-up not at all, and the first picture reads 0 px, 20 of 20 each (measured in
  Chromium at 390x844 and 4x CPU throttling).
- Lowering the lift when the scroll moves back cannot replace the wait. Of the 64 px that send's
  scroll came back, 52 belonged to a row above the screen, mounted for the lift and measuring short:
  the rows under it hold their place with the lift untouched, so taking it from the lift would throw
  them up. Writing the measured height into the content before the pin does not do it either. A
  commit places its rows at their estimated starts, and they overflow a shorter content: that
  catch-up measured 576 px and still scrolled 30 px (all measured).
- A landing that would reach past a screen pins without waiting, since it lifts a screen whatever
  it measures. Waiting there put a commit between the pin and the rows the lift shows, and the
  worst frame of a long catch-up went from 145 to 163 ms to 221 to 251, and of one over a big gap
  from 142 to 172 ms to 210 to 248. Without it they read 143 to 171 and 139 to 163, and over tall
  rows and over turns they stay where they were, 159 to 176 against 159 to 181 and 77 to 97 against
  82 to 99 (eight runs each, measured as above). Layout shift read 0 throughout.
- A following thread measures a row itself as it mounts. TanStack Virtual's ref skips that while it
  reads a scroll, for 150 ms after the last one (read in its source), and leaves it to a
  `ResizeObserver` report that renders a frame later, so a batch landing that soon pinned at the
  estimate and came back in the next frame. At four times a story's speed that read as a row 96 px
  up and then 12 px down, 6 of 6 runs of a send landing before the thread had landed, so with no
  lift to hide it; now 84 px up, 6 of 6 (measured as above). Under a lift it would have been the same
  drop a frame late (reasoned, not measured). A row that changes height after it mounted is not
  covered: the lift takes growth and not a shrink, so its rows still drop by it.
- TanStack Virtual corrects `scrollTop` itself when a row above the top first measures away
  from its estimate, and writes the correction before React commits the new heights. A thread
  that read every upward move as the user leaving lost the end on open: 299 rows of 20 px (every
  tenth 200 px) under an 84 px estimate, each rendering 400 extra hidden elements, and a last row
  of 2000 px opened 1468 px short of the end with following off in Chromium at 6x CPU
  throttling, 3 of 3 opens, after a correction moved the scroll up 396 px. Without the extra
  elements it landed 3 of 3, throttled or not (measured). Two guards each fixed it alone, 3 of
  3: while following, the virtualizer keeps only corrections for growth above the top, since
  the thread pins itself; and an upward move counts as leaving only after a touch, wheel, key, mouse or
  pen press, until the scroll settles. The thread keeps both. Growth keeps its correction
  because the pin judges a slide by how far it moved the scroll, so an uncorrected row growing
  above the top would slide the reveal for it (read in the pin's effect).
- A following thread pins again when a scroll settles, after any scroll the user did not start
  and after one during which it asked for a pin, so a write lost to a scroll still under way is
  made again. That iOS drops a `scrollTop` write during momentum is not measured yet. After a
  user's own scroll with no pin asked it stays put, so a nudge that stays inside the follow
  threshold is left where the finger put it.
- The chat route remounts its screen whenever the machine or pane changes, so following and the
  virtualizer's size cache start fresh per pane. A subagent opens as a child route, so the chat
  stays mounted under it and pins to the end when it is uncovered again.
- Motion reads `prefers-reduced-motion` once per module instance, so a test file that renders
  with it off and then on gets the first answer both times (measured: the reduced test saw the
  full animation). A component's reduced-motion tests live in a file of their own.
- The composer's `/` list comes from the folders Claude Code documents, read by the agent, not from
  the transcript. Claude writes a `skill_listing` attachment into a session's transcript, but only
  together with the first prompt (6 of 7 crook sessions on the laptop had one, at lines 12 to 25;
  the seventh had only run `/clear`), and it lists what the model may invoke: every skill marked
  `disable-model-invocation`, which is what a user types `/` for, was missing, and it carries no
  scope or argument hint (measured). The agent reads the managed folder, the personal folder of
  the Claude root the session's transcript lives in, `.claude/skills` from the checkout root down
  to the pane's folder (a worktree without one falls back to its main checkout's), the
  `commands` folders and the enabled plugins, honours `user-invocable: false` and
  `skillOverrides` `off`, and sends the list on the pane's transcript watch right after the
  session opens, so only an open chat pays for it: crook's list read in about 13 ms (measured).
  Claude Code's bundled skills and claude.ai synced ones are not on disk and stay out; the
  composer adds only the built-ins that work over a PTY.
- Claude Code's Read tool result numbers its lines as `1	…` today and `     1→…` in older
  transcripts (measured in local transcripts). Strip either only when every line carries it.
- An agent with a long transcript to look at in a probe needs no tokens: `herdr agent start …
  --kind claude -- --resume <session>` reopens an earlier Claude session in the pane, and the chat
  tails its file (measured in the JC-101 probe).
- Vite's dev and preview servers check the `Host` header against `allowedHosts` for HTTP
  requests and the HMR socket, but not for a proxied WebSocket upgrade (measured on 8.3.4: an
  upgrade with `Host: attacker.example` was proxied). A proxy rule that trusts an upgrade does
  its own host check, and the `Host` it compares against must be a fixed name, never another
  request header: a DNS-rebound page sends a matching `Host` and `Origin`.

:::tip
What the agent costs over an hour, measured on the laptop, which decided what got changed.

Claude Code runs a hook command three times per tool call: 33 hook runs for 11 calls in a real
session (pre, post and batch). The busiest recent hour held 292 tool calls and the median active
hour 19, against 6.1 CPU-seconds an hour for the whole running agent, watched for 600 s beside
three busy Claudes. A hook that started the whole compiled agent took 125 ms of CPU and a peak
of 52 MB per run, so hook processes were the largest cost by far: 110 CPU-seconds in that busiest
hour. Bun parses what a binary imports at its start, so only parsing less helps. Bytecode reached
68 ms, a lazy import without splitting 47 ms, Effect's core with splitting 17 ms, and a forwarder
importing nothing with splitting 4.4 ms of CPU, 4.2 ms of wall time and 19.7 MB, with 30 of 30
payloads delivered.

A real Claude's 22 s turn of 12 tool calls made herdr send 4 events: two status flips, one title
change and one tab rename. A title set by escape code sends one `pane_updated` per change, and
printing output sent 1 in 20 s, so nothing a working Claude does floods the subscription. The
last week's transcripts held a median of 4 turns per active hour, a 90th percentile of 26 and at
most 40. A re-read of 8 Claude panes and 15 recent places cost 20 to 38 ms of the agent's CPU and
4 to 20 ms of herdr's, about 10 CPU-seconds at the busiest and under one in a median hour, so the
re-read stayed as it is. Waiting for a session's file costs 16.95 ms of CPU against a look's 1.92 ms
across 37 project folders, about 0.17 CPU-seconds an hour at 11 sessions, so that stayed too.
:::

:::tip
Bun, measured on 1.4.3, for a client that writes to a Unix socket:

- `socket.write` returns how many bytes it took, and the rest has to wait for `drain`. A 4 MiB
  write that ignored it lost what did not fit.
- `socket.end()` closes at once, so the client's `close` fires before the server has handled the
  bytes, which still arrive: 0.2 to 1.3 ms against a half-open server holding the connection for
  300 ms. A test polls for what the server did rather than trusting the close.
  `allowHalfOpen` with `shutdown(true)` hung: the client got `end` and never `close`.
:::

:::warning
A probe that starts a real Claude closes its pane, stops its named herdr session and deletes it in the same command that started it, never in a later one. A run cut off between the two left 19 Claudes running for about 11 hours and ran the laptop out of memory (measured). Deleting matters as much as stopping: the session file keeps the agents herdr started, so the next `server` on that name may bring them back (inferred, not measured). Start one real Claude at a time, never from a loop, a retry or a test, and use `herdr pane report-agent` whenever the state is all the probe needs.

A real Claude under a temporary `CLAUDE_CONFIG_DIR` has no login. The two spikes that needed one copied the `claudeAiOauth` entry of `~/.claude/.credentials.json` there and deleted the copy at teardown, in the same command that started the Claude (each run took about 40 s, with over an hour left on the access token). That entry also carries the refresh token, so a copy that outlives its run is a leaked login: drop `refreshToken` from the copy, check the access token has longer left than the run, and delete the copy in that same command.
:::

:::tip
A prompt herdr types into a Claude that is writing text or compacting queues exactly as one typed
at the keyboard does (measured on Claude Code 2.1.309 and herdr 0.9.5, one Claude, three cases; a
prompt typed during a tool call went unmeasured, see below): the pane lists
it above the input with "ctrl+enter to send now", and Claude takes it when the turn or the
compaction ends, as a user entry of its own whose `promptSource` is `queued`. Nothing was dropped or
merged: two prompts typed 0.3 s apart became two turns in the order sent, the second queued behind
the first. So the agent delivers a prompt the moment it is sent and holds nothing back, and the
phone labels one sent while Claude works as queued, one row per send, until the transcript holds it.

While a prompt waits in that queue the transcript holds only a `queue-operation` enqueue entry, and
the one written during a compaction carries no text (measured), so nothing in the transcript names
a queued prompt reliably before Claude takes it; the phone keeps its own row until then. Right
after `/compact` was typed herdr still read the agent as idle, and as working 1.3 s later.

The case of a prompt typed during a tool call went unmeasured: Claude Code refuses a standalone
foreground `sleep` with a `Blocked: standalone sleep` tool error and reruns it in the background,
so a probe cannot hold a tool call open with one. The background command's completion then starts
a turn of its own, enqueued as a task notification.
:::

- Shiki's JavaScript regex engine compiles a grammar's patterns the first time it meets them, so
  the first blocks of each language cost far more than the rest: over one real transcript's 204
  code blocks the first pass took 1507 ms and the second 219 ms, and a nine-line TypeScript block
  took 434 ms on its own (measured in Bun on a desktop). In a browser that froze scrolling for over
  half a second at 4x CPU throttling. Highlighting therefore runs in a Web Worker, and the main
  thread only renders the tokens it sends back.
- A worker that awaits its own setup before it listens for messages loses every message posted
  in the meantime: the highlighter answered nothing until it listened first and loaded lazily
  (measured).
- A clock read at the top of a screen re-renders the whole screen every second. In the chat that
  re-rendered every visible row; moving the clock into the leaves that show an elapsed time, each
  ticking only while its span is running, halved the idle render time (measured at 4x
  throttling, about 60 ms to about 28 ms per five seconds).
- A virtualized thread unmounts rows as they scroll away, and a remount parses its markdown again.
  react-markdown's `Markdown` export is a plain function without hooks, so the thread keeps one
  render cache for its lifetime, keyed by the text, and a remounted row reuses the element tree.
  The cache lives and dies with the thread rather than with the page, so it needs no size cap.
- An atom update renders synchronously, so a transcript that arrives while a chat slides in
  blocked the slide's frames. Reading it through `useDeferredValue` lets React render the rows in
  yielding slices: the worst frame of the slide went from about 255 ms to about 175 ms at 4x
  throttling (measured).
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
  therefore sizes itself to `visualViewport.height` and moves to its `offsetTop` whenever the
  visual viewport is shorter than the window at scale 1, pins the page back to the top while
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
- A focus test compares `document.activeElement` with the element itself. Focus that fell to the
  body still passes a check on its `textContent`, which holds every label on the page (measured: a
  test asserting the tab's text passed with focus on the body).
- Re-deriving the whole chat on every transcript event grew with its length. One event of one or
  two lines cost 112, 134, 182 and 316 ms of main-thread work at 252, 1008, 2007 and 4005 lines,
  and most of that was creating a row element for every item (66 ms at 2007 lines, React's
  development build) and re-deriving every item (19 ms). The chat's items are now a fold over
  the appended lines, and each unchanged item keeps its row element. An event then cost 72 to
  81 ms at every length from 1008 to 4005 lines, of which the fold was 0.6 to 1.4 ms (measured on
  the dev server in Chromium at 4x CPU throttling, a synthetic transcript, sampled by the CDP
  profiler; the first run in a fresh page reads higher, 112 before and 81 and 121 after).
- The fold places and drafts each new line on its own, then re-resolves only the items that can
  still change. A tool call's result or a task notification can land in any later batch. The
  last turn's calls change when the next turn starts or the activity moves. Every subagent run
  depends on the rosters, the activity and the current session. Lines that do not extend the last
  ones (a reset, a cached view, the whole transcript) start the fold over. Whether they extend is
  judged by the identity of the first and last line the fold saw: the transcript view only
  appends lines or starts over with new ones, so a middle line never changes. Tests hold it equal to
  a full recompute at every batch size of real transcripts, with the activity both changing and
  steady: with it changing on every batch, a dropped notice went unnoticed, because the activity
  already re-resolved every subagent run (measured).
- Appending to the transcript view copies its line array, which costs 0.1 to 0.2 ms per event at
  4005 lines and 4x throttling (measured), so the view keeps a plain array.
- Every herd update re-rendered the open chat, 10 of 10 updates from another machine. Three
  values the chat reads were rebuilt on each one: the chat's model, the connection view (its sync
  time moves with every herd) and each command action's progress, which builds a fresh `Idle`
  per herd. Structural equality on the model and on the progress, the model holding only what
  the chat shows, and reading only whether it can act and whether it is stale from the
  connection brought that to 0 of 10 (measured by counting component renders through React's
  devtools hook).
- The Agents page stays mounted under a pushed chat. It used to re-render whole on every herd
  update and every clock second: with fifteen cards on three machines and a chat open, each herd
  render was about 680 component renders, and the page cost 373 to 394 ms of main-thread task
  time per herd update and 144 to 186 ms per idle second at 4x throttling. Covered, it now holds
  what it shows and its clocks stop: 0 herd-page renders per herd update from another machine and
  per clock second, and the task time per herd update fell to 17 to 31 ms, the rest of the app.
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
  as above, 3 machines). A herd update to the shown list itself stays about what it was, 22 to 29 ms
  before and 26 to 31 after, and is left alone.
- What a status flip costs outside the screen is too small to spend code on, so deltas stay unbuilt.
  With 15 agents the phone encoded its herd snapshot in about 1 ms and wrote it to IndexedDB in about 1
  ms at 4x CPU throttling, 56 ms at worst. A flip sends one machine's entry, 2440
  bytes at 5 agents, which decodes in under 1 ms at 4x. The hub's upsert took a median of 0.011 to
  0.014 ms and at most 8 ms over 6000 writes to a file (all measured, Chromium and Bun on the laptop).
- A command's keep-alive atom costs 2.26 KB of heap per send (measured over 1000 sends, after a GC), so
  a phone would need 10000 sends in one app lifetime to hold 22 MB. It stays until something else
  changes that atom.
- The memory the transcript cache keeps per chat is small enough that nothing evicts it: 0.2 MB of heap
  for a 512 KB tail of one real transcript, 1 MB for 3 MB of it, 4 MB for the whole 13 MB, and 27.9 MB
  for the biggest local transcript, 118 MB, read whole (measured after a GC). Evicting would also make
  a reopen read the store, and only a reopen from memory has its rows in the first render.
- Saving a chat encodes it and writes it on the main thread, and reading it back costs about the same.
  At 4x, encode then write took about 4 ms for a 512 KB tail, 20 ms for 3 MB, 65 ms for a whole 13 MB
  and 388 ms for the whole 118 MB; read then decode took about 4, 20, 63 and 294 ms (measured, medians
  of three). Only a whole read of a huge transcript reaches a stall worth a frame, and a chat saves on
  its caught-up mark, on leaving and on hiding, so that stays as it is.
- A watch goes out when the socket is dialed, not when the first herd lands. The socket holds what is
  written before it opens, and the hub admits a watch from its own state, so nothing depended on the
  order. A resume on a fresh socket, through the real link, a local hub and agent and a proxy delaying
  each WebSocket message 150 ms, went from 960 to 1034 ms to 746 to 780 ms from the dial to the caught-up
  mark (five runs each). A tap on a live link was never affected, and neither are calls, which still
  hold for the first herd. A resume reads the last herd the phone knew to decide whether the agent
  sends the caught-up mark, so with no herd at all it still waits for the first one. Read without one,
  a chat with nothing cached says "No messages yet" a second later and a cached chat lands with no
  catch-up (read in the chat's machine, not measured). A dial that fails before its first herd ends the watch quietly, as any lost connection
  does, and the next dial asks again. Each dial resumes, so a failing backoff restarts the chat's
  notice wait, and the link's own notice dims the chat at that same second, which hides the capsule
  (reasoned, not measured).
- A covered screen reads atoms through a derived atom that returns its own previous value while
  the covered flag is set and reads nothing else, so a herd update wakes none of its components.
  The flag is an atom set in a layout effect rather than a context value, since a context change
  re-renders every reader on cover, as the chat starts its slide (reasoned, not measured).
  Elapsed times follow one shared ticker atom, so every label on a page changes in one commit,
  and stop following it while covered; uncovering sets each to the current time at once.
- A screen that first mounts already covered, such as the herd under a chat opened cold from a
  link, holds the first value it read until it is uncovered, even an empty one (reasoned, not
  measured).
- React's hidden `Activity` was ruled out: it hides its tree with `display: none` (read in
  react-dom's source), and the herd shows under a chat while it slides in and under the back swipe.
- Uncovering shows the current herd without its animations. Remounting the list was ruled out: the
  chat returns focus to the card that opened it as it unmounts, and a remount replaces that card.
  Setting the covered atom re-renders its readers in a second synchronous commit (reasoned, not
  measured). Motion's global instant flag is held from that commit's insertion effects to the
  scope's own passive effect, which runs after its descendants' (reasoned, not measured): Motion
  starts exits in layout effects and other value animations in passive ones, and only syncs props
  in its insertion effects (read in its source). Motion's own instant transition holds the flag two
  frames, and the toast a close from the chat shows once the herd is back would land inside them
  (reasoned, not measured). Layout animations start a frame later (reasoned, not measured), so
  the projection root's next update is blocked instead, and only when one is pending: a block with
  nothing to consume it skips the next real reorder (read in Motion's source). The block is
  global, so any other layout animation updating in that same commit lands instantly too.
- Those global switches reach nothing outside the herd, because the herd is uncovered only once the
  pushed screen has gone: a back tap and a swipe released past the threshold both slide the screen
  out in full and navigate when the slide completes, and a swipe released short never navigates.
  At 4x throttling the chat's slide-out took 30 and 32 frames, about 500 ms, the same curve as its
  slide-in. The flag came on about 180 and 240 ms after the chat sat fully off screen, stayed on for 26
  to 30 ms, and no frame showed the chat after that (measured in Chromium at 390x844, one run of
  each). The tab bar runs no Motion animation.
- CSS transitions still played on uncover (the status pill's colours, measured), so the scope
  disables transitions for its descendants until the second animation frame after: the first
  frame's callbacks run before that frame computes the new styles (reasoned, not measured). With
  it, 3 of 3 uncovers ran no transition and no frame of layout animation, while a reorder once
  shown still played its spring, 99 card frames of it (measured in Chromium).
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
- A laptop catch-up is judged once per open, from the lines the cache held: the view that ends the
  catch-up counts as one only if the cached view's last line sits at the same index in it (lines
  are appended, so the same object), and its new rows are the row keys the cached lines do not
  give. A row the cache held keeps its key as more lines land, which a test holds over real
  transcripts at every cut. A chat that opened current, a cold open, a watch that failed or started
  over, and a catch-up that added no row get nothing. The fold judges the lines when the read ends,
  and the screen turns them into row keys, since only it has rows.
- The catch-up shows nothing but the thread's "Catching up" capsule, past its first second, while it
  waits for the fresher view. Its rows then land in one commit under one ordinary lift capped at a screen,
  with a static divider above the first new row. Releasing them one row at a time, with a chip
  carried down a trail, held a reopen back from its end: reopening a thread of 120 lines with 40
  new ones took 267 to 273 frames, 5.1 to 5.5 s of lift, and ran past a story's wait for its last
  line. Landed at once it takes one lift of 25 to 26 frames, about 490 ms, of at most the 660 px
  screen (all measured in Chromium at 390x844 and 4x CPU throttling, four runs each).
- A thread starts lifting only once its rows are rendered and its height has held still for a
  fade's length. A fixed fade's length from the first row armed it while the first measures were
  still arriving, so a thread opened already holding 120 lines glided 151 to 156 px for about
  400 ms, 219 to 271 ms after it first showed: on its first mount in 4 of 4 runs, and on a reopen in
  2 of 4. With the wait restarting on each change of height no open lifted in 16 of 16 runs, long or
  short, cold or cached, and a catch-up landing after it still lifted (measured as above). A cold
  open tapped from a card did not lift with the fixed wait either, in 8 of 8 runs, so the race
  belongs to a thread that mounts holding its rows.

:::tip
Checking the web app against real data, measured:

- The agent has no entrypoint yet. A probe script composes its layers and dials the hub directly
  with the two headers the proxy would add, `X-ExeDev-Email` and `X-ExeDev-Token-Ctx` carrying
  `{"machine":"<id>"}`; the token header is then not needed. Every herdr-reading layer needs
  `HerdrClient` under it, not merged beside it.
- The hub refuses to start on a `CROOK_HUB_ORIGIN` that is not https, a local one included. Any
  https name works locally, because the Vite proxy sends that same value as the socket's `Origin`.
- `pkill -f <pattern>` also matches the shell that runs it when the pattern is in its own command
  line, and kills the call. Stop what you started by its saved pid.
- A named herdr session runs headless with `herdr --session <name> server`. From inside a herdr
  pane, unset `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID` and `HERDR_ENV`, and point
  `HERDR_SOCKET_PATH` at the named session's socket, or every command lands in the user's own
  session. Never use the default one.
- `herdr pane report-agent` puts an agent with a chosen status in any shell pane, and
  `release-agent` takes it out, so a herd in every state needs no running Claude.
  `release-agent` takes the pane id before its options, `release-agent <pane> --agent claude
  --source <name>`; options first is refused. Such a fake
  takes no keys: `agent.send_keys` answers it `agent_not_ready`, so key delivery is tested
  against scripted herdr responses instead.
- The agent takes an agent's title from the pane's terminal title before herdr's own `title`. An
  OSC 0 escape sets it, and a shell prompt resets it, so hold the pane in a long `sleep` after it.
- A browser tab shows the install screen. An init script that makes `navigator.standalone` true
  gets past it.
- Bun's `fetch` goes through `HTTPS_PROXY`. A hub started with it pointing at a local listener
  that closes every connection reaches no third party: a Hark call arrives there as
  `CONNECT hark.ryan.ceo:443` and fails as `HarkUnreachable`. That is how a hub with a Hark token
  is checked without calling Hark, whose base URL is fixed.
- Vite's dev server answers a POST to `/__exe.dev/logout` with 404, so Log out fails honestly
  there; a browser route that answers it is what reaches the logged-out screen.
- The agent has no long-running entry of its own yet, so a probe composes its layers itself. It
  exits on a config error before dialing unless `CROOK_MACHINE_ID` is set. Such a script can sit in
  the agent member's own `tmp/`, which is ignored at any depth, and Bun resolves the member's
  leaves and dependencies from there.
- A herdr server started under `env -i` with only `HOME`, `PATH`, `USER`, `SHELL`, `TERM` and
  `LANG` hands none of Claude's variables to its panes. `command claude --permission-mode default`
  typed into one skips a user's shell function that turns auto mode on, and starts in manual mode,
  so a Bash command it runs asks first (measured).
- `herdr pane report-agent --agent-session-id` does not put the id where the agent reads it: `agent get` showed no `agent_session` afterwards (measured on herdr 0.9.5). A probe that needs a pane's Claude session without a real Claude runs a copy of `sleep` named `claude` in the pane with `CLAUDE_CONFIG_DIR` set, and writes `<that dir>/sessions/<pid>.json` holding the pid, the session id and the process start time from field 22 of `/proc/<pid>/stat`, which is the pid-file route the agent resolves sessions through. A file without the pid is refused with a warning in the agent's log and the chat waits on "Loading the conversation" (measured).
- The installed agent's `run` dials `CROOK_HUB_URL` (the `/rpc/agent` path included) with its token, and a local hub wants the two exe.dev headers instead, so a probe puts a small Bun WebSocket proxy between them that adds `X-ExeDev-Email` and `X-ExeDev-Token-Ctx`.
- agent-browser scrolls an element into view before it clicks it, which moves the scroll container
  around it. A scroll position read after such a click is the tool's, not the app's.
- A finger scroll in Chromium is driven over CDP with `Input.dispatchTouchEvent` (start, a run of
  moves, end) once touch emulation is on: it scrolled the thread and its momentum played out.
  `Input.synthesizeScrollGesture` with a touch source fired `touchstart` and `touchend` and never
  scrolled it (measured). One script throttles the CPU, drives the page and reads it back over a
  single CDP connection.
- herdr keeps its plugin registry under `$XDG_CONFIG_HOME/herdr`, and plugins are global to the
  user across sessions, so a plugin is linked for a probe only with `XDG_CONFIG_HOME` and `HOME`
  pointed under the worktree's `tmp/`; the user's own registry stayed untouched (measured). Never
  link or install a plugin into the default config.
- A named session's socket must fit in a Unix socket path (108 bytes): under a deep
  `XDG_CONFIG_HOME` the server exited at once with "local socket name length exceeds capacity".
  The longest name is `herdr/sessions/<name>/herdr-client.sock`, so keep the probe's
  `XDG_CONFIG_HOME` one short directory under `tmp/`.
- A fresh herdr config opens an onboarding dialog in the first client, and its second screen
  installs agent integrations on Enter. `onboarding = false` in the probe's `herdr/config.toml`
  keeps it from opening; Escape does not close it while a popup holds the focus (measured).
- `herdr plugin install` takes GitHub shorthand only, but it clones with the `git` it finds, so a
  probe points `GIT_CONFIG_GLOBAL` at a file whose `url."file:///<bare copy>/".insteadOf` is
  `https://github.com/`, and herdr installs from a local bare copy of a branch (measured). It needs
  no running server.
- A plugin action's output reaches only herdr's plugin log (`herdr plugin log list`). A plugin pane
  or popup opens only into an active workspace, so create one first, and a popup shows only in an
  attached client: attach one inside termctrl to read and drive it.
:::

:::warning
A new pane's shell is ready for `agent.start` only once its rc files have run, and nothing herdr
returns says when that is. herdr 0.9.5 answers `agent_pane_busy` while any child of the shell holds
the pane's foreground and accepts the moment the shell is alone there, mid-init included: with the
user's zshrc, whose start-up runs `herdr`, `jq`, `mise`, `fzf` and `wt` one after another, an
`agent.start` retried right after the setup line was first accepted 0 to 274 ms later across 20
launches (measured). A fixed retry budget sized from a bare shell's 27 ms spawn loses that race
whenever the rc work runs long. Here the one launch that lost it opened a new workspace, and every
launch into an existing workspace was accepted within 25 ms, so which launch fails is timing, not
the workspace being reused.

So a launch types its setup line with a `printf` that prints a ready mark, and waits for that mark
with `pane.wait_for_output` before it asks herdr to start the agent. The format splits the mark in
two, so the echo of the typed line never contains it and only a shell that ran the line can match.
The mark appeared 401 to 708 ms after the line was sent, over ten launches that opened a workspace
and ten that added a tab to an existing one; the slowest of each was within 5 ms of the other
(measured). After the mark the prompt hooks (`mise`'s precmd) still held the foreground for up to
58 ms, so the start is still retried while busy, for ten times that.

herdr checks `pane.wait_for_output` on a 100 ms grid: every wait ended within 8 ms after 400, 500,
600 or 700 ms (measured). A timed-out wait answers the code `timeout`. The socket API has no
`pane.run` (read in herdr's bundled API schema), so text and Enter stays `pane.send_input`, which
answers once the keys are in, at least 300 ms before the line's own output appeared (measured).
:::

:::tip
A read herdr never answers fails as a named timeout, ten times the slowest read measured. Measured
on herdr 0.9.5, an isolated session with 20 panes reporting agents, 3 runs, each read alone and as
one refresh (a snapshot, then every pane's process info and detection read at once), idle and with
8 panes printing in a loop: `session.snapshot` had a median of 104 to 119 ms and a slowest of
201 ms, with the panes printing; `pane.process_info` and `pane.read` a median of 101 to 104 ms and
a slowest of 144 ms; `events.subscribe` a median of 1 to 4 ms and a slowest of 118 ms; a whole
refresh a slowest of 270 ms. A lone call can answer in under 1 ms, but one right after another
waits about 100 ms, which reads as a 100 ms grid (not read in its source). Only reads carry the timeout. A call
that legitimately waits, such as a prompt, an agent start, a wait for output or a worktree, stays
under the budget of the command around it, since timing out a call that has already acted says
nothing about whether it landed.

A refresh runs inside the state's lock, so its reads being bounded is what bounds every other state
change. When an invalidation's re-read times out the state says herdr is lost at once and the
following subscription is told, so the reconnect loop takes over and clears the mark when herdr
answers again; nothing else would, since an idle machine sends no events. A hung herdr with an idle
subscription and nobody asking for a re-read goes unnoticed: nothing polls.

An agent reads herdr once as it starts, and on any failure attaches with an empty state marked lost
instead of retrying. Retrying before it attached left an agent started before herdr showing the
machine as offline (all four tests of it hung until their 20 s limit before the fix, measured). That
state says nothing about the panes, so the hub keeps the machine's seen marks and herdr version
through any lost state rather than treating its empty list as every pane gone.

`pane.process_info` leaves out `foreground_processes` and `foreground_process_group_id` when it
catches a pane's shell between two children (measured: 1 of 47 raw reads on panes running a printing
loop; the first of 14 failed calls in one loaded run was this). crook's schema requires the first,
so such a read fails as a changed protocol and that pane goes without a session for that one
refresh. Whether a pane whose foreground stays Claude ever shows it is not measured.
:::

:::tip
Nothing in herdr announces a session change. Two runs of a real Claude Code 2.1.317 under herdr 0.9.5, with herdr's own `SessionStart` hook installed and, in the first, every herdr event logged:

- `/clear` moved the pid file's session id 9 to 79 ms after `agent.prompt` answered (6 of them), and the new transcript file landed 143 to 207 ms after that (3 of them). The events around it belong to the pane's title, not to the session: `pane_updated` 37 and 55 ms after the pid file, still carrying the old id, and `tab_renamed` about 240 ms after it. A `/clear` with no title left to change, such as one right after another, fired no event at all.
- The hook's report lands later than the pid file and fires no event of its own (measured there and by reporting directly), so a re-read on one of those title events read the old id and nothing followed to read the new one.
- `/resume <id>` moved the id 110 and 252 ms after `agent.prompt` answered. It does go through herdr's status, working then idle, and a `pane_updated` 82 ms after the pid file carried the new id.
- A `git switch` typed in a pane or run from outside it renames a new `HEAD` into the git directory. herdr's tab label shows the branch only until the pane has a title, so a `tab_renamed` follows 222 to 514 ms later only while it does (measured for the label, reasoned for a pane with a title).

So the agent watches one folder per Claude root, which holds the pid files, and one git directory per checkout an agent sits in, which holds `HEAD`. `HEAD` is replaced by a rename, so a watch on the file itself would die with it. An agent with one root, one checkout and one session held 4 inotify watches at rest. An event is filtered by name before anything is read, and a re-read only follows if the file now says something else: Claude rewrites its pid file on every status change, `busy`, `idle` and `waiting`, and keeps `.key` files beside it, all of which land in the same folder, while a git directory sees every lock file. A rewrite under the same session cost 0.45 to 0.95 ms of CPU, and a lock file created and renamed in a git directory 0.35 to 1.24 ms, against 10 to 220 ms for 10 s of an agent left alone (Bun on the laptop, 2000 of each, three runs; the spread is what else the laptop ran). Over one 180 s window on the laptop with Claudes running, the pid folder saw 12 events, and the main checkout's git directory 1.

From a file changing to the agent's publish leaving for the hub: 106 to 126 ms for a real Claude's `/clear` and `/resume` (4 changes, among them the second `/clear` of a pair, the kind that fires no herdr event), and over three runs with a copy of `sleep` named `claude` and a pid file written by hand, 24 to 247 ms for a session and 17 to 252 ms for a real `git switch`, 12 of each per run, most near 230 ms. The re-read's herdr calls are that time (reasoned from the 100 ms grid above, not measured apart). A pair of session changes 20 ms apart published once in 9 of 9, on the latest. A pair of switches ended on the latest as well, usually with a further publish for herdr's own tab label. Twenty rewrites under one session, two commits, a status and a switch to the branch already out published nothing.

A session change itself is dearer, re-read and publish and following the new session together: 28 to 97 ms of CPU over 100 changes, three runs. Waiting for a new session's transcript opens one watch per project folder, so with 37 folders the agent went from 4 watches to 40 and back on a change (a read every 2 ms saw 40 in 8 of 10 changes and fewer in the rest).

herdr's reported session is trusted only while a pid file names it. Trusting it first can leave a `/clear` stale: the re-read the pid file asks for can arrive before the hook reports (herdr still carried the old id 55 ms after the pid file moved), and the report wakes nothing. When it no longer holds, the pane's process is asked, which costs one more read of herdr for that one refresh, and what herdr reports is the fallback if the process cannot say. A pid file left by a dead process still counts as naming its session, so a report of that session stays trusted until the next read after the hook lands (reasoned, not measured).
:::

:::tip
What a bare picker does on real Claude Code 2.1.317 over herdr 0.9.5's `agent.prompt` (three probe runs of one Claude each, every command named here sent once, all measured). Each opened a dialog, the pid file's status said `waiting`, and no line reached the transcript within 3 s. herdr keeps reading idle for `/cost`, `/status`, `/usage`, `/stats`, `/help`, `/config`, `/permissions`, `/hooks`, `/plugin`, `/theme`, `/tasks`, `/bashes`, `/export`, `/add-dir`, `/rewind`, `/sandbox`, `/privacy-settings`, `/feedback`, `/resume` and `/model`, and `agent.prompt` is accepted; it reads blocked for `/mcp`, `/memory`, `/release-notes`, `/effort` and `/fast`, which refuse the next prompt with `agent_blocked` until Escape writes "Cancelled". What the next prompt does was tried on three of the idle ones. Into `/cost` and `/help` it was accepted, reached no transcript, and left the dialog open (one run each). Into bare `/model` its text and Enter land in the picker, which answers "Set model to Opus 5.5 and saved as your default for new sessions": the prompt is lost and a default has changed. The other seventeen were not tried, so that they eat a prompt is extrapolated from those three.

An argument does not always keep a dialog away. `/model opus` on the model already set, `/effort high`, `/effort status`, `/fast on`, `/fast off`, `/rename x` and `/resume <unknown id>` answered with no dialog, and `/theme dark` opened one. `/model sonnet` is the trap: on a fresh session it sets the model directly (2 runs), and with a conversation behind it asks "Switch model?", where the next prompt's text and Enter confirmed the switch and the prompt reached no transcript (2 of 2). So the composer refuses only the bare commands measured to open a dialog and `/theme` with its argument, keeps `/model <name>` working and leaves the rest to the note below, since refusing what works is its own bug. A session's skill of the same name is not refused. `/login`, `/logout`, `/exit` and `/init` were never run, and they go through.

`/context`, `/agents`, `/output-style`, `/color`, `/copy`, `/ide` and a bare `/rename` ran with no dialog. A command Claude does not know writes a `system/informational` entry reading `Unknown command: …`.

A command's first line reached the transcript 344 to 2082 ms after the send (`/rename`, which generates a name, is the slowest; the next are 1208 ms and 992 ms), and the prompt call itself answered in about 302 to 318 ms. Every command with no line in 3 s was in a dialog, except `/effort high` sent during a turn, which wrote no line at all and took effect (its footer showed it). So a slash send's Sent row gives up after 6 s, a margin chosen at about three times the slowest, and the composer says the command may have opened a dialog that would take the next message. The row cannot tell a dialog from a command that writes nothing, and says "may" because of that. Only a command's own line, its output, or the unknown-command notice ends the wait: an interruption or a notice about something else says nothing about the command.
:::

:::tip
The pid file says when Claude would hand the next prompt to a dialog, which herdr cannot say for a slash command's. Read in Claude Code 2.1.317's binary, `status` is `waiting` whenever `waitingFor` is set: an elicitation says `input needed`, a dialog its own reason with `permission prompt` as the default, a local command's screen `dialog open`. On a real 2.1.318 with herdr 0.9.5, one Claude per run (all measured): `/model sonnet` with a conversation behind it wrote `waiting` and `dialog open` 9 and 63 ms after `agent.prompt` answered, and herdr read idle throughout. Escape wrote `idle` 62 ms after the keys answered, and an answer 100 ms. A permission prompt's `waiting` came 143 ms before herdr's `blocked`, an Ask's 69 ms. `/effort status` wrote `waiting` for 28 ms with no dialog on screen, and `/context` and `/rename` wrote none.

The reason is not what tells them apart: the row does. An open Ask sends an answer, blocked without an Ask already disables the composer, and only a plain prompt is ever refused, so an answer, keys, a decline's follow-up and a launch all still go. The phone refuses on the press and keeps the draft, as a bare picker's refusal does, and shows nothing before it: a line up ahead would flash for the gap before each `blocked` and for that 28 ms. What it shows is worked out from the words refused and the current row, so nothing has to clear it and it cannot outlive the wait.

A change reached a phone over a local socket, through real herdr, agent and hub with a stand-in's pid file, in 207 to 226 ms going to waiting, with one at 108 ms, and 206 to 213 ms coming back (three runs of 12 each way, measured; a real network adds its own). The agent reads the file again right before it types a prompt, 0.04 ms of wall time and about 0.09 ms of CPU for the file and its `/proc` check (2000 reads, three runs, measured), so a phone that has not heard yet is refused there. What is left is a prompt whose read lands in the 9 to 63 ms before the file says so, or a dialog opening while the prompt is being typed, whose call takes 310 to 323 ms (reasoned from those numbers, not measured).

A pid file can outlive its Claude. `kill -9` left it saying `waiting`, while SIGTERM took it away in 53 ms and closing the pane in 7 ms, so a status counts only while a process with that pid and start time runs. herdr dropped the real Claude's agent 399 ms after the kill, and a stand-in's kill reached the phone as no longer waiting in 283 ms (one run of each, measured). Where `/proc` is missing nothing can vouch for a status, so it reads as not waiting, and the composer behaves as it did before this (reasoned, not measured).

The key is optional, so an agent too old to send it reads as not knowing and its prompts go as they always did. An older phone drops the key and is still refused at the agent. The refusal is the command failure herdr's own refusals use, with a code of its own: a new failure class would not decode on an older phone or hub, and a message that will not decode reaches every live request on the socket (reasoned from the entry on RPC failures, not measured). An older phone shows it as a generic refusal.
:::

:::tip
What a slash command writes, counted over 152 local main transcripts holding 1517 non-meta user text lines, Claude Code of mixed versions (measured). A skill's line opens with `<command-message>`, and 67 of 67 were followed by a meta line holding the skill's body, so it starts a turn. A built-in's opens with `<command-name>`, and 71 of 71 were followed by output: 57 as a user line of `<local-command-stdout>`, 14 as a system `local_command` entry. All 138 carry their tags at the very start of a plain string, with no text before them, so tags are read only there: a prompt quoting a tag stays a prompt. A further 8 system `local_command` entries carry a `<command-name>` of their own (`/cd`, `/resume`, `/login`), which reading only user lines used to drop.

A typed `/compact` also writes a plain user string before anything else. Of 35 such lines, 34 sit right before a manual compact boundary (32 exact, 2 with an argument), all 34 manual boundaries have one, and the other had a caveat and the next prompt after it with no command line. The line's stamp and the boundary's sit 8.3 to 73.5 s apart, so it is read as meta from the line alone, and it cannot wait for the boundary. `Compacted (ctrl+o to see full summary)` followed 34 of 34. The only other plain lines starting with a slash were 4 paths and 1 typo, which stay prompts. On an empty session `/compact` writes its caveat and command with `<local-command-stderr>Error: No messages to compact`, in place of a summary, and that one is shown.

A real `/compact` (Claude Code 2.1.317, one run): the plain line 422 ms after the send, herdr working at 476 ms, then the boundary, summary, caveat, command and output in one write at 8961 ms, idle at 8971 ms. A skill the probe wrote for itself: working at 462 ms, its line and its body at 495 ms, then an answer.

A `!cmd` typed in Claude writes `<bash-input>…</bash-input>`, then `<bash-stdout>…</bash-stdout><bash-stderr></bash-stderr>` with stderr merged into stdout, or `(Bash completed with no output)`, and it starts a real turn: 3 of 3 with herdr working and Claude answering. Locally only 1 such pair exists.

`(no content)` is what a dialog command writes when it closes: 1 local line, from `/plugin`, and `/plugin` and `/feedback` in a probe. The phone shows nothing for it. Backticks in an output carry a name to show as code (4 local lines, all `/model`), and `/context` writes an ANSI grid in system entries, which the row leaves to its own scrolling box.

All of it reuses the local command blocks on the wire, with one optional key saying the line opens a turn. A new block class would decode as unknown on every older phone, where a key it does not know is dropped and `! kill 1` reads as the note it always was. An agent too old to send the key still gets a command's bubble and output, with no turn start, and a plain `/compact` and raw bash lines stay as they were until it updates, since only the agent reads the file.

A command's bubble holds its size and place as its output lands, read per frame in Chromium at 390x844 and 4x CPU throttling: 44 px tall and 4 px below its row's top through Sent, the command and the output, at speeds 1, 2 and 4. In a thread too short to scroll it stays at one position throughout. In a following thread at the end of 120 lines, output landing in a later batch grows the row from 52 to 89 px and glides the bubble up those 37 px over about 500 ms. Giving way to a row with no Sent line drops a bubble in one frame in a following thread, since the row truly gets shorter: 20 px on a command at the end of 120 lines, 20 of 20 runs in the log and in pictures, and it stays there; with its output in the same batch a command moves 0 to 5 px. A real command and its output arrived in the same write, 5 of 5 pairs the probes logged, so that batch is the usual one.
:::

:::tip
Bun's `fs.watch` drops a change event that lands about 1 ms after the one it just delivered for that name, and nothing tells the reader (measured on Bun 1.4.4). Whoever reads only on an event then stays short until the file's next write. Three appends to one file in one process, reading the size on each event, then 120 to 150 ms of quiet: `fs.promises.appendFile` back to back left the last read short in 144 of 200 rounds and in 415 of 450 beside 12 busy loops, at about 1 event per round; `appendFileSync` with a spin gap of 0 ms in 4 of 40, 0.5 ms in 15 of 40, 3 ms in 2 of 40, and at gaps of 1, 2, 5, 8, 12, 20, 50 and 200 ms in 0 of 40 each. With the writer in a process of its own, 100 rounds each, the same appends left it short in 60 rounds and 0.5 ms gaps in 96; watching the folder instead read the same, 61 and 93; 12 busy loops beside them made it 84 and 91 on the file and 81 and 90 on the folder. A watch's lost write never came long after its last event: at most 0.99 ms idle and 1.26 ms loaded on the file, and 1.62 ms idle and 1.52 ms loaded across two names in a folder. Another name in the same folder lost nothing: 0 of 400 rounds, 200 of them loaded, its event arriving while the first name's were dropped. That it is a debounce per path inside Bun is what this looks like and is not read in its source.

Real Claude writes that close together. Over four windows of 270 to 285 s, busy-polling the size of the running transcripts of one project with a loop whose 99.9th percentile was 20 us and whose slowest pass was 7 ms, 73 of 143 consecutive size changes on a file sat under 1.5 ms apart. 71 of those were under 0.25 ms and were one append split in two: its first write ended on a 4096-byte offset every time, 71 of 71, so a file can hold a cut line for that long even though a 10 ms poll never saw one. None of those left a read short, since an event takes longer than that to reach a read (reasoned, not measured). The other 2 were separate appends, 1.03 and 1.28 ms apart. Of 79 bursts on those files a raw watch left one short, the 1.03 ms pair: the last 1177 bytes stayed unread for 981 ms, until the next write happened to come.

So a watch hands every event on at once and, once 20 ms have passed with no event, hands on each name heard since the last look once more, and a new event restarts that wait. Twenty is a guard, twelve times the slowest lost write above, and it sits inside the gap real bursts leave: none of the 143 changes came between 1.5 ms and 100 ms after the one before, so a burst gets one second look, and a lost line arrives about 20 ms late rather than at the next write. Only names heard are repeated, and only until the look, so a filter by name spares everything it spared before and a folder repeats nothing it was not told about. It runs only behind an event, and an idle file costs nothing. A second look that finds a file as it was reads and publishes nothing: 1.07 ms of CPU per look more than the same loop with no looks for a tail, and 7.0 ms more for a screen's subagent activity, which reads a 64 KiB tail again (a median over five runs of 1000 looks in Bun on the laptop). Waiting for a session's file rebuilds its project folders' watches on every event from the folder that holds them, so a new project folder rebuilds them once more on its look: left alone, since that folder only moves when a new project appears and one wasted rebuild costs less than a second way of watching (reasoned, not measured). The burst test that started this, its whole file on Bun beside 12 busy loops, failed 5 of 78 runs without the look and 0 of 106 with it.

Deleting a folder under a Bun `fs.watch` reports the folder's own name, and after that the watch hears nothing, though it neither closes nor fails: a folder made again under the same path stayed silent (measured on Bun 1.4.4). Renaming it away reported nothing at all. A watch that must outlive its folder opens again when it hears its own name. Claude touches its pid folder as it starts, which reports that same name, so each new Claude costs one reopen and one read of the folder.

The effect file system stats each rename event in a fiber of its own before it hands the event on, so two events that arrive together reach the stream in the order their stats finish. The folder's own name overtook the deleted file's in 11 of 60 deletes, even though the raw watch reported the file first in 40 of 40 (measured). A stream that stops at the folder's name therefore never hears the file, so that name means reading the whole folder again and forgetting what it no longer holds. Before this, a session file deleted that way stayed known and the deletion woke nothing, in 8 of 60 deletes, and in none of 60 after (measured).

`fs.watch` throws on a folder it may not read, and the effect file system opens its watcher inside a synchronous effect, so `EACCES` arrives as a defect rather than a `PlatformError`, and a retry alone would let it through (measured). A watch that must keep trying turns the defect into its own failure first. The retry starts from the same 100 ms as the reconnect to herdr, a guard and not a measurement: nothing measured says how soon a failed watch is worth trying again.
:::

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

:::warning
Never run `install-service`, `uninstall-service`, `systemctl --user` start/enable/stop or `launchctl` against the real user's session, not even with a temporary `HOME`: `systemctl --user` talks to the running user manager whatever `HOME` says. The installer reaches them only through a service whose test layer records the calls. Check a generated unit offline with `systemd-analyze verify` on a file under `tmp/`, which reports a missing binary or a bad directive and starts nothing (measured), and a plist with Python's `plistlib`.
:::

:::tip
A `bun build --compile` binary reports its own path as `process.execPath`, and `Bun.main` sits under `/$bunfs/`; from a checkout `process.execPath` is bun and `Bun.main` is the script (measured). That is how the agent tells which command runs it.
:::

## Stories

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
- The smoke test runs every story under happy-dom, in about 15 s for 350 of them, and it is
  not enough on its own. 17 stories passed there and failed in Chromium (measured): user-event's
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

## Skeletons

Every skeleton is skullet's engine measuring a sample rendered by the real components, hidden and inert, in the slot the real screen will fill. The sample is built when it shows, with nothing remembered, so a first visit and a return visit look alike and logging out has nothing to forget. A return visit shows a skeleton only when nothing is cached, since cached data is what a return visit normally shows. The sweep holds each skeleton's boxes to the screen it stands for: the first herd card and machine card edge for edge, and the last row of the thread on its bottom and sides, at 390 and at 430 wide, where all of them landed within a pixel, except the machine card, whose sample had no versions until the check said so (measured).

:::warning
skullet is pinned exactly and its engine is reached through its internal entry: a release is young, and that entry carries no compatibility promise. A bump needs, on a real build under `vite preview`, which sends the real policy: no `securitypolicyviolation` event and no log entry over a herd, machines and chat skeleton; no `style` element added; `--skullet-animation` still honoured; no running animation under emulated reduced motion; and the fit check in the sweep. Emulated reduced motion is safe on a preview, since only the dev server's reload loops on it.
:::

- The policy stays `style-src 'self'`. skullet's React wrapper hoists an inline `style`, which the policy refuses on every load, and its remembered shapes restore through markup carrying `style` attributes, 3 refusals per shape. The engine draws its bones through CSSOM, which the policy allows, and skips its own stylesheet once it reads `--skullet` from the root, which the stylesheet served from this origin sets. Exact mode turns memory off, so nothing is written to local storage. That gave 0 violations on a production build under the real header, on the real app's herd skeleton and the catalog's chat and machines (measured).
- A painted element holding at most one label is drawn as a solid block. An empty `span` counts as text with a rect, so a press highlight covering a card turned the whole card into one grey block, and it merged every label inside it. Text truncated in a narrow row reports rects past its clip, which merge with their neighbours the same way, so sample paths stay short (both measured). The sample hides highlights and swipe actions with `display: none` in an unlayered rule, since a layered one loses to a utility class.
- `pulse` animates opacity on the compositor; the default `shimmer` animates a background position on the main thread (read in its source). On screen the bones cost 16 ms (13 to 22) of main-thread work per 2 s on the herd against 12 (9 to 19) for the skeleton before them, and 31 (26 to 171) against 22 (12 to 70) on a thread. The first skeleton cost more: load to skeleton 324 ms (291 to 378) against 213 (189 to 226) on the herd, 366 (331 to 398) against 289 (280 to 357) on a thread, and a tap to a thread's skeleton 137 (131 to 153) against 80 (75 to 93) (production catalog, 390x844, 4x CPU throttling, five runs, medians).
- A `requestAnimationFrame` loop in the page being measured is most of what it measures. The same production build read 618 ms and 650 ms of main-thread work per 2 s with a probe polling for the skeleton every frame, and 16 ms and 31 ms without it (measured), since the loop forces a frame the idle page would not draw.
- The engine sits in a route chunk of 8881 bytes gzipped, outside the initial load, and the sample adds 4824. The initial load grew by 1642 bytes and all JavaScript by 11781 (measured on a production build). The service worker's precache went from 40 entries and 2710.81 KiB to 41 and 2741.39 KiB. Loading it lazily would add a state between the screen and its skeleton, for bytes the service worker precaches either way.
- A skeleton's hold spends at least 400 ms of a DOM test's wait for the rows, out of testing-library's default of 1000 ms, so a chat's first test in its file failed its find in 1 of 8 runs beside sixteen busy loops, and in a loaded gate. The DOM setup raises the limit to 3000 ms, a guard and not a measurement: 0 of 16 runs under the same load (measured).
- A cold thread's skeleton sits at the bottom of the thread, because the phone does not yet know how long the chat is and a long chat rests at its end. A short chat's rows therefore jump to the top when they land. The user chose that over matching short chats, which would make every long chat jump instead.
- A test that really waits out two notice delays spends 2.4 s of Vitest's 5 s limit on sleeping alone. Alone it took about 2.8 s, and 3.9 s beside sixteen busy loops, but it hit the limit once in a whole gate, so it carries a longer limit of its own, 15 s, a guard and not a measurement.
- A notice floats in a card above the dock or sheet it belongs to, over what is behind it, rather than growing it: a failure line took a dock from 127 to 195 px, 187 to 303 px and back on a launch that gives up, and a sheet from 265 to 313 px (measured), which is the layout moving twice for one sentence. One stack per surface, since two beside each other overlap. A failure that belongs to a card in a list goes to a toast, since a card has nowhere to float and a list moving under the finger is the bug. A failure at the very end of a page moves nothing and stays where it is. A toast comes only from a failure that lands while its screen is mounted: an action's result outlives the screen, so reading one on a remount would toast an old failure for nothing the user just did (reasoned, not measured).
- The connection banner lies over the content under the header instead of pushing it. Tab screens and a machine's page slide their content down by its height with a transform, which reads the same and is no layout shift, and a chat leaves its thread alone, since a thread sits at its end: at the top of a short chat the banner lies over the first row's top edge while it shows (seen in a shot). Stories with a banner measured 0.037 to 0.056 before and all pass the still budget now, so the banner's own budget went.

## Frames

`bun run frames <story...>` plays timeline stories at real speed, 390x844 at 4x CPU throttling, reads
the screen once per animation frame and fails on what a settled screenshot cannot show. The
`qa-frames` skill says how to use it beside the other browser tools.

- The recorder is an init script handed to the browser, not code in the catalog, so it is there
  before any page module and the catalog carries nothing of the tool's. The table of which selector
  means which state lives in one place, so a state attribute can replace its selectors later.
- A state has to hold 24 frames or 400 ms. Over the sweeps "Catching up" held 15 to 22
  frames on a reconnect and 11 to 15 on a foreground return, and the paused composer 22 to 23, while
  states a story holds on purpose start at about 29: 30 to 31 for a card, 36 to 37 for the
  composer, 44 to 50 for a cold chat's skeleton (all measured). A threshold of 20 caught the
  reconnect pill in 2 of 3 sweeps and 24 in 3 of 3. The banner on a first load straddles 24 (6 to 37
  frames), so those stories list it as a finding only some runs show.
- 24 frames is 400 ms only at 60 Hz, and a long frame costs frames without costing time, so a state passes on either. Its time runs from its first read to its last plus one frame for that last read, so a steady 24 frames reads exactly 400 ms and a state under 24 at a steady 60 Hz is still a flash. Frames alone failed the reconnect's pill, which the app holds in time: beside the laptop's other work, at a load average of 2 to 6, 3 of 11 runs held 19 to 23 frames over 399 to 424 ms, none starved, and the pictures of a run that failed and one that passed read alike. The first read comes up to 92 ms after the hold starts, since the pill commits inside a long frame, which is why that last frame counts: without it the 399 ms run still fails. More load lengthened the hold, since the read lands later: 24 to 30 frames beside 2 busy loops, 24 to 33 beside 4, 29 to 43 beside 8, over 12, 12 and 9 runs, none under 423 ms (all measured).
- Time stops at the last read rather than at the next frame, which can come much later. A spinner closed with its chat read 6 frames, 84 ms to its last read and 452 ms to the next frame; a paused composer read 23 frames, 346 ms and 439 ms. Both stay flashes. Over three recorded sweeps, two at that load and one beside 8 busy loops, the rule flips the reconnect's pill and the first-load banner with its spinner, which held 4 to 23 frames over 475 to 730 ms, and nothing else (measured).
- A hold of 24 frames in the app, as the thread skeleton has, was the other way out, and it stays out. A chat's landing waits on the pill's hold, so slow frames would make the rows themselves later, each hold would need a frame loop, and it does nothing for a state no hold keeps, such as that banner (reasoned from the same logs).
- A starved run's clock does not count, so it passes on frames alone. A state that work holds rather than a timer stretches with the load: the reconnect's pill with its delay and hold taken out read 446 and 448 ms with no busy loops, and 463 to 869 ms beside 8, with a p90 of 22 to 26 ms, not starved (measured). So a real flash near the limit can pass on a loaded run that is not starved, and only a quiet run is a clean reading of one. Frames alone had the opposite error at the same load, and a sweep run beside other work is the case this had to fix.
- A story's layout shift budget is 0.01 in total. A story that types a bare slash command opens and closes
  the suggestion strip, and that alone measured 0.0535, so a story about something else types the
  command with an argument, which opens no strip. Per-story totals fell at 0.0006 or under, or at 0.0125 or
  over per event, so 0.01 sits in that gap. Synthetic
  events never set `hadRecentInput`, so a story's scripted press counts against it; a transform
  does not count at all.
- A sweep of the 55 timeline stories, skeleton fit included, took 356 and 372 s, contact sheets
  included, on a shared 15 GB laptop. It stays out of the gate: it needs a browser and a dev server,
  it costs six minutes per push, and its counts move with what else the machine runs. The detection runs in the
  gate, over recorded logs, with no browser.
- A loaded machine can make a false finding, by slowing every frame without any one of them looking
  long. One story's frames dropped to 19 per second with another agent working: a pill that held 51
  to 52 frames in three other sweeps held 6 and read as a flash. Counting frames over 50 ms missed
  the next case: at a load average near 9, a pill that held 54 to 55 frames in three quiet runs held
  23 for 659 ms and failed as a flash, with only 8.1% of its frames over 50 ms. The 90th percentile
  frame time told them apart: 17 ms on the six quiet runs and 42 to 44 on the two loaded ones (all
  measured). So a p90 past 30 ms means the run is starved: the tool runs it again, twice at most,
  and says so if it stays starved. With sixteen busy loops beside it, a run retried twice and printed
  that it stayed starved, at a p90 of 71 ms (measured).
- The rAF log and the screencast were checked against each other over one sweep's 3725 frames and
  2829 pictures: 75 of 84 mark changes showed a pixel change in that element's box, 48 of those
  within 33 ms of the log either way, 2 earlier, 24 up to 300 ms later and 1 over that. Blank frames
  had a content region with a standard deviation of 0.00. Screencast and trace screenshots agree
  with each other (307 against 307 and 281 against 278 pictures in joint runs), holes included, so
  the holes are not the screencast's.
- The log overstates time on screen on this setup. A pill the log held from 4590 to 4924 ms was in
  pictures from about 4818 to about 4935. Chromium's frame reporter kept saying frames were
  presented every 16 ms through that hole, with no damage, on the software renderer (trace). That
  raster lag causes it is inferred, and a phone with a GPU is not measured. So the log says what the
  DOM asked to show, and a frame image can honestly lack a state that the log found; the tool
  prints how far each image sits from its frame for that reason. On a foreground return the pill
  got at most one picture in 5 of 5 runs, and a reconnect's got 7 to 13.
- Pixels change without an animation frame: 47 of 61 main-thread gaps over 50 ms had compositor
  pictures inside. No DOM state can change in one, so the marks miss no state there.
- Tracing moves what it measures: frame times at p90 went from 18 to as high as 58 ms, and the
  pill's count ranged from 10 to 20. The recorder alone costs little: a p50 read of 0.5 to 2.5 ms
  and at most 18.5 ms at 4x, and frame p90 stayed 17.5 to 18.5 ms; adding the screencast made it
  18 to 20. Screencast yes, trace never, under a frame count.
- `agent-browser react renders` overcounts. Over one idle herd window it reported 1030 renders where a
  hook using DevTools' own did-render test counted 175 (7 per card per second, matching the 105 per
  second at fifteen cards above), and it listed components already mounted as mounts. Its
  component names and change reasons are usable; its counts are not.
- `agent-browser record` works alone at 30 and 60 fps. With `--contact-sheet` it failed on this laptop
  at both ("analyzer fell behind by more than 16 buffered frames") and left a 0-byte video
  (measured, version 0.41.1). `agent-browser skills get core --full`, which its help recommends,
  answers "Skill not found" here.
- A sweep on a server that had not met the code yet died once on its first story, reading the log
  from a page whose recorder was gone, and passed when run again (1 run; that Vite's reload caused
  it is a guess). A failed browser step now runs its story again like a starved one, so one bad
  page does not cost the sweep, and it prints that it did.
- The Working row's ghost takes no mark. It lives for a fade, under the 24 frames a state has to hold, so a mark on it read as a flash on every turn (measured).
- A story opening on a quiet state waits past a flash's limit before its first step. A 400 ms wait straddled it, the state holding 22 frames in 510 ms on one sweep and 24 to 25 on others (measured), so the same story passed and failed with nothing changed.
- A contact sheet that added a tile only when the marks changed never showed a `/clear`, since that
  swaps rows for rows with the same marks around them (read in how it picks tiles). It also takes a tile
  when the row count changes and always shows the last frame.
- `Arr.groupWith` compares each element with its group's head, not its neighbour (measured), so it
  does not find runs of consecutive frames: a frame's index minus its position within a filter is
  the key that stays the same along a run.
- No timeline story reached the herd's blank before the link's first value, since the fake browser
  hands the real link its first value before first render: 12 of 12 loads at 4x had the skeleton
  in their first DOM read (measured). A story with the link held before that value shows it, 2
  frames lasting 58 to 87 ms. That production's IndexedDB read makes this gap longer is reasoned,
  not measured.
- A settle that clicks Back has the story report ready during the slide-out, so a chat's marks
  from before the first step read as flashes. A story that reopens a screen is judged from its
  first step instead.
- A flash's image is the last frame at its highest opacity, because the first frame of a state
  often predates any picture of it.
- A mark says a state is mounted, not that it fills anything, so a catch-up with the top of the
  screen empty passed every check with rows on screen in every frame. Each frame also reads the
  row boxes against the thread's viewport, and the widest stretch with no row at the top, in the
  middle and at the bottom of it fails a story past 20 px, from a single frame. Over every frame of
  the 36 timeline stories before the fix, top and bottom never passed 16 px, the edge's padding, and
  the middle 12 px, a row's gap, outside single frames of 36 and 60 px and the catch-up stories,
  where the smallest value past those in a band's own tail was 25.5 px (all measured). The read
  took a p50 of 1.3 ms, a p90 of 2.6 and at most 21.5 over 6300 frames at 4x (measured).
- A thread's row moving up and straight back down fails a story as `backtrack`. Each frame logs the
  move of the last row it and the previous frame both hold, and the story fails on a move up followed
  in the next frame by a move down, each at least 2 px, a guard below the smallest one found. Over
  the 57 timeline stories, one run each, a move up was followed by a move down of any size twice
  before the fix (37 and 5 px, 10785 frames) and never after it (10777 frames), so neither the lift
  nor the glide nor a landing does it (measured). A finger does it where it turns around: 11 up then
  9 down, 5 then 6, and 35 then 50 between two strokes, over three gestures driven through CDP at 4x
  (measured). So the recorder marks a frame with a finger down, and the check skips it. A wheel or a
  scrollbar turning around is not marked, since the phone has neither and no story drives one.
- The log's read is the frame's first animation callback, ahead of Motion's in all 40 runs that
  tell, so it holds what the last frame painted plus any commit since, and a Motion value reads a
  frame behind what that frame paints. A `ResizeObserver` on an element whose size that first
  callback flips runs after the frame's callbacks, and it saw Motion's write of that frame in all of
  them (measured). That is the place to read when a finding might exist only in the log, and the
  pictures are the check on it.
- A story that writes `scrollTop` itself can be read before the virtualizer has heard the scroll:
  twice over 229 story runs the whole viewport held no row for one frame with the lift at 0, once
  before a story's first step, where nothing judges it, and once failing a story that scrolls up at
  its start with a flash and a blank (measured; that the read comes before the scroll event is
  reasoned). Run such a failure again before reading it as a bug.
- A lift that takes more than what landed fails a story as `overshoot`: every row on screen moves
  down at least 2 px in a frame where the lift rises at least 2 px. Over the 57 timeline stories, one
  run each, it found 5 such frames in 4 stories before the fix (2, 12, 12, 32 and 98 px) and none
  after it, the 2 px being the smallest there is to find (measured). The read takes every row on
  screen, since a row pushed down by one landing above it moves with the lift rising and the rows
  above stay (reasoned, no story reaches it). A finger does the same as a batch lands: 16.4 px down
  in a frame the lift rose 82.4 px, driven through CDP at 4x (measured), so a frame with a finger down
  is skipped. A flick's momentum is not marked, but a thread scrolling up stops following and
  raises no lift (read in the code).
- A baseline entry lists what a story always shows and what it only sometimes shows. A new key
  fails the story, an always key that did not happen fails it too and says to remove it, and a
  sometimes key does neither.
- A failure line that grows the dock or sheet holding it is a bug, with no budget or baseline entry to hide in. Every timeline story is in a sweep, and the sweep ends by holding each skeleton's boxes to the real screen, at both phone widths.

## Release

:::warning
The release workflow runs on a pushed `vX.Y.Z` tag and nothing else. A trigger that also fires on
a branch push would publish from main.

Every action is pinned by its full commit SHA, looked up with `gh api` (`git/ref/tags/<tag>`, and
the tag object's commit when the tag is annotated), never guessed, with the version in a trailing
YAML comment. A bump is a new lookup.

The gate refuses a tag whose commit is not on main, and `publish` verifies its own signature with
the identity and issuer the installer demands before it creates the release. A release its own
installer refuses can only be replaced by cutting another tag, so the mismatch has to fail the job.
For the same reason `publish` runs the compiled linux-x64 pair before it signs anything: the gate
never compiles, so a Bun or Vite change that moves the embedded web build would otherwise ship a
hub that refuses to start.
:::

:::tip
The web build's directory names live in one `@crook/web` leaf that Vite, the hub and the release
build all read. Bun embeds an `--asset` directory under its own name, so the directory Vite writes
and the one the hub serves from the embedded files must be the same name.
:::

:::tip
Bun, measured on 1.4.3:

- `bun build --compile --asset=<dir>` embeds the directory under its own name at
  `/$bunfs/root/<name>`, and every bundled module's `import.meta.dirname` is `/$bunfs/root`. The
  embedded files stat, read and list like real ones.
- `Bun.embeddedFiles` holds plain `Blob`s, not `File`s, so it gives no names without a cast.
- An embedded file's modification time is the epoch, so any validator built from size and mtime
  calls two builds' same-sized files equal. Serve embedded files without one.
- A compiled binary autoloads `.env` and `bunfig.toml` from its working directory unless built
  with `--no-compile-autoload-dotenv` and `--no-compile-autoload-bunfig`.
- A cross-target compile downloads that target's runtime once and caches it at
  `~/.bun/install/cache/bun-<os>-<arch>-v<version>`.
:::

:::warning
Bun's `fetch` verifies TLS against the root store bundled into Bun, not the system's, so a
compiled binary trusts what the Bun that built it trusted. In the eMudhra intermediate compromise
Bun 1.4.3 accepted the compromised chains and 1.4.4 rejected them as `CERT_REVOKED`, on a machine
whose system store still trusted them (measured). A CA distrust reaches the shipped hub and agent
only through a Bun bump in the release workflow and a new release.
:::

:::tip
`effect/cli`'s `Flag.Boolean` is a required flag until it gets `Flag.withDefault(false)` (measured:
"Missing required flag").

`oxlint-disable-next-line` excuses the next line only, and `oxfmt` can move the reported call to a
line of its own, as it did with an `Effect.provide` at an entry point (measured). Bind the program
to a constant first, so the directive sits right above the call it excuses.
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
3. Record it here — never as a comment; `no-comments` rejects one anyway.
:::

:::warning
`src/` also carries `@internal` exports that the shipped declarations strip, so a name found by
grepping it can still fail to typecheck. `Schema.UnknownFromJsonString` is one, and
`effecttsgo/prefer-schema-over-json` suggests it in its message anyway; the public spelling is
`Schema.fromJsonString(Schema.Json)` (both measured on `effect@4.0.5`). Check a name found in `src`
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
2. A line here — every agent reads it, but prose can be misread. A one-off measured fact goes here
   too, stated as a fact rather than a rule. Never a comment; `no-comments` rejects one.

Codify in the same change as the fix, never "later"; a pattern living only in a conversation dies
with the session.

:::warning
Rules are not immutable. When the user contradicts one, fix the rule — do not special-case the call
site. `expect-padding` was built from a misread brief and had to be inverted; that was a bug in the
rule, not licence for an exception.
:::

Do not over-codify. A preference about one file, or a judgement needing taste, is not a pattern.
