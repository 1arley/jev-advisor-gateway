# Client setup and compatibility

Use the launcher for your client. Launchers pass settings to that process and do not edit client
configuration files. They forward client arguments unchanged.

## Offline protocol checks

Run the captured Codex Responses and OpenCode Chat Completions/Responses fixtures without API keys,
network access, or client configuration changes:

```bash
node_modules/.bin/vitest run test/responses.test.ts test/codex-advisor.test.ts test/opencode.test.ts test/opencode-config.test.ts test/launcher.test.ts
```

To exercise the installed clients against the gateway and a local synthetic upstream, run:

```bash
node scripts/client-protocol-smoke.mjs [codex|opencode|both]
```

The default runs both. The harness uses temporary `HOME`, `CODEX_HOME` and XDG directories, sends
only a synthetic prompt, and uses synthetic credentials. Routing is disabled, and the gateway
forwards to a fake server bound to loopback; no Jev or model provider is called. It verifies each
client prints `SMOKE_OK` and that the corresponding Responses or Chat Completions path reached the
fake server. It does not cover the user-facing launchers or Jev routing decisions.

The unit fixtures came from Codex 0.154 and OpenCode 1.18.31. They exercise recorded client request
shapes against fake upstream responses. The loopback harness exercises whichever client versions
are installed. Do not point a live client at a real provider for these checks: that can incur charges
and does not make the capture reproducible.

## External advisor providers

By default, the advisor uses the same upstream as the client. To send advisor context to a separate
service, set `JEV_ADVISOR_PROVIDER` to `openai-compatible` or `anthropic`, set
`JEV_ADVISOR_MODEL` to a model served there, and provide `JEV_ADVISOR_URL`. This explicit provider
selection opts into sending context to that endpoint. `JEV_ADVISOR_API_KEY` is separate from the
main upstream key; when unset, the gateway sends no advisor authorization header.

`JEV_ADVISOR_URL` is a base URL. The gateway appends `/chat/completions` for OpenAI-compatible
providers and `/messages` for Anthropic. Remote endpoints must use HTTPS. Plain HTTP is accepted
only on loopback, credentials and query strings in the URL are rejected, and redirects are not
followed.

The advisor receives at most the six latest text messages from the user and assistant, with at most
4,000 characters per message. System, developer, reasoning, tool-result and media blocks are not
sent. If the gateway cannot extract plain text safely, it skips the advisor and forwards the
original request. Advisor failures remain fail-open. Provider error bodies are not written to
request logs.

Set `JEV_ADVISOR_EFFORT=low`, `medium` or `high` only when the selected model documents native
support. The gateway maps the value to the API's effort field; when unset, it omits that field. A
provider rejection fails open without retry. There is no advisor spending ceiling; provider charges
depend on the selected model and usage. The existing per-session call limit still applies.

Example for a local environment file:

```bash
JEV_ADVISOR_PROVIDER=openai-compatible
JEV_ADVISOR_URL=https://api.groq.com/openai/v1
JEV_ADVISOR_API_KEY=your-advisor-key
JEV_ADVISOR_MODEL=your-groq-model-id
JEV_ADVISOR_EFFORT=low
```

## Codex

`jev-codex` uses the Responses API and your existing Codex login. The advisor variant pins a
GPT-6 Luna session model and can consult a GPT advisor. Direct tool answers are disabled because
Codex's upstream does not know synthetic response IDs; Jev can still force a tool or pass the
request through. If the upstream rejects a rewrite, the gateway retries the original request.

The gateway does not offer Codex's `wait` tool to Jev. Codex decides whether an `exec` cell is
still running; the remaining tools stay eligible for Jev's selection. Advisor consultations still
run on eligible turns.

## Claude Code

`jev-claude` sets `ANTHROPIC_BASE_URL` only for the launched process, preserving Claude Code's saved
login. `jev-claude-advisor` runs Claude Code with `--model claude-haiku-5-5` and enables the
read-only advisor. Set `JEV_ADVISOR_MODEL` to any model available through the selected upstream;
it no longer defaults to a launcher-forced Opus model. The coding model and advisor model are
independent. Extended thinking and cached prefixes prevent changing `tool_choice`, so the gateway
adds a hint after the client's last block. The model can ignore that hint; it does not guarantee
lower cost or latency.

## OpenCode

