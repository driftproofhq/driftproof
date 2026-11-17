<!-- SPDX-License-Identifier: Apache-2.0 -->
# GitHub Marketplace listing draft

Title: Driftproof

Short description: Check AI skills and rules on pull requests. Post receipts and optionally fail on a regression or a loss to a fake.

Categories: Testing; Code quality

Branding: shield, green. These match action.yml.

Copy the workflow below and add an ANTHROPIC_API_KEY repository secret. It checks changed skills and supported rules files with test cases and updates one comment per pull request. The default model is Haiku 5.5. API calls are billed by the provider, within the configured cap shared across files. No Claude subscription access is supported.

Skills use evals/evals.json in their folder. Rules files use evals/evals.json beside the file. Missing cases are named as not measured. A fork makes no calls and receives a job-summary notice; its read-only token may prevent a comment. Receipts are job artifacts and expire under GitHub's retention policy. A check with no selected failure is not proof that a file helps.

The fake arm is optional. fail-on-regression defaults to true. fail-on-fake defaults to false and fails only on worse than the fake, never on no better than the fake. OpenAI models require the openai-api-key input as well as a matching models input. Model readings describe only the supplied tasks and the recorded run.

Usage:

```yaml
# SPDX-License-Identifier: Apache-2.0
name: Check skills and rules
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: driftproof-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false
      - uses: driftproofhq/driftproof@v0.30.0
        with:
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          placebo: 'true'
          max-usd: '20'
          fail-on-regression: 'true'
          fail-on-fake: 'false'
```

Operator preparation: this is a listing draft, not a publication. Publish a release containing issue 820 before listing it. The release train updates the version pin in this usage snippet with the workflow and README. Check the public repository's action.yml name, description and branding against this draft and complete GitHub's listing form. Do not list the private source repository. No Marketplace or real CI run was made for this change.
