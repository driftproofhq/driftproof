# Rubric Grounding Sweep — Report #001 suites

**Date:** 2026-07-29
**Trigger:** The maintainer of addyosmani/agent-skills opened issue #432 auditing whether our suite cases
are grounded in claims their SKILL.md actually makes. In our own re-audit, *we* found and disclosed in #432
one rubric sub-criterion in `git-workflow-and-versioning` (`semver-clean-bump`) that imported standard SemVer
knowledge the skill's SKILL.md does not state. This sweep applies the grounding policy to **all 10 suites**.

## Policy applied

> Every gradable rubric criterion must trace to text present in the skill's SKILL.md at the pinned SHA.
> Criteria that import domain knowledge the skill does not state are not gradable, regardless of how
> standard that knowledge is. Claims may summarize; rubrics may not extrapolate.

**Operational test used for each criterion:** *Could a model that faithfully applied everything the SKILL.md
states still fail this criterion?* If yes, the criterion imports unstated knowledge and must be removed or
rewritten to grade only in-text claims.

## Method

- Scope: all 10 suites × 7 cases = **70 cases**, every gradable criterion (checkable criteria, CAP rules,
  subtract clauses, and the scoring-anchor tiers).
- Each rubric was compared against its skill's SKILL.md **at the pinned SHA** (manifest `content_sha256`;
  all 10 local copies re-verified byte-identical to the pinned hashes before the sweep).
- Classification per criterion: **in-text** (traces to SKILL.md text) vs **imported** (adds an unstated
  value / rule / threshold / enumeration / ordering).

## Result summary

| Suite | Cases | Imported criteria | Outcome |
|---|---|---|---|
| code-review-and-quality | 7 | 0 | CLEAN |
| git-workflow-and-versioning | 7 | 1 case | **AMENDED** |
| documentation-and-adrs | 7 | 0 | CLEAN |
| commit-work | 7 | 7 cases (systemic) | **AMENDED** |
| writing-clearly-and-concisely | 7 | 0 | CLEAN |
| crafting-effective-readmes | 7 | 0 | CLEAN |
| naming-analyzer | 7 | 0 | CLEAN |
| requesting-code-review | 7 | 0 | CLEAN |
| writing-plans | 7 | 0 | CLEAN |
| skill-creator | 7 | 0 | CLEAN |

**Two suites carry imported criteria and are amended: `git-workflow-and-versioning` and `commit-work`.**
The other eight are grounded and unchanged.

---

## Finding 1 — `git-workflow-and-versioning` / `semver-clean-bump`

**Imported criterion (verbatim, criterion 3 of the original rubric):**

> (3) The justification recognizes that when changes of different levels are combined, the highest-precedence
> bump governs — the minor feature outranks the patch-level leak fix, so MINOR wins and PATCH resets to 0.

Also imported, and dependent on the same rule:

> SCORING ANCHOR … Award 0.81-0.90 only if it is ALSO exemplary — it explicitly states the highest-change-wins
> rule …
> CAP: if the proposed version is not 2.4.0, cap at 0.3.
> Subtract ~0.2 for each distinct error: … forgetting to reset PATCH to 0, or a justification that
> misclassifies which change drives the bump.

**Missing text.** The pinned SKILL.md defines the three bump levels only:

```
  MAJOR  breaking change — consumers must change their code to upgrade
  MINOR  new functionality, backward-compatible — safe to upgrade
  PATCH  bug fix, backward-compatible — safe to upgrade
```

