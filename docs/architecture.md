# Architecture

## Goal

Keep the session model on the session. The gateway asks [Jev](https://docs.typesafe.ai/introduction)
to route tool decisions and, when Jev sees uncertainty, a planning checkpoint or repeated failure,
consults a read-only advisor. The proxy never runs a command or edits a file: the main agent keeps
ownership of the tool calls and of the final answer.

The advisor is not tied to a provider. The same code path serves:

- `jev-codex-advisor` — GPT-6 Luna coding with a GPT advisor over the Responses API;
- `jev-claude-advisor` — Haiku coding with an Opus advisor over the Messages API.

Both use the client's own login and upstream; the gateway only adds a request in between.

## Per-request flow

```text
client (Codex profile / Claude Code)
  -> local gateway
       -> Jev: tool choice + session action (continue | stop | consult_advisor | pass)
       -> optional: advisor, read-only, no tools
  <- short advisor note appended to the main agent's request
  -> upstream (client's credential), tools and response from the main agent
```

1. The launcher pins the session model (via `--model` or a Codex profile) and the gateway preserves
   it on every session request.
2. The adapter decodes the request into the current event plus a compact session state
   (`src/adapters/responses.ts`, `src/adapters/messages.ts`, `src/adapters/chat.ts`).
3. Jev returns a typed tool selection (when tools are present) and a session action. The action is
   `pass` whenever confidence is low, the answer is conflicting or Jev fails.
4. A consult uses the client's upstream and credential with no tools and a bounded output. The reply
   is advice, risks and open questions; it is never appended as an assistant turn and never becomes
   the next chained response.
5. The gateway appends the note as delimited, untrusted context on the main agent's request. The main
   agent decides whether to use it and continues normally.
6. Streaming and the response pass through untouched. A Jev, advisor or state failure must never
   block the normal path (fail-open).

## Advisors

`src/advisor/advisor.ts` defines a small `Advisor<Req>` interface (`request`, `append`, `text`) with one
implementation per wire format, and `advisorFor(adapter)` picks the right one from the adapter the
gateway already routed to. The router therefore branches on adapter capability, not on the client name.

- **Responses (Codex):** the advisor request continues from the session's response id and the note is
  appended to the trailing user turn. Continuity comes from the in-memory session ledger
  (`src/advisor/session-state.ts`), which has a TTL and a byte ceiling and is never written to disk.
- **Messages (Claude):** Anthropic rejects two consecutive `user` turns, so the note is merged into
  the trailing user turn. Each request stands alone, so the advisor budget caps calls within a turn,
  not across the chat.

## Jev policy

- **Tool choice:** reuse the existing selector and its argument/confidence validation.
- **File choice:** Jev only chooses among candidate paths from the recent context; it is never asked
  to invent one.
- **Repetition or stop:** a repeated tool failure limits advice/repair to one attempt per recurring
  error. Jev may recommend stopping; non-idempotent actions are never retried by the proxy.
- **Consult:** considered before planning when the task clearly needs a plan, after a recurring error,
  or during a final check, with a minimum interval so the advisor is not called on every turn.

## Modules

- `src/router.ts` — owns the whole routed transaction: parse, decision, optional advisor consult,
  rewrite, optional Headroom pass, upstream forward and fail-open replay. `src/app.ts` registers
  routes, auth and the dashboard; the router holds the sequencing.
- `src/headroom.ts` — the optional tool-output compression, behind its own seam: eligibility,
  transport and metrics in one module (see decision-record.md).
- `src/adapters/*` — decode each wire format and inject the delimited note without changing the shape
  of the response.
- `src/decide.ts`, `src/questions.ts` — typed tool selection, combined with the session policy when
  tools are present.
- `src/advisor/policy.ts` — classifies step, recurring error, need for advice and
  `continue | stop | consult_advisor | pass`, including calls without tools.
- `src/advisor/session-state.ts` — in-memory ledger indexed by response id: TTL, memory ceiling, id
  cleanup, fail-open when history is lost.
- `src/advisor/advisor.ts` — builds the tool-less advisor request, applies timeout and output limits,
  parses and appends the note.
- `src/upstream.ts` — forwards with the client's authorized headers; credentials never reach logs.
- `src/dashboard.ts`, `src/dashboard.html` — monitoring and cost view.

No database, no transcript on disk, no queue, no worker, no extra dependency. One local process.

## Privacy and limits

- Jev receives a short, truncated state, never auth headers, environment values or unbounded raw tool
  output.
- The advisor note is untrusted input: delimited, and the main agent is told to treat it as a
  suggestion, not a system instruction.
- `codex-auto-review`, sub-agent bodies the gateway cannot interpret, and `x-jev-gateway: off` stay
  bypassed.
- The dashboard shows the effective model, the advice reason, confidence and latency — never prompts,
  paths or arguments. Costs are cache-aware and shown per model, separate from the session.

## Acceptance checks

- The main request and all continuations keep using the session model.
- The advisor is called only on configured triggers, never receives tools and never alters the main
  response chain.
- Jev can route, recommend advice, continue/stop or fail; a service failure falls back to the normal
  path.
- A recurring error does not trigger unbounded loops or repeat side-effecting tools.
- History never reaches disk or the dashboard; local state expires and respects its memory ceiling.
- Responses tests cover `previous_response_id`, streaming, compression, chain derivation, timeouts and
  fallback; Messages tests cover the advisor request shape, parsing and metering.
