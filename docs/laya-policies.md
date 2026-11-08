# Laya routing policy and calibration

Laya defaults to the `typed-decisions` checkpoint and `native` policy. The matching calibration
profile is bundled; `JEV_MODEL`, `JEV_LAYA_ROUTING_POLICY` and `JEV_LAYA_CALIBRATION` can override
those defaults. `legacy` remains available when set explicitly.

`native` maps choices to internal tool identifiers and lets the main model handle `direct_answer`.
`legacy` sends the tool names and descriptions directly. `noul_refined` adds a boolean verification
question, while `binary_choice` adds a two-option verification choice. The gateway passes through
weak, malformed, abstained or disagreeing answers.

`JEV_LAYA_MIN_CONFIDENCE` is the fallback threshold when no profile bucket matches. The profile
uses Laya `answer_confidence`, while `legacy` uses Jev-compatible `x_jev_confidence`; the values
are on different scales and should not share a fitted threshold. A profile is scoped to its
checkpoint and policy. It accepts `version: 1`, `source`, `checkpoint`, `policy`, and `buckets`.
Bucket keys are `default`, `2`, `3-5`, `6-10`, and `11+`; entries have a `threshold` from 0 to 1
and at least 20 calibration samples. A matching option-count bucket wins, then `default`, then
`JEV_LAYA_MIN_CONFIDENCE`.

The local Laya 0.4.22 service reported CPU inference and all three checkpoints loaded. The candidate
sweep used the full 32-scenario calibration split, all three checkpoints, both `legacy` and `native`
policies, and both tool orders:

| Checkpoint and policy        | Top-choice matches | Applied tool choices | Correct applied choices |
| ---------------------------- | ------------------ | -------------------- | ----------------------- |
| `english` / `legacy`         | 11/32              | 3/32                 | 3/3                     |
| `english` / `native`         | 21/32              | 14/32                | 11/14                   |
| `multilingual` / `legacy`    | 13/32              | 15/32                | 10/15                   |
| `multilingual` / `native`    | 16/32              | 10/32                | 7/10                    |
| `typed-decisions` / `legacy` | 19/32              | 3/32                 | 3/3                     |
| `typed-decisions` / `native` | 25/32              | 2/32                 | 2/2                     |

`typed-decisions/native` had the best top-choice match rate, but its default `0.7` confidence gate
applied only 2 of its 25 correct top choices. The bundled threshold `0.5118` was fit on that
candidate's 32 calibration cases at target smoothed error 0.1. On the separate 32-scenario test
split it applied 12 choices, 11 correct (91.7% precision), with 23/32 top-choice matches overall.
At the uncalibrated `0.7` threshold it applied 1/32. These are diagnostic synthetic results, not
general accuracy or semantic fidelity; the corpus has related scenario families and does not
establish production calibration.

To repeat calibration for another checkpoint or Laya release, compare candidates only on
`calibration`, fit the selected non-legacy policy, then validate once on the full held-out `test`
split. Record the server package and revision, checkpoint, corpus revision, date, and target error
in `source`. Promote a profile only when held-out precision and coverage meet the desired bar; do
not fit thresholds on `test`.

```bash
pnpm exec tsx scripts/laya-evaluate.mjs --split calibration --models typed-decisions --policies native \
  --fit-profile /tmp/laya-calibration.json --source "Laya 0.4.22; typed-decisions; corpus-v1; target-error-0.1"
pnpm exec tsx scripts/laya-evaluate.mjs --split test --models typed-decisions --policies native \
  --apply-profile /tmp/laya-calibration.json
```

Only a bucket with at least 20 calibration samples gets its own threshold; smaller buckets use the
global `default`. The minimum is a guard, not proof of statistical precision. All prompt text and
labels are synthetic.

`JEV_LAYA_SHADOW_POLICY` optionally runs a comparison against the local Laya server. Shadow mode
uses at most one call at a time by default; `JEV_LAYA_SHADOW_CONCURRENCY` can raise that to four.
Shadow results do not steer the main request. They consume local resources, and agreement is not
accuracy. Dashboard events contain only allowlisted metadata, never prompts or credentials.
