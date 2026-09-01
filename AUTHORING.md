<!-- SPDX-License-Identifier: Apache-2.0 -->
# Writing a fair Driftproof suite

A Driftproof receipt is only as trustworthy as the eval suite behind it. This guide
is how to write a suite that measures whether a skill **actually helps** — and keeps
measuring honestly as the model underneath it changes. It uses the same rules and
phrasing as the [Report #001 methodology](reports/report-001.md#methodology), so the
guide and the reports speak identically.

Scaffold a starting point with `driftproof init <dir>`; it writes an
`evals/evals.json` whose three example cases already follow every rule below.

## The one rule everything else serves

**Every case must be grounded in a claim the `SKILL.md` actually makes.** A suite
measures a skill's marginal effect — the lift between running a prompt *with* the
skill and *without* it. If a case tests something the skill never says, the skill
can't be what moves the score, and the case measures noise (or the base model),
not the skill. Before writing a case, point at the sentence in `SKILL.md` it checks.

### Grounding policy (codified)

> **Every gradable rubric criterion must trace to text present in the skill's `SKILL.md` at
> the pinned SHA. Criteria that import domain knowledge the skill does not state are not
> gradable, regardless of how standard that knowledge is. Claims may summarize; rubrics may
> not extrapolate.**

This is not a matter of the audited party's tolerance — it is our grading standard, applied
unilaterally to every suite. A `claim` may paraphrase what the `SKILL.md` teaches; a `rubric`
may not require a fact, threshold, value, enumeration, or rule the `SKILL.md` omits, even when
that fact is "obviously" correct in the wider domain. The operational test for each criterion:
*could a model that faithfully applied everything the `SKILL.md` states still fail this
criterion?* If yes, it imports unstated knowledge — remove it or rewrite it to grade only the
in-text claim.

Two worked examples from our own suites (see [`reports/rubric-sweep.md`](reports/rubric-sweep.md)):
a SemVer case required "the highest-precedence bump governs when changes are combined / reset
PATCH to 0" — a rule the skill's SKILL.md never states (it defines only MAJOR/MINOR/PATCH), so
that criterion was removed. A commit case required a *specific* Conventional Commits type token
(`chore(deps)` vs `feat`) when the skill names Conventional Commits and shows the
`type(scope): summary` shape but does not enumerate the type vocabulary — so we now grade the
shape, not the token.

Each case therefore carries a **`grounding`** field: a short reference to the `SKILL.md`
section/text its claim traces to. The gate mechanically requires every case in every suite to
carry a non-empty `claim` and `grounding` (presence check); the human check that the reference
is *correct* is the sweep above.

## Baseline = the same prompt, no `SKILL.md`

Driftproof runs each case twice: **with_skill** (the `SKILL.md` is supplied as the
system prompt) and **baseline** (the identical prompt, no skill). The lift
(`with_skill − baseline`) is what a single-run verdict reports. So a good case is one
the base model gets **wrong or mediocre on its own** and **right with the skill** —
that gap is the skill's value. A case both modes ace, or both flunk, measures the
model, not the skill.

> Caveat: skills that assume tools or context a bare baseline never had can show
> inflated lift. Keep cases answerable from the prompt + skill text alone.

## Anchor every rubric at 0.80

Rubrics are graded by an LLM judge on a 0–1 scale. Anchor them so a **fully correct,
idiomatic answer scores 0.80**, and reserve **0.81–1.00 for exemplary work only**.
Subtract for concrete, named errors. Copy this shape:

```
SCORING ANCHOR (apply strictly): a fully correct, idiomatic response scores 0.80;
award 0.81-0.90 only if it is ALSO exemplary (name the extra quality); 0.91-1.00
only if flawless and exceptional (rare). Subtract ~0.2 for each <specific error>.
If <the skill's core requirement> is missing, cap at 0.3.
```

Anchoring at 0.80 (not 1.0) is deliberate: it leaves **headroom** so a competent
run is not pinned at the ceiling, and a later regression has room to show.

## Graded difficulty — avoid saturation

Target a **with_skill mean of roughly 0.7–0.9**, not 1.0. A suite where every case
scores 1.0 is **saturated**: it has no room to detect drift, because a model can get
meaningfully worse and the number won't move. Mix a few straightforward cases with
harder edge cases that have real headroom. If your whole suite scores ~0.95+,
it is too easy to be a drift detector — add harder cases.

## Why sampling and bands exist

An LLM judge is **noisy**: grade the same answer twice and the score can differ. If
a receipt carried one grade, run-to-run judge noise could swing it by more than the
drift you're trying to catch. So Driftproof **judges each (case, mode) generation N
times** (default 5) and records the distribution: the per-case **band** is
`mean ± stddev` over those samples. A verdict is claimed for a case **only** when two
`with_skill` bands are **fully separated** (`mean_new + sd_new < mean_old − sd_old`,
or symmetric) — never on overlapping bands. The honest answer is allowed to be
"nothing moved beyond the noise."

## The 0.05 effect floor

Band separation alone is necessary but **not sufficient**. The judge quantizes scores
to a coarse ~0.05–0.1 grid, so a confident grade often collapses to a zero-width
"point band," and two point bands one quantum apart (e.g. 0.60 vs 0.64) are
technically separated yet represent no real change. So a second condition applies: the
mean must **also** move by at least the **effect floor of 0.05** (one judge-
quantization step). Separated-but-trivial moves are reported as *within noise (below
effect floor)*. Band separation **plus** a floor-sized delta — never either alone —
is what triggers a verdict.

## What makes a case *unfair*

A case is unfair when it can fail for reasons the skill's author never signed up for:

- **Gotchas / trick questions** — the "right" answer depends on a twist nothing in the
  `SKILL.md` prepares for.
- **Undocumented expectations** — the rubric demands behaviour the skill never claims.
  If the rubric asks for it, the `SKILL.md` must say it. This is the [grounding policy](#grounding-policy-codified):
  every gradable criterion traces to `SKILL.md` text; rubrics may not extrapolate.
- **Provider- or model-specific trivia** — answers that hinge on one model's quirks,
  version-specific behaviour, or knowledge cutoffs rather than the skill's content.
- **Saturated or degenerate cases** — trivially passed by any model with or without the
  skill (measures nothing), or impossible for both (measures nothing).
- **Ambiguous rubrics** — if two careful graders would disagree on 0.80-vs-0.50, tighten
  the rubric with concrete, checkable criteria and explicit caps.

If you wouldn't defend a case to the skill's author with "your own docs promise this,"
cut it.

## How to read the receipt it produces

A [receipt](spec/RECEIPT.md) is one JSON document per run. When you read one:

- **`comparison.delta`** — the skill's measured lift (`with_skill − baseline`). Read it
  through the effect floor: `≥ 0.05` is a real lift, `|delta| < 0.05` is within noise.
- **`results.aggregates.with_skill` / `.baseline`** — `mean_score ± stddev` for each
  mode. If `with_skill.mean_score` is ~0.95+ across the suite, suspect saturation.
- **Per-case `outcome`** — `pass` / `fail`, or **`borderline`** when the threshold sits
  inside the case's band (the run can't confidently call it — usually a sign the case or
  rubric needs tightening).
- **`run.judge`** — how grading was done (samples, temperature, surface). On the `api`
  surface the judge is pinned to temperature 0; on `claude-cli` sampling is
  surface-controlled and the receipt says so.
- **`content_hash` / `suite_hash` / `receipt_hash`** — reproducible hashes. The same
  skill + suite hash identically on any machine, and the self-hash makes a hand-edit
  detectable. `driftproof validate <receipt>` checks the schema and the self-hash.

To compare two runs across a model release, `driftproof diff A.json B.json` — it applies
the band + floor rule per case and summarizes the per-case verdicts into a headline.

## Contributing a suite for a public skill

Suites for public skills are **welcome as PRs into [`suites/`](suites/)**. Driftproof does
**not** commit third-party `SKILL.md` content — each skill is fetched at run time from a
pinned commit and verified by sha256. So a suite contribution records its provenance in
[`suites/manifest.json`](suites/manifest.json):

- **`slug`**, **`name`**, **`description`**
- **`repo`** + **`repo_sha`** (40-hex commit) + **`skill_path`** + **`raw_url`** (pinned
  `raw.githubusercontent.com` URL)
- **`content_sha256`** (64-hex) of the exact `SKILL.md` fetched
- **`author`** and **`license`** — the license must be permissive (MIT / Apache-2.0 /
  BSD / ISC / CC-BY)
- **`claims[]`** — the documented claims your cases are grounded in

Put the suite itself at `suites/<slug>/evals.json`. Each case carries a **`claim`** (the
documented claim it grades) and a **`grounding`** (a short reference to the `SKILL.md` text
that claim traces to) — both are required by the gate's presence check, and both are excluded
from the `suite_hash`, so adding or refining them never disturbs a receipt. The gate enforces
the manifest shape, permissive licensing, that every tested skill has a committed suite, and
that every case carries a `claim` + `grounding` — run `npm run gate` before opening the PR. See [CONTRIBUTING.md](CONTRIBUTING.md) for ground
rules (scanner-safe fixtures, no secrets, neutral tone).
