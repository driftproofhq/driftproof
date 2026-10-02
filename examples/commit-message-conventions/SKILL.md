---
name: commit-message-conventions
version: 0.2.0
description: Write git commit messages that follow the Conventional Commits standard.
---

# Commit Message Conventions

When asked to write a git commit message, produce a message that follows the
Conventional Commits 1.0.0 specification.

## Format

```
<type>(<optional scope>): <subject>

<optional body>

<optional footer(s)>
```

## Rules

1. **Type** is required and MUST be one of:
   `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
2. **Scope** is optional, lowercase, in parentheses, naming the area touched
   (e.g. `feat(auth):`).
3. **Subject**:
   - imperative mood ("add", not "added" or "adds"),
   - lowercase first letter,
   - no trailing period,
   - 72 characters or fewer.
4. **Breaking changes** MUST be signalled either with a `!` before the colon
   (`feat!:`) or a `BREAKING CHANGE:` footer (using both is fine).
5. **Body** (when present) explains *what* and *why*, not *how*, wrapped at ~72
   columns, separated from the subject by one blank line.
6. Output ONLY the commit message — no surrounding prose, no code fences, no
   explanation unless explicitly asked.

## Choosing the right type

The type is the most common mistake. Pick by the *nature* of the change, not the
files touched:

- `feat` — a new capability visible to users.
- `fix` — a correction to broken behaviour.
- `perf` — a change whose purpose is to make existing behaviour faster/leaner
  (NOT `refactor` and NOT `fix` — performance is its own type).
- `refactor` — restructuring with no behaviour change and no perf goal.
- `docs` — documentation only.
- `test` — adding or fixing tests only.
- `build` — build system, bundler, packaging, or dependency changes
  (e.g. bumping a build tool or production dependency).
- `ci` — CI configuration and pipelines only.
- `chore` — maintenance that fits nothing above (e.g. dev-only housekeeping).
- `style` — formatting/whitespace with no code-meaning change.

When a change plausibly fits two types, prefer the more *specific* one
(`perf` over `refactor`; `build` over `chore`).

## Footers

Footers go after the body, one per line, in `Token: value` form:

- Issue references: `Refs: #123`, `Closes #123`, `Fixes #123`.
- Breaking changes: `BREAKING CHANGE: <description>`.

## Reverts

To revert a previous commit, use the `revert` type and name the reverted commit
in the body:

```
revert: <subject of the reverted commit>

This reverts commit <hash>.
```

## Splitting unrelated changes

If asked to describe several unrelated changes in one message, the correct guidance
is that they should be **separate commits** — one Conventional Commit each. Say so,
and, if forced into one message, choose the single most significant change for the
subject and list the rest in the body.

## Examples

Good:
```
feat(parser): support trailing commas in arrays
```
```
fix(auth): reject expired refresh tokens

Tokens past their `exp` claim were still accepted because the check compared
against issue time. Compare against the current time instead.
```
```
perf(render): memoize layout computation to cut re-renders
```
```
build(deps): upgrade bundler to v6
```
```
refactor!: drop support for Node 16

BREAKING CHANGE: the minimum supported runtime is now Node 18.
```
```
revert: add dark mode toggle to settings

This reverts commit 9f3c1a2.
```

Bad (do not do these):
- `Added dark mode.` — past tense, capitalized, trailing period, no type.
- `update stuff` — no type, vague subject.
- `fix: made the list render faster` — a performance change should be `perf`, and
  the subject is past tense.
- `feat: Implemented the new caching layer for the API.` — capitalized subject,
  past tense, trailing period.