It does **not** state (a) the precedence rule for **combining** changes of different levels ("the highest bump
governs"), nor (b) the instruction to **reset lower positions to zero**. A model that faithfully applied the
skill's definitions could classify the optional-parameter addition as a MINOR-level change and the leak fix as
a PATCH-level change, yet be unsure the release as a whole is `2.4.0` rather than `2.3.2` — because the skill
never states which of two combined changes wins. The rubric supplied that rule itself. This is the
sub-criterion we disclosed in #432 — found in our own re-audit, not flagged by the maintainer.

**Amendment.** Rewritten to grade only the in-text MAJOR/MINOR/PATCH definitions: the response must classify
the optional-parameter addition as new backward-compatible functionality (MINOR-level per the skill), rule out
a breaking/MAJOR bump, and propose a minor release (2.4.0). The "highest-precedence-governs / reset-PATCH-to-0"
requirement, the strict "exactly 2.4.0 or cap 0.3" gate, and the "which change drives the bump" subtract are
removed. Case intent (does the model apply the skill's SemVer definitions?) is preserved.

## Finding 2 — `commit-work` (systemic across all 7 cases)

### 2a. Imported: specific Conventional Commits **type vocabulary**

Every commit-work case grades the **specific type token** of the commit message — e.g. (verbatim excerpts):

> the dep commit uses an appropriate type (e.g. `chore(deps)`/`build(deps)`) and the feature commit uses `feat`.
> Messages are Conventional Commits form using appropriate types: `refactor` for the first and `feat` for the second.
> Subtract ~0.2 for each distinct error: … implausible type on either commit … wrong type (e.g. `feat` on the refactor …).

**Missing text.** commit-work's SKILL.md requires Conventional Commits and shows the *shape*:

```
- Use Conventional Commits (required):
  - `type(scope): short summary`
  - blank line
  - body (what/why, not implementation diary)
  - footer (BREAKING CHANGE) if needed
```

…but it **does not enumerate the type vocabulary** (`feat` / `fix` / `refactor` / `chore` / `build` / `style`
/ `test` / `docs`). That vocabulary lives in the external Conventional Commits spec / the skill's bundled
`references/commit-message-template.md` (bundled files are out of Report #001 scope). A model applying the
SKILL.md could write a correctly-shaped message with a sensible but "wrong" token (e.g. `deps: bump zod`) and be
penalized for a token the skill never taught. (Note: `git-workflow-and-versioning`'s SKILL.md **does** enumerate
`feat/fix/refactor/test/docs/chore`, so specific-type grading is in-text *there* — the difference is exactly the
grounding distinction the policy draws.)

**Amendment.** Type grading is softened to **Conventional Commits shape** (`type(scope): summary` — a type
token, optional scope, colon, summary), which the SKILL.md shows. Requirements/subtracts that mandate a
*specific* token are removed. The **logical-split boundaries the SKILL.md does enumerate** ("feature vs
refactor, backend vs frontend, formatting vs logic, tests vs prod code, dependency bumps vs behavior changes")
remain fully graded, as do patch-staging (`git add -p`), the `git diff --cached` secrets/debug-log checks, and
the 1–2-sentence describability test — all in-text.

### 2b. Imported: subject **length / punctuation / mood** rule (case `conventional-commit-single-change`)

**Imported criterion (verbatim):**

> (d) the subject is a reasonable length (roughly <= 72 chars) and does not end with a period.
> … and lowercase-imperative summary …
> Subtract ~0.2 for each distinct error: … subject grossly over length or ending in a period.

**Missing text.** SKILL.md mentions subject length only as an optional thing to *ask the user about*
("Any rules: max subject length, required scopes.") with **no value**, and says nothing about a trailing period
or lowercase/imperative mood. The `<= 72` limit, the no-period rule, and the imperative-mood requirement are
imported git/Conventional-Commits convention.

**Amendment.** These are removed. The case still grades the in-text claim: Conventional Commits shape + blank
line + a body giving what/why (the security motivation).

---

## Borderline criteria reviewed and CLEARED (kept as grounded)

Recorded for transparency — each was checked and judged in-text:

- **`git-workflow` / `semver-hidden-breaking-change` (version 2.0.0)** — grounded: SKILL.md states
  *"A 'patch' that changes behavior consumers relied on is a major change wearing a disguise … When unsure
  whether a change is breaking, assume it is"* and defines *MAJOR = breaking change*. A single breaking change
  ⇒ MAJOR is directly in-text; no combination/precedence rule is needed to reach it.
- **`git-workflow` / `release-cut-version-tag-changelog` (version 2.0.0)** — grounded: the change set contains
  an endpoint **removal** (a breaking change), and *breaking ⇒ major* is stated. The exemplary clause
  ("the breaking removal is why the bump is major, not the feature") is a restatement of *breaking ⇒ major*,
  not the combination-precedence rule that `semver-clean-bump` required (there, no breaking change is present,
  so the answer depends on ranking minor-vs-patch — which the skill does not state). Annotated `git tag -a` and
  the impact-grouped changelog with a migration note are all in-text (SKILL.md "Tag the release…", changelog
  section, "Breaking changes get a migration note").
- **`requesting-code-review` / `identify-base-head-shas`** — grounded: the skill's worked example computes the
  base as the commit at the *start of the task* (`git log … grep "Task 1" … `), demonstrating base = the commit
  before the whole change; the graded-correct answer traces to that in-text example.
- **`writing-clearly-and-concisely` / `tighten-puffy-release-note`** — grounded: "avoid puffery / promotional
  adjectives" is a stated rule and the flagged words are listed (`groundbreaking`, `seamless`, `robust`,
  `cutting-edge`, `pivotal`; the empty `-ing` "showcasing …" pattern is listed). One target word, `thrilled`,
  is not individually enumerated but is a clear instance of the stated puffery rule and is not itself a CAP
  gate — kept.

## Suites re-run

Amending rubrics changes the `suite_hash` of exactly the two amended suites (the `claim`/`grounding`
annotation fields are excluded from `suite_hash` by `normalizeCases`, verified). Therefore **only
`git-workflow-and-versioning` and `commit-work` are re-run** (both models, n=5); the other eight suites keep
their Report #001 receipts unchanged.
