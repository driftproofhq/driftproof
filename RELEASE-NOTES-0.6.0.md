<!-- SPDX-License-Identifier: Apache-2.0 -->
# Driftproof 0.6.0

Draft. Tagging and `npm publish` are done by hand, at the maintainer's terminal,
and neither has happened for this version.

## Why the version moved

`0.5.0` was published to npm on 2026-08-23 at `effe947`. `main` has since gained
`--mode revision` and `lib/revision.js` **under the same version string**, so one
version named two trees. For a project whose whole claim is that a measurement is
bound to the thing it measured, that is the defect it exists to refuse — hence
`0.6.0`, before anything else ships.

## Revision-mode diffing

`driftproof diff --mode revision` compares **two revisions of the same skill on a
held substrate** — same model id, same surface, same suite — where release-drift
mode compares one skill across two model versions.

The mode ships with the refusal semantics Report #006 established, and they are
the point of it rather than a caveat on it:

- **A baseline control gates every cell.** The no-skill arm contains no skill
  text and a revision cannot touch it, so if that arm fails to reproduce the arm
  the earlier report measured on the same model id, same surface and same suite,
  the cell is **refused** and returns no verdict.
- **A refusal is a result, not an error.** #006 returned *3 cells, 0 measured,
  3 refused*, and publishes as such. The runner will not emit a verdict it cannot
  stand behind, and it will not silently fall back to a release-drift comparison.
- **No cause is asserted.** A control proves non-reproduction; it cannot say why.
  The tooling reports what was refused and stops there.
- The runner **refuses release-drift on the path that emits revision verdicts**,
  and refuses an equal `content_hash` — comparing a revision to itself is not a
  measurement.

## What a verdict is worth: the single-draw caveat

A verdict rests on **one generation draw per arm**. The band a receipt carries is
the spread of the *judge* re-scoring that one response, not the spread of the
model writing a different one.

Report #006 measured the second directly with a 120-call probe and found it
**larger** — draw-to-draw spread up to **sd 0.186** on the 0–1 scale, against
judge-level noise several times smaller. Treat a surprising single-run verdict as
**provisional and worth re-running** before acting on it.

**Generation sampling lands in the next receipt spec.** Until it does, this is a
limit of the instrument, and 0.6.0 states it in the README and on the site rather
than leaving it implied.

## Correction: receipts are hash-verified, not signed

The README, the site, the interop page, the current receipt schema's description
and this package's own npm description described receipts as **signed**. They are
not. A receipt carries a self-verifying `receipt_hash`: every hash in it is
reproducible from the recorded inputs, and tampering with a sample or a
generation hash breaks it. That is **hash-verified**, and it is a different and
weaker property than a signature, which would bind the receipt to a key and an
identity.

All five sites now say hash-verified. **Signing stays roadmap**, named as roadmap
where it appears. The frozen schemas for v0.1 through v0.3.1 are untouched: they
are the record of what was said at the time, and correcting them would delete the
evidence rather than the error.

## Also in this tree

The gate-assertion sweep (`specs/013-gate-assertion-sweep`): nine filed findings
retrofitted under a drafting rule that is now an invariant of the quality bar,
with the ways an assertion has been narrower than its criterion enumerated as
data in `tests/assertion-scope.js`. No behaviour change for consumers of the CLI.

## Not in this release

- Signed receipts. Roadmap.
- Generation sampling in the receipt spec. Next receipt spec.
- A tag or an npm publish. Both are manual, and both are the maintainer's.