The launcher supports OpenCode v1.18.31 and v2.1.2. Set
`JEV_OPENCODE_UPSTREAM_BASE_URL` to the URL already used by an OpenAI-compatible provider in
`opencode.json`; the launcher backs up the file and repoints every matching provider to its local
gateway. It leaves model IDs, agents, and `--model` choices unchanged, so any model served by that
upstream continues through Jev. Providers using another URL remain direct.

The backup is `opencode.json.jev-gateway.bak` (or the equivalent beside the configured file). The
launcher restores only provider URLs it changed when `jev-opencode --stop` runs. Stop the active
OpenCode launcher before switching between `jev-opencode` and `jev-opencode-advisor`; both use the
same global config file but different gateway ports. On a later launcher start, a stale managed URL
is restored when its gateway is down. `jev-opencode --status` also restores a managed URL when its
gateway is down. A gateway failure during an active session can interrupt requests; the launcher
does not claim an automatic live fallback. Set `JEV_OPENCODE_CHECK=off` to skip the startup bypass
summary.

Add `--probe-upstream` to a launcher invocation to send one synthetic `chat/completions` request
for the selected model, with `max_tokens: 1`. For example, `jev-opencode --probe-upstream --model
9router/main` probes that model before starting OpenCode. The probe can incur a small charge; an
error is reported without preventing the session from starting. It sends no conversation text.

Use `~/.jev-gateway/.env.opencode` for OpenCode-only values such as
`JEV_OPENCODE_UPSTREAM_BASE_URL`; it overlays `~/.jev-gateway/.env`, while shell variables still
take precedence. The launcher modifies the global OpenCode config so plain OpenCode invocations
also use the active gateway. Project config can override the global provider and remain direct.
Providers with different upstream URLs are outside this single-upstream setup. A provider that
already points at a gateway URL is left unchanged, including a pre-existing `jev-gateway` provider;
select the provider whose configured URL matches `JEV_OPENCODE_UPSTREAM_BASE_URL` (for example,
`9router/main`) for transparent routing. A model using the pre-existing `jev-gateway` provider is
not migrated automatically and may still point to a stopped gateway. With a 9router upstream,
select `9router/main` and set the explorer agent to `9router/slm`; both use the gateway while the
provider is repointed, then return to the direct 9router URL after `--stop`. If a config file contains
JSONC comments, the launcher edits only the provider URL text and preserves comments, formatting,
and all other values.

## Kilo

`jev-kilo` adds a gateway provider through `KILO_CONFIG_CONTENT` and forwards to Kilo Gateway by
default. It does not reuse Kilo's saved sign-in. Without `KILO_API_KEY`, the upstream may provide
anonymous access to free models. Choose a model that honors forced tool calls and check the
dashboard; some free models tested ignored the forced choice. `jev-kilo --print-config` prints a
provider block for a manually managed `kilo.jsonc`.

## Gemini CLI

The supported path is Gemini CLI traffic authenticated with a Gemini API key. A CLI signed in with
a Google account uses another Google service and bypasses this gateway. The adapter has offline
tests; live Gemini API behavior has not been verified.

## Antigravity CLI

Install `agy` and set `GEMINI_API_KEY`, then run `jev-agy` or `jev-agy-advisor`. Both use
`GOOGLE_GEMINI_BASE_URL` for the launched process and preserve the model selected by Antigravity.
Without `--settings`, the launcher supplies `modelProvider: "gemini"`. Inline JSON settings are
merged with that provider. A settings file must already set `modelProvider` to `gemini`; the
launcher does not edit or copy it. Only one `--settings` option is accepted.

`jev-agy` starts with the advisor off; `jev-agy --advisor on` enables it. `jev-agy-advisor` starts
with it on. Both use a read-only Gemini advisor, defaulting to `gemini-3.1-pro-preview`; a
configured `JEV_ADVISOR_MODEL` overrides that default and must name a model available through the
Gemini API. The CLI/advisor path has
synthetic local transport tests, but live Gemini model access has not been verified.

## Devin CLI

The gateway supports Devin CLI 3000.11.3 over Connect RPC. Its wire format has no `tool_choice`, so
Jev adds a hint; a fully specified selection can be answered directly. The main request was tested
end to end, but stream errors returned inside HTTP 200 cannot be replayed. If an upstream rejects a
hint, disable routing with `JEV_ROUTING=off` or run Devin directly. Other CLI versions are not
verified.

## Local Jev options

