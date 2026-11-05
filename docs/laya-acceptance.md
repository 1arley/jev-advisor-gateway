# Laya acceptance checklist

A checked item means the local implementation and its automated checks exist; it is not a claim of
production accuracy. External validation is listed separately.

- [x] Legacy remains the default and remote Jev regression tests exist.
- [x] Native, noul_refined and binary_choice routing; HTTP and fallback tests.
- [x] Local-only shadow with bounded concurrent inference, no queue, and no effect on the main request.
- [ ] At least 96 distinct, reviewed labeled scenarios covering both languages and all option bands.
- [ ] Independent development, calibration and test splits.
- [ ] Evaluation of every policy and checkpoint, JSON and CSV export, and complete comparative metrics.
- [x] Checkpoint- and policy-scoped calibration profile with validated option bands and fallback.
- [x] Server-provided checkpoint and truncation diagnostics, when supplied.
- [ ] Dashboard includes all requested operational metrics and latest local evaluation.
- [x] OpenCode and Codex protocol regression tests using synthetic transports.
- [x] Reproducible baseline smoke tests with the installed Codex and OpenCode clients and a synthetic upstream.
- [x] Typecheck, test suite, build, and git diff check passed.
- [ ] Complete documentation and metrics for all requested evaluation dimensions.

External validation: real Laya answers do not establish statistical accuracy. Real clients must be
run separately in an isolated environment with synthetic upstreams; mocked protocol tests do not
prove that the installed client was exercised.
