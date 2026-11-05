# Laya routing evaluation

The evaluator sends only the synthetic scenarios in `scripts/laya-evaluate-corpus.mjs` to a
loopback Laya endpoint. The corpus has 96 distinct English and Portuguese prompts, split evenly
into `dev`, `calibration` and `test` sets. Each set has 32 scenarios across seven action labels
and uses the same seven-tool roster. Tool order is tested twice; the reversed request is a paired
measurement, not an additional independent scenario.

Run a split against a local server:

```bash
pnpm exec tsx scripts/laya-evaluate.mjs --split dev
pnpm exec tsx scripts/laya-evaluate.mjs --split calibration --models english --policies native
pnpm exec tsx scripts/laya-evaluate.mjs --split test --format csv --output /tmp/laya-test.csv
```

`dev` is for iteration. Use `calibration` only to fit a confidence profile, and keep `test` held
out until choices are final. `--models` and `--policies` accept comma-separated lists; policies
are `legacy`, `native`, `noul_refined` and `binary_choice`. `--limit N` is a smoke run and sets
`limited: true` in JSON output. Do not report a limited run as a complete evaluation.

JSON and CSV report ratios with explicit numerators and denominators at overall, checkpoint,
policy, language, option-band, and combined checkpoint/policy/language/band scopes. Summaries
use only original-order requests; reversed orders contribute to order-stability pairs and
latency, not to scenario counts. A selected `no_tool_needed` with `reason: no_tool_needed` is a
suggestion passed to the model, not an applied decision. It is reported separately from applied
false direct answers. `abstention` counts only `low_confidence` and `jev_answers_disagree`; other
passthrough failures and their reason counts have a separate metric.

Confidence calibration uses binary correctness of the selected action, not a multiclass Brier
score. ECE uses ten fixed confidence bins. Brier and ECE are omitted when a group has fewer than
20 valid original-order confidence scores. Cross-policy disagreement reports paired scenarios
and a numerator/denominator; it does not count as additional corpus evidence. CSV contains metric,
disagreement, and scenario records. With a profile applied to `test`, its ECE/Brier values describe
held-out performance and do not change the profile. All prompt text and labels are synthetic.

Fit a profile from the full calibration split for one checkpoint and one non-legacy policy:

```bash
pnpm exec tsx scripts/laya-evaluate.mjs --split calibration --models english --policies native \
  --fit-profile /tmp/laya-calibration.json --source synthetic-corpus-v1
```

The profile uses original-order calibration scenarios only. For each distinct confidence value, tied cases
are accepted together; the selected threshold is the lowest value whose smoothed error rate
`(errors + 1) / (accepted + 1)` meets `--error-target` (default `0.1`). A bucket needs 20 valid
scenarios. The current calibration split has eight cases per option band, so it does not produce
thresholds; empty or insufficient buckets are reported instead of receiving fitted values.

Apply a previously created profile only to the complete held-out split:

```bash
pnpm exec tsx scripts/laya-evaluate.mjs --split test --models english --policies native \
  --apply-profile /tmp/laya-calibration.json
```

The evaluator requires the profile checkpoint and policy to match the requested run. It never
fits or adjusts thresholds from `test`; its report names the profile source, checkpoint and
policy. Many prompts are related short scenarios, and the corpus has not had independent
semantic review. It does not establish production accuracy or calibration. Keep the default
policy unchanged unless separate evidence justifies a change.

The corpus mostly has short single-turn prompts and related scenario families. It does not cover
multi-turn ambiguity or provide 20 independent samples per option band. Do not interpret its
diagnostic summaries as a reviewed calibration set.

A limited local smoke on 2026-11-05 ran four development scenarios (two per language), both tool
orders, four policies and the three installed checkpoints on CPU. The synthetic results are in
[`laya-smoke-2026-11-05.json`](laya-smoke-2026-11-05.json). For example, English/native applied
one correct and one incorrect choice in the English scenarios; the Multilingual/native English
scenarios both applied incorrect choices. These tiny, related examples do not support a ranking,
calibrated threshold, or a default-policy change. Latency reflects this particular local run.
