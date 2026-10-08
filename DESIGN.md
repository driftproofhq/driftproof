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
