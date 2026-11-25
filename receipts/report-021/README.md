<!-- SPDX-License-Identifier: Apache-2.0 -->
# Report 021 evidence

The manifest lists twelve receipts hosted on Zenodo. It records each compressed
and uncompressed SHA-256, byte count and canonical receipt hash. Receipt files
are downloaded separately and are not stored in this repository.

The analysis folder contains the main, removal and replacement-aware outputs.
The suite folder contains the four frozen project pools. The rules folder
contains the five measured texts. SHA256SUMS covers this folder's support files.

From the repository root, use the twelve download commands on the report page,
then run:

    npm i --no-save @babel/parser@7.29.14
    node scripts/analyze-report-021.js --receipts report-021-receipts --check

The script refuses missing, extra or changed receipts. It verifies both byte
hashes and the receipt seal before deriving results. It checks the published
analysis and the page, including ranges and verdict words, without model calls.
The counter in that script counts test/it call sites and their each/only/skip
forms in changed or added test files. Unchanged starters do not count.

The offline reader can rebuild the page from the approved text and the analysis:

    node scripts/analyze-report-021.js --build-page
    node scripts/build-markdown.js
    node scripts/build-head-tags.js

The model runner arrives with a later release. This folder does not contain it.
