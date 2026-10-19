<!-- SPDX-License-Identifier: Apache-2.0 -->
# Design rules for the site

**The rule in one line: the site is a dark desk, and every piece of evidence stays on paper.**

The page ground, the nav, explainer cards, inputs and the footer are dark graphite. Receipts, charts,
score tables, calculator results and long-form reading sit on cream paper cards in ink. Plot and
receipt SVGs are ink on paper already and are never redrawn for the site: they go on a paper card.
Every value is a token in `docs/tokens.css`; no other stylesheet states a colour, a size or a radius.
Decided for issue 50 (spec 170).

## Tokens

The dark shell:

| Token | Value | Use |
|---|---|---|
| `--desk` | `#191A1C` | the page ground |
| `--surface` | `#222427` | explainer cards, inputs, rails, the summary card |
| `--surface-2` | `#1E1F22` | a second step on the desk |
| `--deep` | `#101113` | code blocks, commands, the citation card |
| `--border` | `#35373B` | hairlines on the desk |
| `--border-strong` | `#55575C` | input edges, button edges |
| `--shell-text` | `#F0EEE6` | text on the desk |
| `--shell-muted` | `#A6A299` | secondary text on the desk |
| `--shell-faint` | `#76787D` | rules only: it does not clear 4.5:1 for text |
| `--shell-accent` | `#93A8FF` | links, the active nav link, focus on the desk |

Paper objects:

| Token | Value | Use |
|---|---|---|
| `--sheet` | `#F3EDDC` | the card stock |
| `--ink` | `#1F1D1A` | text on paper |
| `--ink-muted` | `#625C50` | secondary text on paper |
| `--rule` | `#CBC1AC` | rules on paper |
| `--sheet-rule` | `#E4DCC8` | a table's row rule |
| `--grey-band` | `#B9B1A0` | the grey band |
| `--accent-ink` | `#2A3C9E` | the stamp, and a link on paper |

- `--accent` stays `#44CC11`, the badge colour (spec 020 AC-3), and no rule reads it.
- A paper card casts `--sheet-shadow`, `0 8px 24px rgba(0,0,0,0.5)`.
- Receipt-type cards only (the hero receipt, a calculator result, the preset cards, a report teaser's
  chart) lie at `--card-tilt`, half a degree. A table or a reading sheet never tilts.
- Every text pair is declared in the `driftproof:contrast` block and clears WCAG's 4.5:1. A new pair
  is declared before it is used. No pair is dropped to make a gate pass.

## Type

- Headings in Newsreader: 56px for the hero, 44px for a page title, 36px for a section, 30px for a
  report's own section title. Under 640px: 36px, 32px and 26px.
- Body in Alegreya Sans at 18px, line height 1.6.
- Courier Prime for every number, hash, range and code a reader compares character by character.

## Spacing and layout

- An 8px spacing scale: `--s-1` 8px, `--s-2` 16px, `--s-3` 24px, `--s-4` 32px, `--s-5` 40px,
  `--s-6` 48px, `--s-8` 64px.
- Content is capped at 1200px with 32px side padding, 20px under 640px. On a page with a rail, the
  rail stands beside that column, outside the cap, and the nav and footer line up with the two.
- Sections stand 64px apart on a desktop and 36px on a phone.
- Breakpoints at 1024px and 640px. From 1024px a page's rail sits on the right. Under 640px the nav
  collapses to its menu button.
- Touch targets are at least 44px. A wide table scrolls inside its paper card.
- Running text holds the reading measure, `--w-read`, on every surface, the paper sheet included.

## Measurement pages: issue 408

The operator ruled "Lift the rules for codex" on 18 Oct 2026 at about 20:10 SGT. Skills pages, the skills index and Report 015 use a light, flat measurement workspace. The dark desk rules above continue on other pages. This boundary is explicit: the shared chrome builder adds body.measurement-ui only to those routes. Receipt pages and sealed plots keep their own colours.

