<!-- SPDX-License-Identifier: Apache-2.0 -->
# Self-hosted type

Three families for the site, one face kept for the share cards. Five files for the site plus
one for the cards, Latin subset, `woff2` only. They are served from this origin and nowhere
else, under spec 025 amendment A-025-1 and spec 038 AC-2.

The licences are here because the fonts are redistributed here. All four are licensed under the
SIL Open Font License 1.1.

| file | family | role | upstream (`github.com/google/fonts`, `main`) | sha256 of the upstream file |
|---|---|---|---|---|
| `newsreader-variable.woff2` | Newsreader, `wght` 400 to 600, `opsz` 24 to 72 | headings, the wordmark, the stamp | `ofl/newsreader/Newsreader[opsz,wght].ttf` | `8a08d13f8a6c0d51be379a60af84f945f65369a67e509ee3c3bdcc421254d7c1` |
| `alegreya-sans-regular.woff2` | Alegreya Sans Regular | body | `ofl/alegreyasans/AlegreyaSans-Regular.ttf` | `8fab634196007afca839f1e5a6fb300976daff55d8528b590ef032f01b14ea10` |
| `alegreya-sans-italic.woff2` | Alegreya Sans Italic | body emphasis | `ofl/alegreyasans/AlegreyaSans-Italic.ttf` | `f49f6f2bdd84df850b25b0f8185d8a051e1d1eb2dd08e2f91b8c7b86d9a9e1a6` |
| `alegreya-sans-medium.woff2` | Alegreya Sans Medium | labels, buttons, strong | `ofl/alegreyasans/AlegreyaSans-Medium.ttf` | `4b89fe7804fd1485ec2757795a53ffdb66e1206dd56f844c2d72b3c944815b43` |
| `courier-prime-regular.woff2` | Courier Prime Regular | code, receipt values, hashes | `ofl/courierprime/CourierPrime-Regular.ttf` | `72f793376f8e2841656bf21d77a5de010f2929bd6956a22ee848ad0c7eb978af` |
| `instrument-serif-regular.woff2` | Instrument Serif Regular | the share cards only (`scripts/build-og-card.py`); not declared by any stylesheet, so no page loads it | `ofl/instrumentserif/InstrumentSerif-Regular.ttf` | (spec 025) |

`OFL-Newsreader.txt`, `OFL-AlegreyaSans.txt`, `OFL-CourierPrime.txt` and
`OFL-InstrumentSerif.txt` are each family's `OFL.txt`, taken from the same directory as the face.

## How the subsets were cut

Once, at authoring time (spec 038, 17 Sep 2026), with the output committed. Nothing in the
build fetches a font, and nothing in the shipped package depends on `fonttools`. Newsreader is
first instanced to the axis ranges the site uses. The site sets headings from 20px to 60px, so
the optical-size axis is kept between 24 and 72, and weight is kept between the 400 of a heading
and the 600 of the stamp.

```sh
python3 -c "from fontTools.ttLib import TTFont; from fontTools.varLib import instancer; \
  instancer.instantiateVariableFont(TTFont('Newsreader-VF.ttf'), {'wght': (400, 600), 'opsz': (24, 72)}) \
  .save('Newsreader-400-600-opsz24-72.ttf')"

U='U+0020-007E,U+00A0-00FF,U+0394,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2020,U+2022,U+2026,U+2192,U+2212,U+2248,U+2264,U+2265,U+25BE'
python3 -m fontTools.subset <face>.ttf \
  --unicodes="$U" --layout-features='kern,liga,lnum,tnum,calt' \
  --flavor=woff2 --no-hinting --desubroutinize \
  --output-file=<name>.woff2
```

The code-point set is Basic Latin and Latin-1, plus every other character the site's pages and
plots print, counted over `docs/` before the cut: the delta, the dashes and quotes, the dagger,
the ellipsis, the arrow, the minus, the approximately-equal sign, the comparison operators, and
the menu's triangle. `tnum` and `lnum` are kept because every figure on this site sits in a
column beside another figure.

## The byte budget

Spec 038 AC-2 bounds the declared files at 140 KB, and its gate sums them from the stylesheet's
`@font-face` blocks rather than trusting this sentence. They total 109,300 bytes. With the
share-card face the directory holds 119,052 bytes, which is still under spec 025 A-025-1's
120 KB bound on the directory.
