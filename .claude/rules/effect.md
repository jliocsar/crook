---
paths:
  - "packages/**/*.ts"
  - "packages/**/*.tsx"
---

# Effect

How Effect, its platform modules and the type-aware lint rules behave, measured or read in their source.

oxlint's `promise` rules decide whether `x.catch(…)` is a Promise call by looking at the receiver,
and they treat a namespace import as one that might be a Promise. So `Effect.catch` and
`Stream.catch` count as Promise chains (measured on oxlint 1.90.0; `valid-params` still rejects it on 1.91.0). `prefer-await-to-then` reports
each one that isn't under a `yield` or an `await`, which is why it's off. `valid-params` is a
correctness rule and stays on, but it rejects the data-first `Effect.catch(self, handler)` as a
`Promise.catch()` with two arguments, so use the pipe form. Never rewrite a catch into something
else just to get past either rule.

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

`Effect.filter` with an effectful predicate and a `concurrency` option keeps input order (measured
on `effect@4.1.2`: predicates that finished in 10, 20 and 30 ms over `[30, 10, 20]` gave `[30, 10,
20]`). `effect@4.0.5` returned them in the order they finished, and code written then goes through
`Effect.forEach` into `Option`s and `Arr.getSomes`, which still holds.

A fiber forked into a scope that closes before the fiber first runs never runs any of its effect
(measured: a step forked from inside a `forkScoped` fiber never started when the session scope
closed right after the fork). Work that must happen once it is accepted is forked into the scope
that owns it directly, by the fiber that accepted it, and only the follow-up goes in a child.

An `Effect<A>` is assignable to `Effect<void>`: a service method typed `Effect<void>` accepts
`Queue.offer(…)` or `Effect.forkIn(scope)` as they are, and `begone-slop/no-effect-asvoid` rejects
the `Effect.asVoid` that would only satisfy the signature (measured: removed in three places, the
typecheck still passed).
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

A test that reads what an effect logged provides `Logger.CurrentLoggers` through `Effect.provideService`. `Effect.provide` of a logger layer is what `effecttsgo/strict-effect-provide` rejects there (measured).

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
A composed layer is memoized by identity. `Layer.provide`, `Layer.provideMerge` and `Layer.mergeAll`
check the memo map, so one composed value referenced from two parents builds once, a `Layer.fresh`
inside it included (measured: 2 builds on `effect@4.0.5`, 1 on `effect@4.1.2`). Two parents that need
their own instance need two layer values.
:::

:::warning
A defect beats a typed failure when the runtime combines the two. A typed failure whose finalizer
dies reaches `Effect.catch`, `Effect.ignore` and `Stream.catch` as a defect, and none of them recovers
it (measured: all three recovered on `effect@4.0.5`, none on `effect@4.1.2`). So a dying finalizer
cannot hide behind typed recovery, and what must survive one catches it with `Effect.catchDefect`. An
`Effect.all` whose first child fails before a dying sibling has run still recovers (measured on
both).
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
`effect@4.1.2`). Guard such a gap by making the consumer idempotent, and test that part on its own.
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
Effect's `Semaphore` stopped letting a later `take` overtake a queued waiter that fits (measured: a
fiber looping on one permit got in 341 times ahead of a waiter on `effect@4.0.5`, and once on
`effect@4.1.2`). A larger request can still be overtaken by a smaller one behind it (read in its
source). Before that, a loop of instantly answered long polls starved another caller for 300
test-clock seconds, which is why the one place that has a long poll hands the turn to the oldest
waiter itself. It also admits the poll on its own terms, so it stays.
:::

:::tip
A `Result` is not yieldable inside `Effect.gen` in `effect@4.1.2` (measured: a type error, and it dies
at runtime). Lift it with `Effect.fromResult`.

`Effect.andThen(effect, f)` runs what `f` returns as an effect: an `f` that only does a side
effect and returns nothing dies with `Not a valid effect: undefined` (measured on `effect@4.1.2`).
Write the step in an `Effect.gen` body, or map with `Effect.map`.

`Arr.filterMap` takes a function returning a `Result`, not an `Option`, in `effect@4.1.2` (measured: a
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

- A one-shot Bun script keeps `Effect.provide` at its entry and disables
  `effecttsgo/strict-effect-provide` there, as the rule's own message allows at an entry point.
  The long-running members' `Layer.launch` form does not carry over: it never returns, and the
  script hung until killed (measured).

- `Effect.catchTag` does not typecheck over a generic error union such as `Failure | RpcClientError`
  (measured: TS2345, the tag narrows to `{ readonly _tag: unknown }`). A `Schema.Error` there is
  caught with `Effect.catchIf(Schema.is(X), …)`; `instanceof` is the other spelling, and
  `effecttsgo/instance-of-schema` rejects it.

:::tip
`effect/cli`'s `Flag.Boolean` is a required flag until it gets `Flag.withDefault(false)` (measured:
"Missing required flag").

`oxlint-disable-next-line` excuses the next line only, and `oxfmt` can move the reported call to a
line of its own, as it did with an `Effect.provide` at an entry point (measured). Bind the program
to a constant first, so the directive sits right above the call it excuses.
:::
