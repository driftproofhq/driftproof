# Paper

Canonical: <https://driftproofhq.com/paper/>

Reported, Not Measured: An Empirical Study of Measurement Defects in LLM and Agent Evaluation Tools

driftproofhq
Version 2, 11 November 2026
Preprint, not peer reviewed

## What version 2 found

- 26 defects in 15 tools, each reported upstream with a public reproduction.
- 22 carried a proposed fix from the author.
- On 11 November 2026, 13 were fixed upstream: 11 through the author's pull requests, 1 through the maintainers' own and 1 through a third party's.
- 1 was closed unfixed, because its feature is to be deprecated.
- 12 were open, 1 of them with an opt-in mitigation merged.
- The defects fall into 7 kinds.

In each case the tool returned a well-formed result that its evidence did not support.

## Abstract

Evaluation tools for language-model applications and agent skills are used as gates: a score decides whether a skill ships, which demonstrations a prompt compiler keeps, or whether a model is promoted. This paper is an exploratory study of the software between evidence that has already been produced and the result an evaluation tool reports. Between 14 September and 27 October 2026 the author read or exercised the scoring and gating paths of fifteen tools, chosen by the author's judgement rather than sampled, reproduced twenty-six defects and reported each upstream with a public reproduction; twenty-two carried a proposed fix from the author. On 11 November 2026 thirteen were fixed upstream (eleven through the author's pull requests, one through the maintainers' own and one through a third party's), one was closed unfixed because its feature is to be deprecated, and twelve were open, one of them with an opt-in mitigation merged. In each case the tool returned a well-formed result that its evidence did not support. The defects fall into seven kinds, derived from the cases: absent evidence scored as a measurement, a result bound to the wrong unit, a proxy credited as the act, stale state read as current, a sign error in a threshold, a check aimed at a target the artefact never claimed, and a judgement made on input the judge could not tell apart. The same taxonomy is applied to the author's own instrument, Driftproof, using only its public findings, which now include verdicts that rested on lost draws, imported comparisons scored on one arm only, and two published rows that measured a one-line pointer instead of the skill it calls. Nine published measurements serve as illustrations, not as tests; three of them add a same-length placebo arm. From the cases the paper proposes nine record fields, each paired with the check that would read it, and maps each defect of the first window to the field and check that could have exposed it; the mapping is a design argument the paper has not yet tested, and none of the nine fields exposes the seventh kind. The distinction the paper draws is between a noisy measurement, which statistics can qualify, and a well-formed number that was never a valid measurement, which statistics cannot repair. The evidence is a catalogue of mechanisms found where the author looked; it is a lower bound on what exists, not a prevalence estimate.

## Read the paper

**The Zenodo record**

[https://zenodo.org/records/24136677](https://zenodo.org/records/24136677)

**The PDF on Zenodo**

[reported-not-measured-v2.pdf](https://zenodo.org/records/24136677/files/reported-not-measured-v2.pdf)

**DOI for this version**

[10.5281/zenodo.24136677](https://doi.org/10.5281/zenodo.24136677)

**DOI for all versions**

[10.5281/zenodo.23050795](https://doi.org/10.5281/zenodo.23050795)

**Licence**

CC BY 4.0

## Data

**The paper's Appendices A.1 and A.3, with the A.4 statuses, as data**

[defects.csv](https://zenodo.org/records/24136677/files/defects.csv)

[defects.json](https://zenodo.org/records/24136677/files/defects.json)

## Cite

### Plain text

driftproofhq (2026). Reported, Not Measured: An Empirical Study of Measurement Defects in LLM and Agent Evaluation Tools. Version 2. Zenodo. https://doi.org/10.5281/zenodo.24136677

### BibTeX

```
@misc{driftproofhq2026reportedv2,
  author    = {{driftproofhq}},
  title     = {Reported, Not Measured: An Empirical Study of Measurement Defects in {LLM} and Agent Evaluation Tools},
  year      = {2026},
  month     = nov,
  version   = {2},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.24136677},
  url       = {https://doi.org/10.5281/zenodo.24136677},
  note      = {Preprint}
}
```

## Version 1

Version 1, 30 September 2026. Version 1 is not altered and stays at its own DOI. Version 2 adds Section 12 (what became of the first thirteen defects, a second audit window of thirteen further defects, a seventh kind, and the author's instrument and its measurements since version 1) and Appendices A.3, A.4 and F.

**DOI for version 1**

[10.5281/zenodo.23050796](https://doi.org/10.5281/zenodo.23050796)

**The PDF of version 1 on Zenodo**

[reported-not-measured-v1.pdf](https://zenodo.org/records/23050796/files/reported-not-measured-v1.pdf)
