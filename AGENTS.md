# Instructions for agents

Read and follow `/home/iarley/.local/share/agents-setup/global-rules.md` and
`/home/iarley/.codex/RTK.md`. Project conventions live in
`.agents/skills/jev-advisor-gateway-conventions/SKILL.md`; read that skill before editing or
reviewing code, tests, configuration, workflows, or project documentation.

## Project map

- `src/app.ts` registers routes, auth, the dashboard and the opaque proxy; it owns no sequencing.
- `src/router.ts` is the deep module that owns one routed request end to end: parse, decision,
  advisor consult, rewrite, optional Headroom pass, forward, and fail-open replay.
- `src/adapters/` contains one wire-format adapter per API.
- `src/advisor/` holds the advisor implementation: request/append per wire format (`advisor.ts`),
  the session policy (`policy.ts`), and the in-memory session ledger (`session-state.ts`).
- `src/headroom.ts` holds the optional tool-output compression behind its own seam.
- `src/config.ts` is the only place under `src/` that reads environment variables.
- `src/upstream.ts` forwards requests and filters hop-by-hop headers.
- `test/` contains offline Vitest coverage; `test/helpers.ts` provides `fakeJev`, `fakeUpstream`,
  and `testConfig`; `test/router.test.ts` pins the router's ordering and fail-open invariants.
- `README.md` documents user-visible behavior; `.env.example` lists every environment setting.
- `decision-record.md` tracks the Headroom decision, implementation scope, and outstanding gates.

## Invariants

- Fail open: Jev, advisor, parsing, or optional compression failures must not make a client
  request fail. Preserve the body already prepared for upstream when an optional transform fails.
- Treat client credentials and conversation text as private. Do not add them to logs, dashboard
  events, metrics, or persistent files. Dashboard fields are explicitly allowlisted in
  `src/events.ts`.
- Keep the gateway bound to loopback by default. Never edit the user's Codex, Claude, OpenCode, or
  other client configuration; launchers pass per-process settings instead.
- Keep Responses history and cached prefixes stable. `previous_response_id` belongs to the
  provider's history; do not rewrite prior inputs or unrelated request fields.
- Keep external services injectable (`fetch`, `askJev`). Tests must use synthetic data, fake
  transports, and no API keys or network.
- List every new setting in both `src/config.ts`, `.env.example`, and the README configuration
  table.

## Headroom gate

Check `decision-record.md` before changing Headroom behavior. The feature must remain off by
default, use an explicitly configured loopback `/v1/compress` URL, and preserve the narrow
Codex continuation scope recorded there. Both `shadow` and `compress` send eligible tool output to
Headroom; shadow mode only avoids changing the body sent upstream. Do not send real conversation
content until the pinned service and privacy gates in the decision record are complete.

## Validation

Use the repository scripts for relevant changes:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For focused behavior, run the relevant file under `test/` first. Do not claim a live integration
was verified by mock-fetch tests.
