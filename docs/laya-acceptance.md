# Laya acceptance checklist

A checked item means the local implementation and its automated checks exist; it is not a claim of
production accuracy. External validation is listed separately.

- [x] Legacy remains the default and remote Jev regression tests exist.
- [x] Native, noul_refined and binary_choice routing; HTTP and fallback tests.
- [x] Local-only shadow with bounded concurrent inference, no queue, and no effect on the main request.
- [x] At least 96 distinct, reviewed labeled scenarios covering both languages and all option bands.
- [x] Independent development, calibration and test splits.
- [x] Evaluation of every policy and checkpoint, JSON and CSV export, and complete comparative metrics.
- [x] Checkpoint- and policy-scoped calibration profile with validated option bands and fallback.
- [x] Server-provided checkpoint and truncation diagnostics, when supplied.
- [x] Dashboard includes the requested operational metrics and latest local evaluation metadata.
- [x] OpenCode and Codex protocol regression tests using synthetic transports.
- [x] Reproducible baseline smoke tests with the installed Codex and OpenCode clients and a synthetic upstream.
- [x] Typecheck, test suite, build, and git diff check passed.
- [x] Complete documentation and metrics for the requested evaluation dimensions.

External validation: real Laya answers do not establish statistical accuracy. Real clients must be
run separately in an isolated environment with synthetic upstreams; mocked protocol tests do not
prove that the installed client was exercised.

Latest local verification: the structural validator reports 96 scenarios, 12 declared families,
and 32 scenarios per split. On 2026-11-06, `pnpm typecheck`, `pnpm test` (438 tests), `pnpm build`,
`npm pack --dry-run` and `git diff --check` passed. The 96-scenario evaluation and all three loaded
Laya checkpoints completed with synthetic local services. These checks establish repository and
synthetic acceptance, not general model accuracy or real-conversation quality.

`node scripts/client-protocol-smoke.mjs both` exercised installed Codex and OpenCode with routing
active, a deterministic local System One and a synthetic upstream. Both forced the selected tool,
streamed two requests, and preserved tool-call identifiers and outputs. The installed Codex did
not send `previous_response_id`; a separate synthetic Responses protocol probe covered that field.
