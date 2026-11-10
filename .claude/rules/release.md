---
paths:
  - "packages/release/**"
  - ".github/**"
  - "apps/agent/plugin/**"
---

# Release

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

A new Effect doesn't have to reach both ends at once. The compiled binaries of an agent on
`effect@4.0.5` and a hub on `effect@4.1.2` attached, published and served `WatchHerd` in both pairings
over NDJSON, and a hub on either version opened a database the other had written (measured, with no
panes, so no command or transcript crossed). Effect's `Persistence` key layout changed in 4.1, and
nothing here reaches it: a store is SQLite on the hub, JSON files on the agent and `idb-keyval` on the
phone.
:::

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
