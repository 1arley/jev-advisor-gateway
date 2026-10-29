# Client setup and compatibility

Use the launcher for your client. Launchers pass settings to that process and do not edit client
configuration files. They forward client arguments unchanged.

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

## Claude Code

`jev-claude` sets `ANTHROPIC_BASE_URL` only for the launched process, preserving Claude Code's saved
login. Extended thinking and cached prefixes prevent changing `tool_choice`, so the gateway adds a
hint after the client's last block. The model can ignore that hint; it does not guarantee lower
cost or latency.

## OpenCode

The launcher supports OpenCode v1.18.31 and v2.1.2. v1 receives a provider through
`OPENCODE_CONFIG_CONTENT`; the launcher preserves existing JSON object settings and does not write
configuration files. v2 does not accept provider configuration from the environment, so run
`jev-opencode --print-config` and add the printed provider block to `~/.config/opencode/opencode.json`
or a project `opencode.json`.

Only requests using the `jev-gateway/<model>` provider reach the gateway. Agents that specify a
different provider/model and sessions started with `-m` for another provider bypass it. Use
`jev-opencode --status` to see configured bypasses. The launcher checks OpenCode's merged config at
startup; set `JEV_OPENCODE_CHECK=off` to skip that check.

The advisor launcher uses the configured OpenAI-compatible upstream. `JEV_OPENCODE_MODEL` selects
the model exposed through the gateway; `JEV_OPENCODE_UPSTREAM_BASE_URL` selects its upstream.

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
`JEV_PROVIDER=laya`. Install and run `laya-serve` separately. The gateway warms it at startup so a
checkpoint load does not consume the first request's deadline. Laya has a shorter context window
than Jev and has only been measured on a six-question synthetic sample. See the benchmark notes in
the [README](../README.md#laya-checkpoint-comparison).

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
