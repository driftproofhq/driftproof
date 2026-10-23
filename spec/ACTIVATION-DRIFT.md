<!-- SPDX-License-Identifier: Apache-2.0 -->
# Activation drift receipts

An activation drift receipt compares recorded Skill-tool firing rates across one
reported model or runtime version change. The plugin, cases, indicator definitions
and fixed setup are operator-declared. This is external evidence, not attestation.
A hash establishes integrity since sealing, not authenticity.

## Make a receipt

Start with two existing claude-plugin-eval imports. No model is called:

    driftproof activation-drift before.json after.json --context context.json --issued-at 2026-10-21T12:00:00Z --out activation-receipts

The source run dates must increase. The issue date must be at least as late as the
newer run. The model and runtime must both be known. Exactly one version axis
changes. A model comparison holds the runtime version fixed. A runtime comparison
holds the model id fixed. Plugin name, version and unit must agree.

The context has this shape. Replace every placeholder with the declared value:

    {
      "axis": "model",
      "before": {
        "receipt_hash": "<before receipt hash>",
        "plugin_sha256": "<plugin bundle fingerprint>",
        "suite_sha256": "<suite and indicator definitions fingerprint>",
        "environment_sha256": "<fixed setup fingerprint>"
      },
      "after": {
        "receipt_hash": "<after receipt hash>",
        "plugin_sha256": "<same plugin bundle fingerprint>",
        "suite_sha256": "<same suite and indicator definitions fingerprint>",
        "environment_sha256": "<same fixed setup fingerprint>"
      },
      "inventory": [
        { "id": "case-id", "indicators": ["skill-fired"] }
      ]
    }

Declare every with-skill case and its indicators, including indicators observed on
neither version. Inventory ids must equal both complete case sets. Definitions
belong to the suite fingerprint. The plugin fingerprint covers the installed
bundle. The setup fingerprint covers permissions, tools, dependencies, invocation,
system instructions, model settings, sampling, seed policy, timeouts and error
admission policy, excluding the chosen version axis. These are declarations;
equal names or missing imported hashes do not establish equal content.

## Read the result

The command writes activation-drift-<full hash>.json and the corresponding
.summary.md, with exclusive creation. A failed publication leaves no newly
created member of the pair. Existing members remain untouched. The default output
directory is ./activation-receipts, separate from ordinary scored receipts.

Every pair records both fired and observed-run counts, admitted runs, unobserved
runs and excluded runs. A firing rate is fired divided by observed runs.
The change is the newer rate minus the older rate, in percentage points.
Zero observations give null rates and change. Missing observations never become
false. Rejected source runs stay outside the denominator. Imports retaining
errors with the error override are refused.

Fewer than 20 observed runs on either side is too few for this reporting policy.
The cutoff is descriptive, not a power calculation. Recorded firing rates do not
establish persistence, cause or answer quality. No sample size earns a score
verdict, equivalence claim or success badge. The summary binds plugin name,
version and unit to the full receipt hash and relative JSON artefact reference.
Source labels are escaped JSON strings in HTML code elements and remain distinct.

## Verify and reproduce

The separate kind is activation-drift, schema_version 1.0, verification_level
DECLARED. The hash covers complete imported receipts, their source hashes, dates,
context inventory and fingerprints, reporting policy, observations, omissions,
calculated rows and limitations. It excludes only the top-level receipt_hash.
The JSON bytes are canonical JSON plus one LF. Summary bytes are UTF-8 Markdown
with LF newlines and one final newline. Cases and indicators use literal UTF-16
code-unit sorting. Evidence arrays retain their original order.

To verify and write a fresh pair from an existing activation receipt:

    driftproof activation-drift --receipt activation-drift.json --out verified-activation

The renderer and writer rerun every builder invariant. Rehashing an inconsistent
receipt does not make its derived rows or dates acceptable. Inputs must be bounded
regular files; special files and symlinks are refused before read-open. Input
receipts allow 16 MiB each, context 1 MiB, and the complete envelope 48 MiB.
Receipts allow depth 32 and 200000 nodes each; context allows depth 32 and 50000
nodes; envelopes allow depth 40 and 1000000 nodes. Containers allow 10000 entries,
strings and keys 16384 UTF-16 units, and displayed identities 256 units. Inventory
allows 1000 cases, 100 indicators per case and 10000 pairs. Structures are checked
before hashing. Cycles and non-JSON values are refused.

The library exports buildActivationDrift, renderActivationDrift,
serializeActivationDrift, readActivationInput and writeActivationDrift from
lib/activation-drift.js. No native receipt schema, archived receipt or scored
verdict is changed by this kind.
