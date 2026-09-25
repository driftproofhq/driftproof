<!-- SPDX-License-Identifier: Apache-2.0 -->
# Contributing to Driftproof

Thanks for your interest. Driftproof is early and the shape is still settling, so
issues that pressure-test the **receipt spec** and the **credibility of the number**
are especially welcome.

## Ground rules

- **License:** contributions are under [Apache-2.0](LICENSE). Keep the SPDX header
  on new source files.
- **The gate must stay green.** Run `npm run gate` before opening a PR. It checks
  the schema, receipt round-trip/tamper-evidence, the drift band logic, and a
  hygiene scan. CI runs the same gate. It is green on a clean clone of a release
  tag at any clone depth — see *Checks that do not apply to every checkout*.
- **No secrets, no absolute paths, no personal data** in the tree — the hygiene
  scan in the gate enforces this and will fail the build.
- **Scanner-safe fixtures (blocking).** No string anywhere in the tree may match a
  known live-credential format — see below.
- **Neutral tone.** Docs describe what Driftproof does; they do not compare it to
  other projects.

## Scanner-safe fixtures

Eval suites sometimes need to depict insecure code — for example, a code-review
case that plants a hardcoded API key so we can grade whether the skill flags it.
**Never use a real provider's credential format for these fixtures, even with a
fake value.** Push-protection scanners (GitHub, GitLab, etc.) pattern-match on the
*shape* of a credential, not on whether it is live, so a fixture like
`sk_live_…`, `ghp_…`, `AKIA…`, or `xoxb-…` will get a push **blocked** — a publish
outage — regardless of intent.

Use an **invented provider prefix** that matches no scanner signature but still
reads unambiguously as a hardcoded secret, e.g.:

```js
const apiKey = "acme_live_9xEXAMPLEFAKE0000";  // scanner-safe, still obviously a secret
```

The gate enforces this: the **credential-format policy** check (`tests/gate.js`)
fails the build if any tracked or staged file matches `sk_live_`/`sk_test_`,
`gh[pousr]_`, `AKIA…`, `xox[baprs]-`, `AIza…`, `sk-ant-`/`sk-…`, a GCP OAuth id,
or a Slack webhook URL. This is a hard, blocking rule, separate from the hygiene
scan that catches genuine leaks.

## Good first contributions

- **New example skills** under `examples/` with an `agentskills.io/evals` suite.
  Aim for graded difficulty so the with-skill score lands below saturation.
- **Runner robustness** — provider edge cases, timeouts, retries.
- **Spec feedback** — open an issue if a receipt field feels premature,
  under-specified, or missing. The [open questions](spec/RECEIPT.md) are a good
  starting point.

## Development

```bash
npm install
npm run gate                      # offline gate (no model calls)
DRIFTPROOF_LIVE=1 npm run gate    # also run the sampled runner end-to-end on haiku
```

### Checks that do not apply to every checkout

Some assertions have a subject a given checkout may not carry. They report
**`[N/A]` with the cause printed beside them** — never a silent pass, never a
removed row, and never a failure. The headline counts them separately:

```
=== DRIFTPROOF PHASE-7 GATE RESULT: 619/619 passed, 0 failed, 1 not applicable ===
```

Today there is one, and it is about **git history rather than about the code**:

| Check | Not applicable when | Why |
|---|---|---|
| `no commit on this branch carries an approval record alongside anything else (DECISIONS #4)` | the checkout has no `refs/heads/main` | The rule is about the range a merge would bring in. A `git clone --depth 1 --branch <tag>` carries the tag and no branch, so that range **does not exist there** — there is no branch being merged and no commit for the rule to be wrong about. |

**`[N/A]` is only ever the answer to "the subject is not here", positively
detected.** It is never the answer to "I could not read it": a range that fails
to resolve for any *other* reason is still a failure, because an unreadable
subject and an absent one are different facts and only one of them is benign.

A full clone of the same tag runs the check normally. If you are looking at an
`[N/A]` row on a checkout that *does* have full history, that is a bug — please
open an issue.

Provider defaults to `cli` (`claude -p`, subscription session). Set
`CLAUDE_PROVIDER=api` with `ANTHROPIC_API_KEY` to use the Messages API.

## Changing the receipt schema

The receipt schema is versioned (`spec/receipt.schema.json` is current; older
versions are kept alongside it). If you change it:

1. Bump `RECEIPT_SCHEMA_VERSION` in `config.js`.
2. Add the new schema file and keep the prior one so old receipts still validate.
3. Update `spec/RECEIPT.md`.
4. Add or update gate assertions for the new fields **and** a backward-compat
   check that prior-version receipts still load.
