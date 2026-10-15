<!-- SPDX-License-Identifier: Apache-2.0 -->
# Hand-made Harbor trials

These trials are made by hand for spec 266. They are not from any real run.

`same-name/` holds two jobs. Two tasks are both named `shared-name`. They have different
`task_id` paths and different checksums. The `with` job ran both tasks. The `without` job
ran only task `b`. Keyed by task id and checksum, only task `b` is in both jobs, and its
delta is 0 minus 1. Keyed by name, the two tasks would merge into one case with a
different delta. Spec 266 AC-1 reads this pair.

The other negative inputs are made by `tests/import-harbor.test.js` from copies of the
real trials in `../skill-placebo/`, changed in a temporary directory.
