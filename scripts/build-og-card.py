#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Regenerate docs/og.png — the site's one static link-preview card.

The card is COMMITTED, and this script is how it is regenerated. It is not run
by the gate, the build or the publish: nothing in the shipped package depends on
Pillow, and nothing is added to package.json. That is the point — a project whose
whole runtime dependency set is ajv does not acquire a native image pipeline to
draw one rectangle.

WHAT IS DELIBERATELY NOT ON THE CARD: any number, verdict, count or report
reference. Figures go stale — "six published reports" was wrong the day #007
landed — and unlike page copy, an image cannot be gate-checked. The card carries
only what stays true. This is the same failure class as the hand-maintained
sitemap: state that drifts with nothing watching it.

Output is deterministic: the gate asserts the committed card is byte-identical
to a fresh run of this script.

  python3 scripts/build-og-card.py [--out PATH]
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

# 1200x630 is the one size Twitter, LinkedIn, Slack, Facebook and Discord all
# accept for a large-summary card.
W, H = 1200, 630
MARGIN = 96                      # 8% — inside every platform's edge crop

# Palette from docs/style.css so the card and the site agree. Dark ground with
# the LIGHT theme's accent, which is also what reconciles the site with the
# Action's declared `color: green`.
BG = (0x14, 0x17, 0x1a)          # --bg, dark
FG = (0xe7, 0xea, 0xed)          # --fg, dark
MUTED = (0x9a, 0xa4, 0xad)       # --muted, dark
ACCENT = (0x0b, 0x6b, 0x5f)      # --accent, light

WORDMARK = "Driftproof"
LINE = "A dated proof that this skill, this hash, this model, still helps."

# Ordered by preference. A variable font is asked for its Bold instance by name;
# a static face is taken as it is. Failing every candidate is an error, never a
# silent fallback to a default bitmap font — a card drawn in the wrong face is a
# card nobody notices is wrong.
FONT_CANDIDATES = [
    ("/usr/share/fonts/google-noto-vf/NotoSans[wght].ttf", "Bold", "Regular"),
    ("/opt/libreoffice26.2/share/fonts/truetype/DejaVuSans.ttf", None, None),
]


def load_fonts(size_bold, size_regular):
    for path, bold_name, regular_name in FONT_CANDIDATES:
        if not os.path.exists(path):
            continue
        bold = ImageFont.truetype(path, size_bold)
        regular = ImageFont.truetype(path, size_regular)
        if bold_name:
            try:
                bold.set_variation_by_name(bold_name)
                regular.set_variation_by_name(regular_name)
            except Exception:
                continue
        elif path.endswith("DejaVuSans.ttf"):
            b = path.replace("DejaVuSans.ttf", "DejaVuSans-Bold.ttf")
            if os.path.exists(b):
                bold = ImageFont.truetype(b, size_bold)
        return bold, regular
    raise SystemExit(
        "no usable font found. Tried:\n  " + "\n  ".join(c[0] for c in FONT_CANDIDATES)
    )


def wrap(draw, text, font, max_width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def build(out_path):
    # RGB, not RGBA: several platforms composite transparency onto a background
    # nobody here chose.
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    bold, regular = load_fonts(104, 40)

    # A full-bleed accent band down the left edge — the site's only brand token
    # applied as a rule rather than as text, so nothing depends on the accent
    # carrying contrast it does not have against a dark ground.
    d.rectangle([0, 0, 13, H], fill=ACCENT)

    x = MARGIN
    # Wordmark, optically placed from its own ascender rather than from a
    # nominal line box, so the top margin is what it looks like it is.
    wm_box = d.textbbox((0, 0), WORDMARK, font=bold)
    wm_y = 214
    d.text((x, wm_y - wm_box[1]), WORDMARK, font=bold, fill=FG)
    wm_bottom = wm_y + (wm_box[3] - wm_box[1])

    # Accent rule between the wordmark and the line.
    rule_y = wm_bottom + 46
    d.rectangle([x, rule_y, x + 168, rule_y + 7], fill=ACCENT)

    # The positioning line, wrapped inside the safe area.
    max_width = W - (2 * MARGIN)
    lines = wrap(d, LINE, regular, max_width)
    ly = rule_y + 58
    for line in lines:
        d.text((x, ly), line, font=regular, fill=MUTED)
        ly += 56

    img.save(out_path, "PNG", optimize=True)
    return img.size


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--out", default=os.path.join(here, "..", "docs", "og.png"))
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    size = build(out)
    print(f"{out}: {size[0]}x{size[1]}, {os.path.getsize(out)} bytes")


if __name__ == "__main__":
    sys.exit(main())