OpenJev serves the `/v1/systemone` protocol locally. Its backend (for example, a local model server)
has its own provider and billing; `OPENJEV_KEY` is only a setup placeholder. See the
[OpenJev project](https://github.com/1arley/OpenJev).

[Laya](https://github.com/NandhaKishorM/laya) can serve the same protocol locally with
`JEV_PROVIDER=laya`. Install and run `laya-serve` separately. Its default state window is about
1,024 tokens; the gateway sends `max_len` (default `JEV_LAYA_MAX_LEN=2048`) so it reads the full
bounded request state. Laya uses its own `JEV_LAYA_MAX_STATE_CHARS=7000` and
`JEV_LAYA_MAX_MESSAGE_CHARS=1500` limits. Hosted providers keep the generic
`JEV_MAX_STATE_CHARS=60000` and `JEV_MAX_MESSAGE_CHARS=4000` limits; `--setup` switches these
limits with the selected provider. With Laya, `JEV_ON_NONE` defaults to `passthrough`, so a mistaken
no-tool choice does not stop the main model from selecting a tool. An explicit
`JEV_ON_NONE=force_none` still forces `tool_choice: none`; remove that override to use the Laya
default. Other Jev providers keep the `force_none` default. Laya has its own
`JEV_LAYA_TIMEOUT_MS=8000` deadline, independent
of `JEV_TIMEOUT_MS`; timeout and abort errors are not retried because another Laya request would
consume the same narrow deadline. Connection failures still get one retry. Increase the Laya window
only when the server has `LAYA_MAX_TOKEN_BUDGET >= JEV_LAYA_MAX_LEN`: larger windows can increase
latency, and exceeding `JEV_LAYA_TIMEOUT_MS` (8,000 ms by default) yields `jev_timeout` and
passthrough. Check `--logs` for
`jev.inputTokens` to vary and stay below `max_len`. Laya also rejects choice questions with more
than 100 options. The gateway handles large tool rosters by ranking them in groups and asking Laya
to choose from finalists; enum arguments above 100 values are left for the main model to fill.
Laya has only been measured on a six-question synthetic sample. See the benchmark notes in the
[README](../README.md#laya-checkpoint-comparison).

## Jiwo (optional local choice router)

Jiwo runs as a separate local service. The gateway does not install Python, download checkpoints,
or supervise Jiwo. Install and start it with the Jiwo project instructions, then configure:

```bash
JEV_PROVIDER=jiwo
JEV_URL=http://127.0.0.1:8765/v1/systemone
JEV_MODEL=jiwo-0.8b
```

Check the service before starting the gateway:

```bash
curl -fsS http://127.0.0.1:8765/health
```

The first integration supports only `choice` tool routing. The gateway sends bounded text-only state,
rejects invalid or partial responses, and fails open when Jiwo is unavailable or uncertain. `score` and
`noul` are not sent to Jiwo; the gateway derives the tool-needed signal conservatively. No prompts,
credentials, tool results or private responses are written to telemetry.

## Inspect a decision

For a standalone gateway, `POST /router/decide` accepts a Chat Completions-shaped request and
returns Jev's decision without forwarding a request to the session-model upstream. The endpoint
still asks Jev. Example:

```bash
curl -s http://127.0.0.1:8787/router/decide \
  -H 'content-type: application/json' \
  -d '{
    "model":"gpt-5",
    "messages":[{"role":"user","content":"turn the kitchen lights on"}],
    "tools":[{"type":"function","function":{"name":"set_lights","description":"Set a room light","parameters":{"type":"object","required":["room","on"],"properties":{"room":{"type":"string","enum":["kitchen","bedroom"]},"on":{"type":"boolean"}}}}}]
  }'
```

The example asks Jev to choose from synthetic tool data. Do not paste private conversations or
credentials into shared diagnostics.

### Local Laya shadow comparison

`JEV_LAYA_SHADOW_POLICY` compares a candidate routing policy while the configured active policy
continues to control requests. It requires Laya at a loopback URL and adds no remote model calls.
The default limit is one shadow evaluation at a time; excess evaluations are skipped without a queue. `JEV_LAYA_SHADOW_CONCURRENCY` accepts 1 to 4.
Client responses never wait for the candidate. Dashboard rows report its policy, choice, confidence,
latency and agreement with the active tool choice; agreement is not a measure of correctness.
Shadow failures leave active routing unchanged. These paths are tested with synthetic transports;
no live Laya checkpoint was validated.
