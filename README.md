# Jev Advisor Gateway

[![npm version](https://img.shields.io/npm/v/jev-advisor-gateway)](https://www.npmjs.com/package/jev-advisor-gateway)
[![CI](https://github.com/1arley/jev-advisor-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/1arley/jev-advisor-gateway/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A local gateway that lets Jev choose a coding agent's next tool. The session model handles
open-ended arguments and writes the final answer. When Jev is uncertain or a session reaches a
planning checkpoint, an optional read-only advisor can add a note for the agent to consider.

[![14-second overview](media/overview.gif)](media/jev-advisor-gateway-overview.mp4)

The gateway supports Codex, Claude Code, OpenCode, Kilo, Gemini CLI and Devin. It is an independent
project, not affiliated with or endorsed by TypeSafe. “Jev” is TypeSafe's model; this gateway calls
its public API or a compatible provider.

## Quick start

Requirements: Node.js 22.15 or newer, a configured Jev provider and a supported coding agent.
Hosted Jev providers require an API key; local endpoints do not require a hosted Jev key. Laya can
require a local bearer key if its server is configured to use one.

```bash
npm install -g jev-advisor-gateway
jev-codex-advisor --yolo
```

Use the matching launcher for your client:

| Launcher               | Client      | Default behavior                                    |
| ---------------------- | ----------- | --------------------------------------------------- |
| `jev-codex-advisor`    | Codex       | GPT-6 Luna session with Jev and a GPT advisor       |
| `jev-codex`            | Codex       | Your Codex default model with Jev; no advisor       |
| `jev-claude-advisor`   | Claude Code | Haiku session with Jev and an Opus advisor          |
| `jev-claude`           | Claude Code | Your existing Claude model with Jev; no advisor     |
| `jev-opencode-advisor` | OpenCode    | OpenAI-compatible model with Jev and an advisor     |
| `jev-opencode`         | OpenCode    | Your configured OpenCode model with Jev; no advisor |
| `jev-kilo`             | Kilo CLI    | Kilo Gateway model with Jev                         |
| `jev-gemini`           | Gemini CLI  | Gemini API-key traffic with Jev                     |
| `jev-devin`            | Devin CLI   | Devin traffic with Jev                              |

`jev-codex-advisor` also has the alias `codex-jev-advisor`. Launchers pass their settings to that
process only: they do not edit your Codex, Claude, OpenCode or other client configuration. Use the
launcher like the client command; its arguments are forwarded.

On first run, choose where Jev runs. For a hosted provider, enter its key; the launcher checks it
with one real request and saves it in `~/.jev-gateway/.env`, readable only by your account. Local
providers need their own service setup, and OpenJev's model backend may have separate credentials.
Codex and Claude reuse their saved logins. OpenCode uses its configured upstream credential, and
Gemini requires a Gemini API key. Kilo's gateway provider uses Kilo Gateway credentials. See
[client compatibility](docs/client-compatibility.md).

## What happens to a request

```text
coding agent → loopback gateway → Jev selects a tool or passes
             ← session model answers, calls tools and owns the result
```

Jev handles supported requests that include tools. It selects one tool and can fill closed-set
arguments such as enums and booleans. The session model fills open-ended arguments and writes the
answer. If confidence is low, Jev fails, or the request is unsupported, the gateway normally
forwards it unchanged. A selected tool can be enforced, suggested as a hint, or answered directly
when its arguments are fully determined. Direct answers are disabled for Codex to preserve its
Responses history.

The advisor is optional. On selected turns it receives a read-only request without tools and adds
a bounded note to the main agent's context. The main agent decides whether to use the note; the
advisor cannot call tools or change the response chain.

By default, the advisor uses the configured upstream. Setting `JEV_ADVISOR_PROVIDER` opts into a
separate OpenAI-compatible or Anthropic endpoint with its own model and key. The external advisor
receives at most six recent text messages, up to 4,000 characters each; tool results and media are
excluded. This can incur provider charges. See [client compatibility](docs/client-compatibility.md)
for setup and privacy details.

The gateway listens on `127.0.0.1` by default. Its default failure policy is fail-open: Jev,
advisor, parsing and optional compression failures leave the client request on its normal path.
Devin's Connect stream reports some upstream errors after HTTP 200, so a rejected hint cannot be
replayed; see [client compatibility](docs/client-compatibility.md).

## Dashboard and measuring your own work

```bash
jev-codex-advisor --dashboard
```

The dashboard at `http://localhost:8790/dashboard` shows request counts, routing decisions,
confidence, latency, reported token use, estimated cost, advisor calls and recent requests. It
shows request metadata only: no prompts, tool arguments, credentials or conversation text.

To compare routing with a baseline, do similar work in both modes:

```bash
jev-codex --routing off   # forward and meter without asking Jev
jev-codex --routing on    # route tool choices through Jev
```

The dashboard compares tokens, cache share, reasoning tokens and request time. It does not
attribute a difference to routing by itself; task, model, cache state and provider load also affect
the result. Accuracy counts whether the model's reply called the tool Jev selected.

## Benchmarks

The public [jev-gateway-bench](https://github.com/vinilana/jev-gateway-bench) runs real agents on the
same coding task with routing on and off, meters token usage and checks the result with a hidden
verifier. These are controlled benchmark runs, not a promise of savings on other tasks.

The series ran on 2026-09-18 and 19 with six models and two chess-engine tasks, for 120 session
attempts. One GPT-5.6 Luna bug-fix run was excluded after it accessed another run's workspace, so
that comparison uses four routed runs. The other cells use five runs per mode. Values below are
the change in median with routing, compared with the same model without routing;
negative values mean fewer tokens or less time.

| Model                   | Bug fix: output / input / time | Feature: output / input / time |
| ----------------------- | -----------------------------: | -----------------------------: |
| GPT-6 Astra (Codex)     |              −57% / −7% / −39% |                 0% / +2% / +8% |
| GPT-5.6 Sol (Codex)     |             −57% / −40% / −36% |              −9% / −39% / −16% |
| GPT-5.6 Luna (Codex)    |             −12% / −10% / +10% |             −14% / −51% / −14% |
| Fable 5.1 (Claude Code) |              −13% / −19% / +6% |             −24% / −27% / −26% |
| Opus 5 (Claude Code)    |               −7% / −22% / +2% |             +22% / +61% / +83% |
| Sonnet 5 (Claude Code)  |             −41% / −48% / −25% |              +9% / +16% / +37% |

Routing reduced median output tokens on the bug-fix task for all six models. Feature results varied:
it increased time for Astra, Opus 5 and Sonnet 5; Luna solved 3/5 routed runs versus 5/5 baseline
runs. Five runs per cell is a small sample. The benchmark repository has the raw runs, charts,
method and limitations.

A separate 20-run OpenCode series from 2026-09-23 reports 62% less output and 79% less time on the bug fix, and
29% less output and 31% less time on the feature. All runs passed the hidden checks. Its CLI Proxy
and Chat Completions setup differs from Claude Code's Anthropic Messages setup, so the two series
do not isolate the gateway as the cause.

### Laya checkpoint comparison

The local Laya checkpoint comparison on 2026-10-22 is smaller and synthetic: on six labeled
tool-routing questions, `typed-decisions` scored 3/6 and `multilingual` 2/6. `typed-decisions` took about 1,323 ms
versus 553 ms (2.4× slower), and its confidence stayed below the default routing threshold. The
default remains `multilingual`; the sample is too small to claim general accuracy. The reproducible
script is [`scripts/laya-checkpoints.mjs`](scripts/laya-checkpoints.mjs).

## Jev providers

Choose the provider that should receive Jev requests. This is separate from the LLM provider used
by your coding session.

| Provider          | `JEV_PROVIDER` | Key                        | Default model              |
| ----------------- | -------------- | -------------------------- | -------------------------- |
| TypeSafe          | `typesafe`     | `TYPESAFE_API_KEY`         | `jev-latest`               |
| OpenRouter        | `openrouter`   | `OPENROUTER_API_KEY`       | `typesafe/jev-1.13`        |
| Vercel AI Gateway | `vercel`       | `AI_GATEWAY_API_KEY`       | `typesafe-ai/jev`          |
| OpenCode Zen      | `opencode`     | `OPENCODE_API_KEY`         | `jev-1.13-free`            |
| OpenJev, local    | `openjev`      | none; placeholder accepted | configured by local server |
| Laya, local       | `laya`         | optional `LAYA_API_KEY`    | `multilingual`             |

Without an explicit `JEV_PROVIDER`, the launcher uses the first configured Jev key. OpenJev and
Laya can run the Jev endpoint locally. OpenJev may still send requests to its configured model
backend, so check that backend's privacy and billing terms. See [`.env.example`](.env.example) and
the [local Jev notes](docs/client-compatibility.md#local-jev-options).

## Client compatibility

| Client      | Status and caveat                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | Uses your existing login and Responses API. Direct tool answers are disabled to preserve upstream response history.                                                                      |
| Claude Code | Uses your existing login. Cached prefixes and extended thinking mean Jev adds a hint; the model still reasons about the tool.                                                            |
| OpenCode    | v1 gets a per-process provider. v2 requires a one-time config snippet because it does not accept provider configuration from the environment. Only the selected gateway model is routed. |
| Kilo        | Adds a gateway provider for Kilo Gateway; Kilo's own sign-in is not reused by that provider.                                                                                             |
| Gemini CLI  | The Gemini API-key path is supported. Google-account sign-in uses another service and bypasses this gateway.                                                                             |
| Devin       | Uses the Connect RPC path and hint mode. Stream errors returned inside HTTP 200 cannot be replayed by the gateway.                                                                       |

See [client setup and compatibility](docs/client-compatibility.md) for exact versions tested,
OpenCode v2 setup, routing boundaries, and provider details. A supported protocol does not mean
every CLI version or account mode has been tested against its live service.

## Install from a checkout

```bash
git clone https://github.com/1arley/jev-advisor-gateway
cd jev-advisor-gateway
pnpm install
pnpm build
npm link
```

Installing directly from the Git URL with `npm install -g github:1arley/jev-advisor-gateway` does
not build `dist/` and is not supported. The published npm package includes the built gateway and
all launchers; installing the upstream `jev-gateway` package alongside it is unnecessary.

## Run it as a server

For your own OpenAI-compatible client, use a checkout and configure Jev in `.env`:

```bash
pnpm install
cp .env.example .env   # add a Jev provider key
pnpm dev               # http://127.0.0.1:8787
```

Point the client at `http://127.0.0.1:8787/v1`. The gateway routes these endpoints and proxies
other paths unchanged:

| Endpoint                                                  | Protocol                                             |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `POST /v1/chat/completions`                               | OpenAI Chat Completions                              |
| `POST /v1/responses`                                      | OpenAI Responses                                     |
| `POST /v1/messages`                                       | Anthropic Messages                                   |
| `POST /v1beta/models/*`                                   | Gemini `generateContent` and `streamGenerateContent` |
| `POST /exa.api_server_pb.ApiServerService/GetChatMessage` | Devin Connect RPC                                    |

By default the client's Authorization header is forwarded to the LLM provider. `UPSTREAM_API_KEY`
lets the gateway hold that provider key; `ROUTER_API_KEY` then requires clients to authenticate.
Keep `HOST=127.0.0.1` unless remote access is necessary. To bypass Jev for a single request, send
`x-jev-gateway: off`.

To inspect a decision without forwarding a request to the session-model upstream, send a
representative request to `POST /router/decide`. The endpoint still asks Jev to decide. See
[the example](docs/client-compatibility.md#inspect-a-decision) and
[architecture overview](docs/architecture.md).

## Settings

The launchers read settings from the shell or `~/.jev-gateway/.env`; a checkout can use its own
`.env`. The complete, current list is in [`.env.example`](.env.example).

| Setting                  | Default                  | Purpose                                                                           |
| ------------------------ | ------------------------ | --------------------------------------------------------------------------------- |
| `JEV_PROVIDER`           | inferred from key        | Jev provider: `typesafe`, `openrouter`, `vercel`, `opencode`, `openjev` or `laya` |
| `JEV_MIN_CONFIDENCE`     | `0.7`                    | Lower confidence passes the choice to the session model                           |
| `JEV_ARG_MIN_CERTAINTY`  | `0.8`                    | Minimum certainty for each closed-set argument in a direct answer                 |
| `JEV_ROUTING`            | `on`                     | Start in routing or baseline mode                                                 |
| `JEV_TIMEOUT_MS`         | `4000`                   | Jev request deadline                                                              |
| `JEV_ADVISOR`            | on for advisor launchers | Enable read-only advisor consultations                                            |
| `JEV_ADVISOR_MODEL`      | launcher-specific        | Model used for advisor replies                                                    |
| `JEV_ADVISOR_PROVIDER`   | unset                    | Opt into `openai-compatible` or `anthropic`; requires an explicit URL and model   |
| `JEV_ADVISOR_URL`        | unset                    | Separate advisor API base URL; HTTPS remotely, loopback only for HTTP             |
| `JEV_ADVISOR_API_KEY`    | unset                    | Separate advisor key; never reuses the main upstream credential                   |
| `JEV_ADVISOR_EFFORT`     | unset                    | `low`, `medium` or `high` for models documenting native effort support            |
| `JEV_ADVISOR_TIMEOUT_MS` | `30000`                  | Advisor request deadline                                                          |
| `ARGS_MODEL`             | unset                    | Optional model for open-ended tool arguments; not used for Codex                  |
| `JEV_ON_NONE`            | `force_none`             | Send `tool_choice: none` or pass the request through when Jev selects no tool     |
| `HOST`                   | `127.0.0.1`              | Bind address; configure `ROUTER_API_KEY` before exposing the gateway              |
| `JEV_DEBUG_DUMP_DIR`     | unset                    | Opt-in request dumps; includes full conversation bodies, so use with care         |

Launcher-specific ports, upstreams and model options are also listed in [`.env.example`](.env.example).

### Headroom compression

Headroom is off by default and applies only to eligible Codex continuations containing exactly one
textual tool result. Enabling `shadow` or `compress` sends that result to the explicitly configured
loopback `/v1/compress` service. In `shadow`, the upstream request is unchanged; `compress` applies
only a validated shorter response. Both modes fall back to the prepared request on error. The
pinned v0.41.0 service returned the gateway's complete JSON result unchanged, so no reduction was
observed for this use case. See [`decision-record.md`](decision-record.md) before enabling it;
synthetic tests do not prove semantic fidelity.

## Limits and privacy

- Jev adds a network call to supported tool requests; measured latency is commonly around half a
  second to a second, but depends on provider and load.
- Jev chooses one tool per turn. In `forced` mode, the session model can still call that tool more
  than once in parallel, but cannot mix different tools in that turn.
- `hint` asks the model to consider a tool; it does not force the choice or guarantee lower cost.
- Jev reads text, not images, and has a 32k-token context window. Long conversations are reduced
  to recent context; English is its strongest language.
- Your logs contain request metadata. Opt-in debug dumps contain conversation bodies. Neither
  should be shared without reviewing it first.
- A launcher gateway is local and has no gateway key by default. Other local processes can use it
  with credentials they provide, or make Jev requests on your configured Jev account. A standalone
  server can require `ROUTER_API_KEY`.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Tests use fake providers and synthetic requests; they require no keys or network. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for project structure and contribution guidance. Releases are
managed by release-please; merging its release pull request publishes the npm package. See
[`docs/releasing.md`](docs/releasing.md).

## Acknowledgements

This project began as a fork of [jev-gateway](https://github.com/vinilana/jev-gateway) by Vinicius
Lana, licensed under MIT. The advisor and dashboard cost view are additions in this project.

## License

[MIT](LICENSE)
