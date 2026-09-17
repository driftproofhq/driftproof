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

# ── the palette, READ from docs/tokens.css ──────────────────────────────────
#
# It was six hex literals copied here with a comment saying where they came from,
# which is two copies of one palette and a note asking a reader to keep them
# equal. Spec 025 D2 moved four of the six and nothing went red, because nothing
# was reading this file. The values are resolved out of the tokens file's own
# fenced block now, through one level of var() alias, and a token this script
# names and that file does not declare is an error rather than a stale colour.
HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "..", "docs")


def _tokens(path=None):
    src = open(path or os.path.join(DOCS, "tokens.css"), encoding="utf-8").read()
    a, b = src.find("/* driftproof:tokens */"), src.find("/* driftproof:/tokens */")
    if a < 0 or b < 0:
        raise SystemExit("docs/tokens.css carries no fenced token block")
    block = src[a:b]
    raw = dict(re.findall(r"--([a-z0-9-]+)\s*:\s*([^;]+);", block))

    def rgb(name, depth=0):
        v = raw.get(name)
        if v is None or depth > 3:
            raise SystemExit("docs/tokens.css declares no --%s" % name)
        v = v.strip()
        alias = re.match(r"^var\(--([a-z0-9-]+)\)$", v)
        if alias:
            return rgb(alias.group(1), depth + 1)
        m = re.match(r"^#([0-9a-fA-F]{6})$", v)
        if not m:
            raise SystemExit("--%s is not a hex this script can draw with: %s" % (name, v))
        return tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4))
    return rgb


_rgb = _tokens()
PAPER = _rgb("paper")
INK = _rgb("ink")
MUTED = _rgb("ink-muted")
ACCENT = _rgb("accent")
ACCENT_INK = _rgb("accent-ink")
RULE = _rgb("rule")

# Set by main() from --fonts-dir. A module-level slot rather than a parameter
# threaded through five drawing functions: the face is a property of the run.
FONTS_ARG = [None]

WORDMARK = "Driftproof"
LINE = "Skill tests expire. Driftproof dates them."
SECONDARY = "Dated, hash-verified receipts that an agent skill still helps."

# ── the display face, from docs/fonts/ ──────────────────────────────────────
#
# THE CARD IS DRAWN IN THE SITE'S OWN TYPE (spec 025 D9). It was drawn in
# whichever system sans this box happened to carry, so the one image most readers
# see before they see the site was set in a face the site does not use.
#
# The shipped file is a subsetted woff2, which Pillow cannot read, so it is
# decompressed IN MEMORY at build. That is the amendment's "build-time use of the
# same files", and it is why nothing new is shipped: one artifact, two consumers.
#
# A MISSING FILE IS AN ERROR, never a silent fallback. A card drawn in the wrong
# face is a card nobody notices is wrong, which is the same argument the sans
# fallback below already makes. The gate proves the file reaches the pixels by
# rendering the same card against a DIFFERENT font at that path and requiring the
# bytes to move.
FONTS_DIR = os.path.join(DOCS, "fonts")
DISPLAY_FILE = "instrument-serif-regular.woff2"


def display_font(size, fonts_dir=None):
    p = os.path.join(fonts_dir or FONTS_DIR, DISPLAY_FILE)
    if not os.path.exists(p):
        raise SystemExit("no display face at %s - the card is not drawn in a face the site does not use" % p)
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        raise SystemExit("fontTools is needed to read %s; pip install 'fonttools[woff]'" % DISPLAY_FILE)
    f = TTFont(p)
    f.flavor = None
    buf = io.BytesIO()
    f.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, size)


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

    bold = display_font(112, FONTS_ARG[0])
    regular = load_fonts(84, 34)[1]
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
    bold = display_font(104, FONTS_ARG[0])
    regular = display_font(48, FONTS_ARG[0])
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


def build_receipt(out_dir, hash16, skill, model, date, label):
    """One card per receipt (spec 036 AC-5).

    The skill, the model, the date and the state's label, as the receipt page shows
    them, and no figure: a lift on an image is a number no gate can read back, while
    the label is regenerated here from the same receipt and compared byte for byte.
    Content-hashed like the report cards, so a changed card is a new URL.
    """
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    bold = display_font(84, FONTS_ARG[0])
    regular = display_font(46, FONTS_ARG[0])
    small = load_fonts(76, 30)[1]

    d.rectangle([0, 0, 13, H], fill=ACCENT)
    x = MARGIN
    glyph(d, x, 110, scale=1.1)
    d.text((x, 190), "Driftproof receipt", font=small, fill=MUTED)

    max_width = W - (2 * MARGIN)
    ly = 240
    for line in wrap(d, skill, bold, max_width):
        box = d.textbbox((0, 0), line, font=bold)
        d.text((x, ly - box[1]), line, font=bold, fill=INK)
        ly += (box[3] - box[1]) + 18
    d.rectangle([x, ly + 14, x + 168, ly + 21], fill=ACCENT)
    ly += 50
    for line in wrap(d, model, regular, max_width):
        d.text((x, ly), line, font=regular, fill=INK)
        ly += 56
    for line in wrap(d, "%s  |  %s" % (date, label), small, max_width):
        d.text((x, ly + 8), line, font=small, fill=ACCENT_INK)
        ly += 42

    return _write_hashed(img, out_dir, "receipt-%s" % hash16)


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
    docs = DOCS
    ap.add_argument("--out", default=os.path.join(docs, "og.png"))
    ap.add_argument("--fonts-dir", default=None,
                    help="where to read the display face from; the gate points this at a "
                         "directory holding a DIFFERENT face and requires the bytes to move")
    ap.add_argument("--icons", action="store_true", help="also write the favicon PNGs")
    ap.add_argument("--default-hashed", action="store_true",
                    help="write the default card as og.<contenthash>.png into --out-dir")
    ap.add_argument("--report", help="build a per-report card instead of the default one")
    ap.add_argument("--type", default="")
    ap.add_argument("--models", default="")
    ap.add_argument("--counts", default="")
    ap.add_argument("--receipt", help="build a per-receipt card: the first 16 hex of its receipt_hash")
    ap.add_argument("--skill", default="")
    ap.add_argument("--model", default="")
    ap.add_argument("--date", default="")
    ap.add_argument("--label", default="")
    ap.add_argument("--out-dir", default=os.path.join(docs, "cards"))
    args = ap.parse_args()
    FONTS_ARG[0] = args.fonts_dir

    if args.default_hashed:
        print(build_default_hashed(os.path.abspath(args.out_dir)))
        return 0

    if args.receipt:
        if not re.match(r"^[0-9a-f]{16}$", args.receipt):
            raise SystemExit("--receipt takes the first 16 hex characters of a receipt_hash")
        print(build_receipt(os.path.abspath(args.out_dir), args.receipt, args.skill, args.model, args.date, args.label))
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
