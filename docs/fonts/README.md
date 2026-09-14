<!-- SPDX-License-Identifier: Apache-2.0 -->
# Self-hosted type

Two families, three files, Latin subset, `woff2` only. Served from this origin
and from nowhere else, under spec 025 amendment A-025-1, which amends spec 020
AC-3 from *no web font is served* to *no font request to any origin other than
`driftproofhq.com`*, under conditions the gate asserts.

The licences are here because the fonts are redistributed here. Both are SIL
Open Font Licence 1.1.

| file | family | upstream |
|---|---|---|
| `instrument-serif-regular.woff2` | Instrument Serif Regular | `github.com/google/fonts`, `ofl/instrumentserif/InstrumentSerif-Regular.ttf` |
| `ibm-plex-mono-regular.woff2` | IBM Plex Mono Regular | `github.com/google/fonts`, `ofl/ibmplexmono/IBMPlexMono-Regular.ttf` |
| `ibm-plex-mono-medium.woff2` | IBM Plex Mono Medium | `github.com/google/fonts`, `ofl/ibmplexmono/IBMPlexMono-Medium.ttf` |

`OFL-InstrumentSerif.txt` and `OFL-IBMPlexMono.txt` are each family's licence,
taken from the same directory as the face beside it.

## How the subsets were cut

One command per face, at authoring time, with the output committed. Nothing in
the build fetches a font, and nothing in the shipped package depends on
`fonttools`.

```sh
U='U+0020-007E,U+00A0,U+00B1,U+00B7,U+00D7,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+2032,U+2033,U+2192,U+2264,U+2265'
python3 -m fontTools.subset <face>.ttf \
  --unicodes="$U" --layout-features='kern,liga,tnum,calt' \
  --flavor=woff2 --no-hinting --desubroutinize \
  --output-file=<name>.woff2
```

The code-point set is Latin plus the punctuation and the operators this site
actually prints: the plus-or-minus a band carries, the multiplication sign a
ratio carries, the ellipsis a truncated description carries, and the arrow and
the comparison operators the tables carry. `tnum` is kept because every figure on
this site sits in a column beside another figure.

## The byte budget

A-025-1 bounds all font files together at 120 KB, and the gate sums the directory
rather than trusting this sentence. A face that grows past the bound takes the
gate red, which is the point: the bound is what makes self-hosting equivalent to
the render behaviour the original clause was protecting.
