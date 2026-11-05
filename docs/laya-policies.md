# Experimental Laya policies

`JEV_LAYA_ROUTING_POLICY=legacy` remains the default. `native` uses one choice with internal
identifiers and lets the main model handle `direct_answer`. `noul_refined` adds a boolean question
with neutral labels and explicit true and false criteria. Its `noul` is the probability of true.
`binary_choice` instead adds a two-option choice. Both questions are sent in one Laya request.
The gateway passes through when either answer is weak, malformed, abstains, or disagrees.
These policies remain experimental: one successful inference does not measure correctness.

`JEV_LAYA_SHADOW_POLICY` optionally names a candidate to observe with a local Laya server. The default limit is one shadow call at a time, with no queue;
`JEV_LAYA_SHADOW_CONCURRENCY` can raise the limit to at most four. It does not steer the main request. Shadow inference
uses resources and its recorded agreement is not accuracy. The dashboard shows only allowlisted
metadata, not prompts or credentials.

`JEV_LAYA_MIN_CONFIDENCE` defaults to the experimental value 0.7, not a calibrated guarantee.
`JEV_LAYA_CALIBRATION` accepts a JSON profile with `version: 1`, a nonempty `source`, a
`checkpoint`, a `policy`, and `buckets`. The bucket keys are `2`, `3-5`, `6-10`, and `11+`;
each entry has a `threshold` in [0,1] and an integer `samples` of at least 20 independent
labeled scenarios. The profile applies only to the matching checkpoint and policy; an absent
bucket uses `JEV_LAYA_MIN_CONFIDENCE`. The separate binary verification keeps the global
threshold: a tool-choice calibration does not calibrate a different question.

Fit using a calibration split, then assess the profile on a separate held-out split. A bucket with
insufficient data should be omitted. The minimum count is a guard, not evidence of statistical
precision. Laya's `fit_abstention_thresholds` uses the calibrated answer-confidence scale,
evaluates ties together and can add a pseudo-error; it also warns that omitted buckets need an
explicit safe fallback. A fitted profile must describe the data and method in `source` and must not
be presented as a production guarantee.

The server may report its effective checkpoint and truncation in routing and usage diagnostics.
The dashboard reports them when available; the requested checkpoint is not proof of the checkpoint
actually used. No automatic checkpoint selection is performed by this gateway.
