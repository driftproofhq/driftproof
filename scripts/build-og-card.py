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
import hashlib
import io
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

# 1200x630 is the one size Twitter, LinkedIn, Slack, Facebook and Discord all
# accept for a large-summary card.
W, H = 1200, 630
MARGIN = 96                      # 8% - inside every platform's edge crop

# Palette from docs/tokens.css so the card and the site agree. The card is drawn
# on the brand paper, not on a dark ground: the site committed to one look in
# spec 020 and a card that inverts it reads as a different product.
PAPER = (0xFB, 0xFA, 0xF7)       # --paper
INK = (0x14, 0x18, 0x1D)         # --ink
MUTED = (0x5A, 0x64, 0x6E)       # --ink-muted
ACCENT = (0x44, 0xCC, 0x11)      # --accent, the badge JSON colour
ACCENT_INK = (0x2E, 0x7A, 0x0B)  # --accent-ink
RULE = (0xE2, 0xE0, 0xD8)        # --rule

WORDMARK = "Driftproof"
LINE = "Skill tests expire. Driftproof dates them."
SECONDARY = "Dated, hash-verified receipts that an agent skill still helps."

# Ordered by preference. A variable font is asked for its Bold instance by name;
# a static face is taken as it is. Failing every candidate is an error, never a
# silent fallback to a default bitmap font - a card drawn in the wrong face is a
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


def glyph(d, x, y, scale=1.0, separated=True):
    """The band glyph, in the same geometry as docs/assets/glyph-*.svg.

    Two rounded bars offset so they do not overlap. Drawn, not imported: the SVG
    is the web asset and this is the raster one, and they are held together by
    both being read out of the same three numbers rather than by a converter.
    """
    def r(bx, by, bw, bh, fill):
        d.rounded_rectangle(
            [x + bx * scale, y + by * scale, x + (bx + bw) * scale, y + (by + bh) * scale],
            radius=(bh / 2.0) * scale, fill=fill)
    r(6, 8, 20, 10, ACCENT)
    r(34 if separated else 22, 22, 24, 10, INK)


def build(out_path):
    # RGB, not RGBA: several platforms composite transparency onto a background
    # nobody here chose.
    img = Image.new("RGB", (W, H), PAPER)
    _draw_default(img)
    img.save(out_path, "PNG", optimize=True)
    return img.size


def _draw_default(img):
    d = ImageDraw.Draw(img)

    bold, regular = load_fonts(84, 34)
    sub = load_fonts(84, 30)[1]

    # A full-bleed accent band down the left edge - the brand mark applied as a
    # rule rather than as text, so nothing depends on the accent carrying
    # contrast it does not have.
    d.rectangle([0, 0, 13, H], fill=ACCENT)

    x = MARGIN
    glyph(d, x, 150, scale=1.5)

    wm_box = d.textbbox((0, 0), WORDMARK, font=bold)
    wm_y = 250
    d.text((x, wm_y - wm_box[1]), WORDMARK, font=bold, fill=INK)
    wm_bottom = wm_y + (wm_box[3] - wm_box[1])

    rule_y = wm_bottom + 40
    d.rectangle([x, rule_y, x + 168, rule_y + 7], fill=ACCENT)

    max_width = W - (2 * MARGIN)
    ly = rule_y + 52
    for line in wrap(d, LINE, regular, max_width):
        d.text((x, ly), line, font=regular, fill=INK)
        ly += 48
    ly += 10
    for line in wrap(d, SECONDARY, sub, max_width):
        d.text((x, ly), line, font=sub, fill=MUTED)
        ly += 42


def _write_hashed(img, out_dir, stem):
    """Write a PNG whose FILENAME carries a hash of its own bytes.

    The name cannot be known until the bytes exist, so the image is encoded to
    memory first. Any previous hash for the same stem is removed, so the
    directory never accumulates orphans a page no longer references.
    """
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    data = buf.getvalue()
    digest = hashlib.sha256(data).hexdigest()[:8]
    name = "%s.%s.png" % (stem, digest)
    os.makedirs(out_dir, exist_ok=True)
    for stale in os.listdir(out_dir):
        if re.match(r"^%s\.[0-9a-f]{8}\.png$" % re.escape(stem), stale) and stale != name:
            os.remove(os.path.join(out_dir, stale))
    with open(os.path.join(out_dir, name), "wb") as fh:
        fh.write(data)
    return name


