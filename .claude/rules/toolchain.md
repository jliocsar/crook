---
paths:
  - "package.json"
  - "**/package.json"
  - "bun.lock"
  - "bunfig.toml"
  - ".oxlintrc.json"
  - ".oxfmtrc.json"
  - ".githooks/**"
  - ".claude/hooks/**"
  - ".claude/settings.json"
  - "packages/tsconfig/**"
  - "**/tsconfig*.json"
  - "**/vitest.config.ts"
---

# Toolchain

Lint presets, compiler settings, pins and installs: what to know before touching a manifest, a config or a hook.

The `effecttsgo/*` Effect rules come from four `@effect/tsgo` presets that `.oxlintrc.json` extends:
`recommended`, `correctness` and `antipattern`, which add four rules `recommended` leaves off, and
`effect-native`, which bans the globals Effect replaces — `process.env`, the global `console`,
`Date`, `fetch`, timers, `new Promise`. `recommended` carried those itself until tsgo moved them
out, so a bump that only follows `recommended` silently drops them (measured going from 0.36.1 to
0.64.1). They are type-aware, and the presets turn type-aware mode on — which is why no
`--type-aware` flag appears in the scripts. Since tsgo 0.67.3 they also read inside a class's
`extends` expression, so a service's inline `make` is checked like any other code (measured).

The tsgo rules that are off say why beside themselves in `.oxlintrc.json`. Two are off because
their quickfixes write what begone-slop rejects: a map to `undefined` becomes `Effect.asVoid`, and a
catch returning `Effect.void` becomes a log-less `Effect.ignore`. `unnecessary-effect-gen` stays on,
but don't take its fix for a body with no return and a non-void success: it writes `Effect.asVoid`
too (read in tsgo 0.67.4's source). `oxlint --fix` left a probe of that shape unchanged, so it's the
editor's quickfix to watch. `unstable-api-usage` stays on, and the language-service plugin block
allow-lists the `@stability unstable` families crook is built on: the platform services, SQL, RPC,
sockets, atoms and `@effect/vitest`. Without the list it reports every use (2,318 on 4.1.2), and with
it an unstable family from anywhere else still fails the gate (measured). A new one goes on the list
deliberately, or not at all.
Schema classes carry no brand: the language-service plugin limits `brandedSchemaClasses` to
`Error` and `Opaque`, since a tagged class's literal `_tag` already keeps two classes apart and a
plain `Schema.Class` here is a wire shape decoded at a boundary.

`.oxlintrc.json` also enables oxlint's own `correctness`, `suspicious` and `pedantic` categories.
Pedantic is the one that bites, because its size and shape caps were written for ordinary
TypeScript rather than for this style. `max-classes-per-file` is off for exactly that reason: one
tagged error class per failure reason is the error doctrine here, so a module that can fail two
ways already declares two classes, and a service tag makes a third. A cap of one never shrinks a
module — it scatters one concern across several files and leaves the import graph with nodes that
exist only to satisfy a linter. Its sibling `max-lines` is raised from a default of 300 (measured) to 1000, for the same
reason: a line cap relocates code rather than shrinking it, and a module split to sit under
one is a module the graph did not ask for.

`core.hooksPath` is one setting shared by every worktree of a repo, relative to each worktree's root.
Running `prepare` in a worktree whose branch has `.githooks` takes the hooks away from every worktree
on a branch that doesn't, so while such a branch is out, install there with `--ignore-scripts` and
run `bunx effect-tsgo patch --oxlint` by hand.

Installs wait three days for a new release, set in `bunfig.toml`. A version an exact pin asks for
fails too, and a young optional package is skipped with no error, which is how tsgo's platform
binary goes missing. A lockfile's entries aren't re-checked: a frozen install from a clean copy found
every one (measured). So a bump you mean to make runs `bun install --minimum-release-age 0` once, and
every later install reads the lockfile.

Effect's packages take their version from the `catalog` under the root's `workspaces`, and every
manifest says `catalog:`, so one line moves them together. A frozen install resolves it to one copy of
`effect`, and the release build bundles what the install resolved: the host build's binaries report
their version, and the release smoke script passes on them (all measured).

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

:::tip
A member that runs on Bun and touches Bun-only APIs in tests (`BunHttpServer` reads the global
`Bun`) sets its `test` script to `bun --bun vitest run`. Plain `vitest run` runs on Node, where that
global does not exist (measured).
:::

:::warning
That preset sets `"plugins": []`. Without it, extending the preset re-enables oxlint's own default
plugin set (`unicorn`, `oxc`) on top, which fails the gate on rules nobody chose (measured: 7
reports). If you want those plugins, name them in this repo's own `plugins` array — later config
wins.
:::

:::caution
oxlint's JS plugin support is **alpha and explicitly not semver-bound** (per its shipped config
schema). Every one of those rules rides on it, so an oxlint upgrade can change their behaviour
without a major bump. The plugin's own test suite is what catches that — after bumping oxlint here,
bump and test it there too rather than assuming the pair still agree.
:::
