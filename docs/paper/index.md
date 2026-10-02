# Paper

Canonical: <https://driftproofhq.com/paper/>

Reported, Not Measured: An Empirical Study of Measurement Defects in LLM and Agent Evaluation Tools

driftproofhq
Version 1, 30 September 2026
Preprint, not peer reviewed

## Can an LLM evaluator report a score for something it did not measure?

Between [14](https://driftproofhq.com/paper/#abstract) and [26 September 2026](https://driftproofhq.com/paper/#abstract) the author read the scoring and gating code of seven open-source evaluation tools, chosen by the author's judgement rather than sampled (the agent-skills repository's eval harness and a reference gate script, NVIDIA SkillEvaluator, DSPy, LangSmith, DeepEval, Harbor and MLflow), reproduced thirteen defects, twelve of them offline, and filed each upstream with a public reproduction; twelve carried a proposed fix from the author, five are merged, one more is approved, and the rest were open on [30 September 2026](https://driftproofhq.com/paper/#abstract). In each case the tool returned a well-formed result that its evidence did not support.

The distinction the paper draws is between a noisy measurement, which statistics can qualify, and a well-formed number that was never a valid measurement, which statistics cannot repair. The evidence is a catalogue of mechanisms found where the author looked; it is a lower bound on what exists, not a prevalence estimate.

## Abstract

Evaluation tools for language-model applications and agent skills are used as gates: a score decides whether a skill ships, which demonstrations a prompt compiler keeps, or whether a model is promoted. This paper is an exploratory study of the software between evidence that has already been produced and the result an evaluation tool reports. Between 14 and 26 September 2026 the author read the scoring and gating code of seven open-source evaluation tools, chosen by the author's judgement rather than sampled (the agent-skills repository's eval harness and a reference gate script, NVIDIA SkillEvaluator, DSPy, LangSmith, DeepEval, Harbor and MLflow), reproduced thirteen defects, twelve of them offline, and filed each upstream with a public reproduction; twelve carried a proposed fix from the author, five are merged, one more is approved, and the rest were open on 30 September 2026. In each case the tool returned a well-formed result that its evidence did not support. The defects fall into six kinds, derived from the cases: absent evidence scored as a measurement, a result bound to the wrong unit, a proxy credited as the act, stale state read as current, a sign error in a threshold, and a check aimed at a target the artefact never claimed. The same taxonomy is applied to the author's own instrument, Driftproof, using only its public findings: a parser that turned a non-numeric judge reply into a score, a badge that verified generation text but not judge text, and six false passes closed in release 0.12.0. Four published measurements serve as illustrations, not as tests: a pass/fail check and a text-injection evaluation that read the same task differently under different treatments; one eval that returned pass eight times and fail twice at one commit; and two release-day comparisons in which most cells did not separate. From the cases the paper proposes nine record fields, each paired with the check that would read it, and maps each defect to the field and check that could have exposed it; the mapping is a design argument the paper has not yet tested. The distinction the paper draws is between a noisy measurement, which statistics can qualify, and a well-formed number that was never a valid measurement, which statistics cannot repair. The evidence is a catalogue of mechanisms found where the author looked; it is a lower bound on what exists, not a prevalence estimate.

## Read the paper

**The Zenodo record**

[https://zenodo.org/records/23050796](https://zenodo.org/records/23050796)

**The PDF on Zenodo**

[reported-not-measured-v1.pdf](https://zenodo.org/records/23050796/files/reported-not-measured-v1.pdf)

**DOI for this version**

[10.5281/zenodo.23050796](https://doi.org/10.5281/zenodo.23050796)

**DOI for all versions**

[10.5281/zenodo.23050795](https://doi.org/10.5281/zenodo.23050795)

**Licence**

CC BY 4.0

## Data

**The paper's Appendix A.1 as data**

[defects.csv](https://zenodo.org/records/23050796/files/defects.csv)

[defects.json](https://zenodo.org/records/23050796/files/defects.json)

## Cite

### Plain text

driftproofhq (2026). Reported, Not Measured: An Empirical Study of Measurement Defects in LLM and Agent Evaluation Tools. Version 1. Zenodo. https://doi.org/10.5281/zenodo.23050796

### BibTeX

```
@misc{driftproofhq2026reported,
  author    = {{driftproofhq}},
  title     = {Reported, Not Measured: An Empirical Study of Measurement Defects in {LLM} and Agent Evaluation Tools},
  year      = {2026},
  month     = sep,
  version   = {1},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.23050796},
  url       = {https://doi.org/10.5281/zenodo.23050796},
  note      = {Preprint}
}
```
