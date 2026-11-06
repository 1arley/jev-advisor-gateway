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

Latest local verification: the structural validator reports 96 scenarios, 12 declared families,
and 32 scenarios per split. Structural validation does not prove semantic independence. On
2026-11-06, `pnpm typecheck`, `pnpm test` (425 tests), `pnpm build`, and `git diff --check`
passed. `pnpm laya:acceptance` ran 131 focused tests successfully and exited nonzero because the
items above remain open.

`node scripts/client-protocol-smoke.mjs both` exercised installed Codex and OpenCode with routing
active, a deterministic local System One and a synthetic upstream. Both forced the selected tool,
streamed two requests, and preserved tool-call identifiers and outputs. The installed Codex did
not send `previous_response_id`; a separate synthetic Responses protocol probe covered that field.
The real Laya server was not reachable at `127.0.0.1:8000` during this verification.
