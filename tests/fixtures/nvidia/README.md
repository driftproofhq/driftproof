<!-- SPDX-License-Identifier: Apache-2.0 -->
# NVIDIA skill benchmark cards (fixture subset)

These files are copied byte for byte from
[NVIDIA/skills](https://github.com/NVIDIA/skills) at commit
`14a98ae278cec7e867695189d0f4003c08e4f765`. They are NVIDIA's work. That repository licenses
its skills and documentation under CC BY 4.0 and its source code under Apache 2.0. Both
licence texts are beside this file, as `LICENSE-CC-BY-4.0` and `LICENSE-APACHE`. Nothing in
the copies is changed.

What is here:

- `skills-source/benchmarks.json`: the source's index of every card's results, whole.
- `skills-source/skills/<skill>/BENCHMARK.md`: eleven of the 405 cards, in the source's own
  layout, so `driftproof import tests/fixtures/nvidia/skills-source --from nvidia-cards
  --only <skill>` reads them as it reads a checkout.
- `SOURCES.json`: each file's path in the source and its git blob sha1 at that commit, as the
  GitHub tree API reported it. The tests recompute each sha1 from the bytes here.

The cards were picked by card format, by the agents and models they name and by whether they
carry a token table, never by result. Between them they hold both card formats, a model on
the `Agents:` line and on the `Agents Used` list, no model at all, Opus 5, one agent only, an
agent marked not available, uplift printed in points and with no unit, uplift unavailable,
one, two and three attempts per task, a token table and none, a table of N/A cells and a card
with no results.

Driftproof spec: `specs/265-nvidia-cards-import/spec.md`.