def build_default_hashed(out_dir):
    """The default card, content-addressed (spec 020 A2)."""
    img = Image.new("RGB", (W, H), PAPER)
    _draw_default(img)
    return _write_hashed(img, out_dir, "og")


def build_report(out_dir, number, rtype, models, counts):
    """One card per report (spec 020 AC-16).

    NO HASH SIGN in front of the number, and the green line at the foot is the
    report's own VERDICT line where it has one, in place of its summary
    (spec 020 amendment 12, fix pass R3 and R7). Neither is readable out of a
    PNG, so the gate asserts both by regenerating every card from today's data
    and comparing bytes.

    The filename carries the first eight hex of a SHA-256 over the PNG bytes, so
    a redeployed card is a NEW URL and a cache keyed on URL cannot go on serving
    the old one. Written to a temporary name first because the name is not
    knowable until the bytes exist.
    """
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    bold, regular = load_fonts(76, 34)
    small = load_fonts(76, 28)[1]

    d.rectangle([0, 0, 13, H], fill=ACCENT)
    x = MARGIN
    glyph(d, x, 110, scale=1.1)

    d.text((x, 190), "Driftproof", font=small, fill=MUTED)
    n_box = d.textbbox((0, 0), "Report %s" % number, font=bold)
    d.text((x, 240 - n_box[1]), "Report %s" % number, font=bold, fill=INK)
    top = 240 + (n_box[3] - n_box[1])

    d.rectangle([x, top + 32, x + 168, top + 39], fill=ACCENT)

    max_width = W - (2 * MARGIN)
    ly = top + 62
    for line in wrap(d, rtype, regular, max_width):
        d.text((x, ly), line, font=regular, fill=INK)
        ly += 46
    for line in wrap(d, models, small, max_width):
        d.text((x, ly), line, font=small, fill=MUTED)
        ly += 38
    ly += 6
    for line in wrap(d, counts, small, max_width):
        d.text((x, ly), line, font=small, fill=ACCENT_INK)
        ly += 38

    return _write_hashed(img, out_dir, "report-%s" % number)


def build_icons(out_dir):
    """favicon-32, apple-touch-icon-180, icon-512 (spec 020 AC-2).

    Rendered at 4x and downsampled, because a 32px rounded bar drawn directly is
    a smear. Same three numbers as the SVG.
    """
    written = []
    for size, name in ((32, "favicon-32.png"), (180, "apple-touch-icon-180.png"), (512, "icon-512.png")):
        ss = size * 4
        img = Image.new("RGB", (ss, ss), PAPER)
        d = ImageDraw.Draw(img)
        k = ss / 64.0
        d.rounded_rectangle([0, 0, ss - 1, ss - 1], radius=12 * k, fill=PAPER)
        d.rounded_rectangle([10 * k, 20 * k, 32 * k, 30 * k], radius=5 * k, fill=ACCENT)
        d.rounded_rectangle([34 * k, 36 * k, 54 * k, 46 * k], radius=5 * k, fill=INK)
        img = img.resize((size, size), Image.LANCZOS)
        p = os.path.join(out_dir, name)
        img.save(p, "PNG", optimize=True)
        written.append(p)
    return written


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    docs = os.path.join(here, "..", "docs")
    ap.add_argument("--out", default=os.path.join(docs, "og.png"))
    ap.add_argument("--icons", action="store_true", help="also write the favicon PNGs")
    ap.add_argument("--default-hashed", action="store_true",
                    help="write the default card as og.<contenthash>.png into --out-dir")
    ap.add_argument("--report", help="build a per-report card instead of the default one")
    ap.add_argument("--type", default="")
    ap.add_argument("--models", default="")
    ap.add_argument("--counts", default="")
    ap.add_argument("--out-dir", default=os.path.join(docs, "cards"))
    args = ap.parse_args()

    if args.default_hashed:
        print(build_default_hashed(os.path.abspath(args.out_dir)))
        return 0

    if args.report:
        name = build_report(os.path.abspath(args.out_dir), args.report, args.type, args.models, args.counts)
        print(name)
        return 0

    out = os.path.abspath(args.out)
    size = build(out)
    print(f"{out}: {size[0]}x{size[1]}, {os.path.getsize(out)} bytes")
    if args.icons:
        for p in build_icons(os.path.abspath(os.path.dirname(out))):
            print(f"{p}: {os.path.getsize(p)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