| Token | Value | Use |
|---|---|---|
| --measure-ground | #F5F7FA | quiet page ground |
| --measure-card | #FFFFFF | evidence cards |
| --measure-text | #172B3A | headings and body |
| --measure-muted | #495B6A | secondary explanations |
| --measure-link | #174BB8 | links and focus |
| --measure-rule | #D8E0E8 | grouping borders, never text |
| --measure-control | #6D7F8E | control edges |
| --measure-positive | #146044 | helped label |
| --measure-negative | #9F3036 | hurt label |
| --measure-caution | #765310 | too-few-answers label |

System UI sans-serif sets these pages. Body is 17px with 1.6 line height; supporting text is at least 15px. Titles range from 32px to 48px, section headings are 28px. Reading paragraphs stop at 68ch. The page is capped at 1280px. Cards have a 12px radius, a thin border, no tilt and no shadow. The existing spacing scale and 44px touch targets remain.

Comparison rows keep the frozen list order, each with the skill name and two explicitly labelled model cells. Below 640px the cells stack. The result, reader wording, driver-task bands, scope, isolation, router limit, links and earlier failures stay visible. Only the complete task-basis list folds under a native summary. Colour supplements the written state; it never replaces it. Report tallies are the first summary content. An index jump link reaches the full searchable catalogue without traversing every measured row.

Every new text pair is declared and must clear 4.5:1. Long names and hashes wrap; the document never scrolls sideways on a phone. Focus stays visible. No animations, images or provider calls are added.

## Issue 408: return to the site palette

The operator ruled on 18 Oct 2026 at about 21:15 SGT: "keep the theme colors same as the main website. Remaining it has free will." This supersedes the light measurement palette above. Skills pages and Report 015 use the dark desk and navigation, paper evidence cards, existing ink and link tokens, Newsreader headings, Alegreya Sans prose and Courier Prime values. Measurement colour tokens are aliases of the main palette. No sealed plot changes.

The comparison is a compact table, in popularity order, with both answering models side by side. Each cell keeps its scoped result, unchanged plain wording and a named task reason. The adjacent task-score control explains the exact bands. Further evidence uses a native disclosure. Shared test limits remain visible above the table; every result retains its own full limits, links and task basis. Earlier failures and retry authorization stay visible. Phone columns stack inside the viewport. Radius declarations use the existing radius token. Text contrast stays at least 4.5:1.

## Issue 408: plain result cards

Operator ruling, 18 Oct 2026 about 22:00 SGT. Keep the main-site desk, paper, ink and accent palette. Lead each measurement with its scoped plain result and a short explanation of that state. Put the verbatim statistical reading, task bands, provenance and earlier attempts inside adjacent native disclosures. A visible test-record link gives a direct route to the evidence. The comparison remains in popularity order and uses the same model columns. A visual same-task, with-skill/without-skill sequence sits between the overview and comparison. No script is needed to read any evidence. Colour supplements written states, never replaces them. Keep 4.5:1 text contrast and no document overflow at 390px, even when details are open.

## Issue 408: the scoreboard

Operator ruling, 18 Oct 2026 about 23:45 SGT: "A lets go with i like it". Concept A replaces the evidence wall. Use the main dark desk, full shared navigation, paper cards, original ink and accent palette. Lead the skills index with a large question and a paper scoreboard: labelled horizontal count bars for each answering model, with the exact count and total in text. Bars count receipts, not effect sizes. The all-record tally remains available, including before Report 015's examples.

The comparison is a native table in frozen popularity order, with the skill name, repository and two answering-model columns. Show the plain result and a direct test-record link. Put the short guide and complete unchanged reading inside Why this result? on compact cells. Skill cards keep the guide visible, along with the model, judge and date. Each reading retains its adjacent driver tasks, bands, limits, history and links. Shared limits may fold into a named native control. The how-we-test diagram follows the comparison on the index and remains on skill pages and the report. No evidence depends on JavaScript. Keep text contrast at 4.5:1 and no sideways scroll at 390px, including with every control open.
