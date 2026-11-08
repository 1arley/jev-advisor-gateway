# Jev Advisor Gateway

[![npm version](https://img.shields.io/npm/v/jev-advisor-gateway)](https://www.npmjs.com/package/jev-advisor-gateway)
[![CI](https://github.com/1arley/jev-advisor-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/1arley/jev-advisor-gateway/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A local gateway that lets Jev choose a coding agent's next tool. The session model keeps control of
open-ended arguments and final answers. When Jev is uncertain, the request passes through unchanged.
An optional read-only advisor can add a bounded note for the agent to consider.

[![14-second overview](media/overview.gif)](media/jev-advisor-gateway-overview.mp4)

The gateway supports Codex, Claude Code, OpenCode, Kilo, Gemini CLI, Antigravity CLI and Devin. It
supports hosted Jev providers and local OpenJev, Laya and Jiwo services. It is an independent
project, not affiliated with or endorsed by TypeSafe.

## Quick start

Requirements: Node.js 22.15 or newer and a supported coding agent.

```bash
npm install -g jev-advisor-gateway
jev-codex-advisor --yolo
```

On first run, the launcher asks where to reach Jev. Hosted providers require a provider key. The
launcher verifies the key with one small request and saves it in `~/.jev-gateway/.env`, readable only
by the current account. Local providers need a separately installed service. The Jiwo setup check
uses `/health` and does not send a decision request.

Use the launcher that matches the client:

| Launcher               | Client          | Default behavior                                    |
| ---------------------- | --------------- | --------------------------------------------------- |
| `jev-codex-advisor`    | Codex           | GPT-6 Luna session with Jev and a GPT advisor       |
| `codex-jev-advisor`    | Codex           | Alias for `jev-codex-advisor`                       |
| `jev-codex`            | Codex           | Existing Codex model with Jev and no advisor        |
| `jev-claude-advisor`   | Claude Code     | Haiku session with Jev and a configurable advisor   |
| `jev-claude`           | Claude Code     | Existing Claude model with Jev and no advisor       |
| `jev-opencode-advisor` | OpenCode        | Configured model with Jev and a read-only advisor   |
| `jev-opencode`         | OpenCode        | Configured OpenCode model with Jev and no advisor   |
| `jev-kilo`             | Kilo CLI        | Kilo Gateway model through the gateway              |
| `jev-gemini`           | Gemini CLI      | Gemini API-key traffic through the gateway          |
| `jev-agy`              | Antigravity CLI | Selected Gemini model with Jev and no advisor       |
| `jev-agy-advisor`      | Antigravity CLI | Selected Gemini model with Jev and a Gemini advisor |
| `jev-devin`            | Devin CLI       | Devin traffic through the gateway                   |

Launcher arguments are forwarded to the client. Common gateway commands are:

```bash
jev-codex-advisor --setup        # choose or change the Jev provider
jev-codex-advisor --start        # start only the local gateway
jev-codex-advisor --status       # show health and upstream information
jev-codex-advisor --dashboard    # open the local dashboard
jev-codex-advisor --routing off  # baseline: forward without asking Jev
jev-codex-advisor --advisor off  # disable read-only advisor calls
jev-codex-advisor --logs         # follow routing decisions
jev-codex-advisor --stop         # stop the gateway
```

Use `--gateway-help` for launcher-specific help. `jev-opencode` and `jev-opencode-advisor` support
`--probe-upstream`, which sends one synthetic one-token request to the selected model and may incur a
small provider charge. `jev-kilo --print-config` prints a provider block for manual Kilo setup.
`jev-agy` accepts one `--settings` JSON object or a settings file that already declares
`modelProvider: "gemini"`.

## What happens to a request

```text
coding agent -> loopback gateway -> Jev selects a tool or passes
             <- session model answers, calls tools and owns the result
```

For supported requests containing tools, Jev selects one tool and can fill closed-set arguments such
as enums and booleans. The session model fills open-ended arguments and writes the final answer. A
selected tool can be enforced, suggested with a hint, or answered directly when all arguments are
safe to determine. Direct answers are disabled for Codex so its Responses history remains valid.
Codex's `wait` tool is kept out of Jev's choice list.

If Jev is slow, unavailable, uncertain or unable to parse a request, the gateway forwards the
prepared request unchanged. Optional advisor and Headroom failures also fail open. The gateway never
requires the decision service for the client request to succeed.

The advisor is read-only. On selected turns it receives at most six recent plain-text user and
assistant messages, up to 4,000 characters per message, and adds a bounded note. It receives no
system instructions, reasoning, tool results, media or credentials. The main agent decides whether
to use the note; the advisor cannot call tools or change the response chain.

By default, the advisor uses the client's upstream. Setting `JEV_ADVISOR_PROVIDER` opts into a
separate OpenAI-compatible or Anthropic endpoint with its own model and key. This can incur provider
charges. See [client compatibility](docs/client-compatibility.md) for provider and privacy details.

## Dashboard and decision preview

```bash
jev-codex-advisor --dashboard
```

The dashboard at `http://localhost:8790/dashboard` shows request counts, routing decisions,
confidence, latency, reported token use, estimated cost, advisor calls and recent request metadata.
It does not show prompts, tool arguments, credentials or conversation text.

A standalone gateway exposes a dry-run decision endpoint. It asks Jev but does not forward to the
session-model upstream:

```bash
curl -s http://127.0.0.1:8787/router/decide \
  -H 'content-type: application/json' \
  -d '{
    "model":"gpt-5",
    "messages":[{"role":"user","content":"turn the kitchen lights on"}],
    "tools":[{"type":"function","function":{"name":"set_lights","description":"Set a room light","parameters":{"type":"object"}}}]
  }'
```

Use synthetic data for diagnostics. Do not paste private conversations or credentials into shared
diagnostics.

## Local Jev providers

Choose the provider that receives decision requests. This is separate from the LLM provider used by
the coding session.

| Provider          | `JEV_PROVIDER` | Key                     | Default model       |
| ----------------- | -------------- | ----------------------- | ------------------- |
| TypeSafe          | `typesafe`     | `TYPESAFE_API_KEY`      | `jev-latest`        |
| OpenRouter        | `openrouter`   | `OPENROUTER_API_KEY`    | `typesafe/jev-1.13` |
| Vercel AI Gateway | `vercel`       | `AI_GATEWAY_API_KEY`    | `typesafe-ai/jev`   |
| OpenCode Zen      | `opencode`     | `OPENCODE_API_KEY`      | `jev-1.13-free`     |
| OpenJev, local    | `openjev`      | placeholder only        | local server model  |
| Laya, local       | `laya`         | optional `LAYA_API_KEY` | `multilingual`      |
| Jiwo, local       | `jiwo`         | none                    | `jiwo-0.8b`         |
| Kev, local        | `kev`          | optional `KEV_API_KEY`  | `kev-latest`        |

Without an explicit `JEV_PROVIDER`, the gateway chooses the first configured hosted provider key.
OpenJev and Laya can run the System One endpoint locally. OpenJev's backend may still call its own
provider, so check that backend's privacy and billing terms.
Kev is installed and run separately; the gateway supports only `choice`, `noul` and `score`
questions and fails open for other request shapes. See [local provider details](docs/client-compatibility.md#kev-optional-local-decision-model).

### Jiwo setup

Jiwo is an optional local choice router. Install it outside this repository with `uv`, keep it on
loopback, and supervise it separately. The gateway does not install Python, download checkpoints or
start Jiwo:

```bash
install_dir="$HOME/.local/share/jev/jiwo"
mkdir -p "$install_dir/tools" "$install_dir/bin"
UV_TOOL_DIR="$install_dir/tools" UV_TOOL_BIN_DIR="$install_dir/bin" \
  uv tool install --python 3.12 \
  --from 'git+https://github.com/jiwidi/jiwo.git@e64d36227e02a36c0ea1bc3ec669003eb5a30c29' jiwo
JIWO_CHECKPOINT=eljiwo/jiwo-0.8b \
JIWO_HOST=127.0.0.1 JIWO_PORT=8765 \
  "$install_dir/bin/jiwo" serve
curl -fsS http://127.0.0.1:8765/health
```

Pin the Git revision and keep the installation outside the checkout. For supervision, health checks,
rollback and the full benchmark command, use the [Jiwo production runbook](docs/jiwo-production.md).
The expected health response includes `status: "ok"` and `model: "jiwo-0.8b"`.

Run `jev-codex-advisor --setup`, select `Jiwo (local)`, and keep the default URL and model unless
Jiwo uses another loopback port. Equivalent environment settings are:

```bash
JEV_PROVIDER=jiwo
JEV_URL=http://127.0.0.1:8765/v1/systemone
JEV_MODEL=jiwo-0.8b
JEV_JIWO_MAX_STATE_CHARS=7000
```

The current Jiwo integration sends bounded text-only state and `choice` questions for tool routing.
It does not send credentials, media, raw request bodies or tool results. `score` and `noul` are not
sent to Jiwo; the gateway derives the tool-needed signal conservatively. Invalid, partial,
unavailable or low-confidence responses fail open to the normal session-model path.

A synthetic local-gateway calibration covered 32/32 decisions across weather, files, calendar and
code suites, including 24 explicit tool selections. This is a small synthetic calibration, not a
claim of general accuracy, semantic fidelity or live-provider behavior.

See the [local provider details](docs/client-compatibility.md#local-jev-options) for Laya, OpenJev
and Jiwo limits.

## Client compatibility

- **Codex:** `jev-codex` uses Responses and the existing Codex login. `jev-codex-advisor` pins GPT-6
  Luna and enables the read-only advisor. Direct tool answers are disabled for Responses history.
- **Claude Code:** `jev-claude` keeps the advisor off. `jev-claude-advisor` runs a Haiku coding
  session and enables a read-only advisor; set `JEV_ADVISOR_MODEL` to any model available through
  the selected upstream. The coding model (`--model`) and advisor model are independent. The
  launcher sets `ANTHROPIC_BASE_URL` only for the launched process and preserves the saved login.
  Cached prefixes and extended thinking use hint mode where required.
- **OpenCode:** the launcher can back up and temporarily repoint providers whose `baseURL` matches
  `JEV_OPENCODE_UPSTREAM_BASE_URL`; it restores changed values conditionally on stop. Other providers,
  project overrides and model IDs remain unchanged. Use `--probe-upstream` only when a probe charge is
  acceptable.
- **Kilo:** the launcher supplies a gateway provider through `KILO_CONFIG_CONTENT` and does not reuse
  Kilo's saved sign-in. `--print-config` prints a manual provider block.
- **Gemini CLI:** the API-key path is supported. Google-account sign-in uses another service and
  bypasses this gateway.
- **Antigravity CLI:** `jev-agy` and `jev-agy-advisor` use `GOOGLE_GEMINI_BASE_URL`, preserve the
  selected model and pass `modelProvider: "gemini"` without editing persistent client settings.
- **Devin:** Connect RPC uses hint mode because its wire format has no `tool_choice`. Stream errors
  returned inside HTTP 200 cannot be replayed.

See [client setup and compatibility](docs/client-compatibility.md) for exact versions, setup details,
wire-format limits and synthetic verification.

## Run as a server

For an OpenAI-compatible client, configure Jev in `.env` and run a checkout:

```bash
pnpm install
cp .env.example .env
pnpm dev                 # http://127.0.0.1:8787
```

Point the client at `http://127.0.0.1:8787/v1`. The gateway routes these known paths and proxies
other compatible paths unchanged:

| Endpoint                                                  | Protocol                                             |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `POST /v1/chat/completions`                               | OpenAI Chat Completions                              |
| `POST /v1/responses`                                      | OpenAI Responses                                     |
| `POST /v1/messages`                                       | Anthropic Messages                                   |
| `POST /v1beta/models/*`                                   | Gemini `generateContent` and `streamGenerateContent` |
| `POST /exa.api_server_pb.ApiServerService/GetChatMessage` | Devin Connect RPC                                    |

By default, the client's `Authorization` header is forwarded to the LLM provider. Set
`UPSTREAM_API_KEY` for the gateway-held upstream credential. If `ROUTER_API_KEY` is set, clients must
also authenticate to the gateway. Keep `HOST=127.0.0.1` unless remote access is necessary and an
access key is configured. Send `x-jev-gateway: off` to bypass Jev for one request.

## Settings

Launchers read settings from the shell or `~/.jev-gateway/.env`. A checkout can use its own `.env`.
The complete list, including launcher-specific settings, is in [`.env.example`](.env.example).

| Setting                             | Default           | Purpose                                                                                               |
| ----------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| `JEV_PROVIDER`                      | inferred from key | Decision provider: `typesafe`, `openrouter`, `vercel`, `opencode`, `openjev`, `laya`, `jiwo` or `kev` |
| `JEV_MODEL`                         | provider default  | Decision model/checkpoint                                                                             |
| `JEV_URL`                           | provider default  | Override decision endpoint; Laya, Jiwo and Kev must be loopback                                       |
| `KEV_API_KEY`                       | unset             | Optional bearer key for a local Kev service that requires one                                         |
| `JEV_MIN_CONFIDENCE`                | `0.7`             | Below this confidence, pass through to the session model                                              |
| `JEV_ARG_MIN_CERTAINTY`             | `0.8`             | Certainty required for closed-set direct arguments                                                    |
| `JEV_ROUTING`                       | `on`              | Start in routing or baseline metering mode                                                            |
| `JEV_TIMEOUT_MS`                    | `8000`            | Hosted decision deadline; Laya uses its own timeout                                                   |
| `JEV_JIWO_MAX_STATE_CHARS`          | `7000`            | Maximum sanitized state sent to Jiwo                                                                  |
| `JEV_JIWO_MIN_CONFIDENCE`           | `0.7`             | Below this Jiwo choice confidence, pass through to the session model                                  |
| `JEV_LAYA_ROUTING_POLICY`           | `legacy`          | Laya policy: `legacy`, `native`, `noul_refined` or `binary_choice`                                    |
| `JEV_LAYA_SHADOW_POLICY`            | unset             | Optional local Laya comparison policy                                                                 |
| `JEV_LAYA_SHADOW_CONCURRENCY`       | `1`               | Maximum concurrent Laya shadow calls, from 1 to 4                                                     |
| `JEV_LAYA_MIN_CONFIDENCE`           | `0.7`             | Laya native-policy threshold                                                                          |
| `JEV_LAYA_CALIBRATION`              | unset             | Laya confidence profile for a checkpoint and option-count bucket                                      |
| `JEV_LAYA_TIMEOUT_MS`               | `8000`            | Laya deadline                                                                                         |
| `JEV_LAYA_MAX_LEN`                  | `2048`            | `max_len` sent to Laya                                                                                |
| `JEV_ADVISOR`                       | launcher-specific | Enable read-only advisor consultations                                                                |
| `JEV_ADVISOR_MODEL`                 | launcher-specific | Advisor model                                                                                         |
| `JEV_ADVISOR_PROVIDER`              | unset             | Explicit `openai-compatible` or `anthropic` advisor provider                                          |
| `JEV_ADVISOR_URL`                   | unset             | Separate advisor base URL; HTTPS remotely, loopback HTTP only                                         |
| `JEV_ADVISOR_API_KEY`               | unset             | Separate advisor key; never reused upstream                                                           |
| `JEV_ADVISOR_EFFORT`                | unset             | `low`, `medium` or `high` when supported by the model                                                 |
| `JEV_ADVISOR_TIMEOUT_MS`            | `30000`           | Advisor deadline                                                                                      |
| `JEV_ADVISOR_MAX_OUTPUT_TOKENS`     | `700`             | Advisor response bound                                                                                |
| `JEV_ADVISOR_MAX_CALLS_PER_SESSION` | `6`               | Advisor call limit per session                                                                        |
| `ARGS_MODEL`                        | unset             | Optional model for open-ended tool arguments; not used for Codex                                      |
| `JEV_ON_NONE`                       | provider-specific | `force_none` or `passthrough` when Jev selects no tool                                                |
| `JEV_DIRECT_CALLS`                  | `true`            | Answer directly when all arguments are closed-set                                                     |
| `HOST`                              | `127.0.0.1`       | Bind address                                                                                          |
| `PORT`                              | `8787`            | Gateway port                                                                                          |
| `UPSTREAM_BASE_URL`                 | OpenAI API        | LLM upstream base URL                                                                                 |
| `UPSTREAM_API_KEY`                  | unset             | Replace the client credential upstream                                                                |
| `ROUTER_API_KEY`                    | unset             | Require a gateway credential; requires `UPSTREAM_API_KEY`                                             |
| `JEV_HEADROOM_MODE`                 | `off`             | Codex continuation compression: `off`, `shadow` or `compress`                                         |
| `JEV_HEADROOM_URL`                  | unset             | Explicit loopback `/v1/compress` endpoint                                                             |
| `JEV_HEADROOM_TIMEOUT_MS`           | `500`             | Headroom deadline                                                                                     |
| `JEV_DEBUG_DUMP_DIR`                | unset             | Opt-in dumps containing full request bodies; use with care                                            |

## Headroom compression

Headroom is off by default and applies only to eligible Codex Responses continuations containing one
new textual tool result. `shadow` sends the result to the configured loopback `/v1/compress` service
but leaves the upstream body unchanged. `compress` applies only a validated shorter response. Both
modes preserve the prepared body on timeout, error or invalid output. The pinned service returned the
complete JSON tool result unchanged in the gateway-shaped case, so no reduction was observed there.
Read [`decision-record.md`](decision-record.md) before enabling it. Synthetic structural tests do not
prove semantic fidelity.

## Benchmarks and evidence

The public [jev-gateway-bench](https://github.com/vinilana/jev-gateway-bench) compares real agents on
controlled coding tasks with routing on and off, meters token usage and checks hidden verifiers. Its
results are controlled observations, not a promise of savings on other tasks. Local decision services
are compared with the same 32-case synthetic corpus:

| Provider               |      Accuracy |   Mean |    p50 |    p95 | Errors |
| ---------------------- | ------------: | -----: | -----: | -----: | -----: |
| Jiwo `jiwo-0.8b`       |  32/32 (100%) | 661 ms | 655 ms | 739 ms |      0 |
| Laya `multilingual`    | 31/32 (96.9%) | 100 ms |  98 ms | 114 ms |      0 |
| Laya `english`         | 27/32 (84.4%) | 290 ms | 283 ms | 379 ms |      0 |
| Laya `typed-decisions` |  32/32 (100%) | 291 ms | 284 ms | 369 ms |      0 |

Measured on 2026-11-06 with 32 sequential warm requests per provider, CPU-local services and
synthetic weather, files, calendar and coding prompts. The multilingual error was a file-read
request classified as no-tool. This is a routing diagnostic, not general accuracy, semantic fidelity
or a latency SLO. Reproduce it with
[`pnpm jiwo:laya:benchmark`](docs/jiwo-production.md#synthetic-benchmark); pass
`--laya-models multilingual,english,typed-decisions` to compare all checkpoints exposed by
`laya-serve`. The complete Jiwo scope is declared in the [production runbook](docs/jiwo-production.md);
new Jiwo revisions still require the documented gates. Do not treat these results as a quality guarantee.

## Limits and privacy

- Jev adds a decision call to supported tool requests. Latency depends on the provider and local
  service load.
- Jev chooses one tool per turn. The session model can still call tools in parallel when the client
  requests that behavior.
- Hint mode asks the model to consider a tool; it does not guarantee the model will use it.
- The gateway sends bounded text to the configured decision and advisor services. It does not send
  client credentials to Jiwo, and does not send tool results or media to the advisor.
- Dashboard fields are allowlisted metadata. Prompts, conversation text, tool arguments and
  credentials are not written there.
- `JEV_DEBUG_DUMP_DIR` is an explicit exception: wire dumps contain full decoded request bodies and
  redacted headers. Keep it disabled unless those files are protected.
- Keep the gateway on loopback by default. If it must be reachable from another machine, configure
  `ROUTER_API_KEY` and `UPSTREAM_API_KEY`, and review the deployment boundary.

## Development and verification

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
```

Tests use fake transports, synthetic requests and no API keys or network. See
[`docs/client-compatibility.md`](docs/client-compatibility.md), [`decision-record.md`](decision-record.md)
and [`.env.example`](.env.example) for detailed constraints and configuration.

## Acknowledgements

This project began as a fork of [jev-gateway](https://github.com/vinilana/jev-gateway) by Vinicius
Lana, licensed under MIT. The advisor and dashboard cost view are additions in this project.

## License

[MIT](LICENSE)
