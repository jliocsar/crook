---
paths:
  - "packages/state-machine/**"
  - "apps/web/src/**/*Machine*.ts"
  - "apps/hub/src/*Machine*.ts"
  - "apps/web/charts/**"
  - "apps/hub/charts/**"
---

# State machines

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
guard and not a measurement: the machines here have 10, 11, 8, 117, 6, 6, 5, 3 and 3 (measured), so reaching it means a
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
