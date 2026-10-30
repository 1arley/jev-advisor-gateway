# Changelog

## [0.12.0](https://github.com/1arley/jev-advisor-gateway/compare/v0.11.0...v0.12.0) (2026-10-30)


### Added

* add Gemini advisor support ([78b42cf](https://github.com/1arley/jev-advisor-gateway/commit/78b42cf13476ed38a87c22a06185175924a51424))

## [0.11.0](https://github.com/1arley/jev-advisor-gateway/compare/v0.10.1...v0.11.0) (2026-10-29)


### Added

* **advisor:** support external advisor provider (openai/anthropic) ([7973df7](https://github.com/1arley/jev-advisor-gateway/commit/7973df7104e30bc118b9b2d6a48eb06970555ae5))


### Maintenance

* add husky pre-commit hooks with lint-staged and prettier ([488205d](https://github.com/1arley/jev-advisor-gateway/commit/488205d3784611e772f3cc3be914f953a0945af3))
* **main:** release 0.10.1 ([9d8b097](https://github.com/1arley/jev-advisor-gateway/commit/9d8b097790edfea77b5057172709bfd510f1cd9e))
* **release:** add release identity validation and release PR CI ([f910f67](https://github.com/1arley/jev-advisor-gateway/commit/f910f67023a3c810a5e48386d7425cf6a85469c2))
* trigger release-please ([eb400b3](https://github.com/1arley/jev-advisor-gateway/commit/eb400b316cd76c430a7663263a515a9ffceb0142))
* update README overview to animated GIF and add pre-commit skill ([9637700](https://github.com/1arley/jev-advisor-gateway/commit/9637700bc2c6612ac4985a8ccf8ee51525d687cf))

## [0.10.1](https://github.com/1arley/jev-advisor-gateway/compare/v0.10.0...v0.10.1) (2026-10-29)


### chore

* release 0.10.1 ([8c092b1](https://github.com/1arley/jev-advisor-gateway/commit/8c092b10c2f48ff9321cefed5de68d6d5ba8fa1b))

## [0.10.0](https://github.com/1arley/jev-advisor-gateway/compare/v0.9.0...v0.10.0) (2026-10-23)


### Added

* OpenCode v2 support and advisor chat note ([bed2786](https://github.com/1arley/jev-advisor-gateway/commit/bed278623072b4e2da8b986d2fc96859231bbb9a))
* **opencode:** support OpenCode v2 through opencode.json ([ebcc279](https://github.com/1arley/jev-advisor-gateway/commit/ebcc279c528db830362e5ad9ffdcde3a2f8b225b))


### Fixed

* **dashboard:** scan the jev-codex and jev-opencode-advisor default ports ([a8a641e](https://github.com/1arley/jev-advisor-gateway/commit/a8a641eaa0115f6e158c7fe8d4d0efc52f4fea12))
* **opencode:** read v2 provider maps and notice shapes the install really sends ([8a98cec](https://github.com/1arley/jev-advisor-gateway/commit/8a98cec7db208e61b9f6855bbf76747fd8456b4d))
* **opencode:** speak the launcher's own name and leave the v1 quirk where it belongs ([259e0d9](https://github.com/1arley/jev-advisor-gateway/commit/259e0d9571938fec5313b449b3445f9b827aa6a3))

## [0.9.0](https://github.com/1arley/jev-advisor-gateway/compare/v0.8.0...v0.9.0) (2026-10-22)


### Added

* add OpenCode advisor launcher and Chat Completions advisor ([#4](https://github.com/1arley/jev-advisor-gateway/issues/4)) ([f3806d3](https://github.com/1arley/jev-advisor-gateway/commit/f3806d3753afbb04ff511c1f5ca338375297924f))
* stable failure reasons and routing accuracy on the dashboard ([dd9a8e5](https://github.com/1arley/jev-advisor-gateway/commit/dd9a8e55699c852ae4993a493eec152db706e3fa))

## [0.8.0](https://github.com/1arley/jev-advisor-gateway/compare/v0.7.0...v0.8.0) (2026-10-22)


### ⚠ BREAKING CHANGES

* package renamed, binary names changed, config env vars updated

### Added

* add Google Gemini adapter and jev-gemini launcher ([f6b38be](https://github.com/1arley/jev-advisor-gateway/commit/f6b38be7daa473171cdddcbe4a26b84804360feb))
* add Google Gemini adapter and jev-gemini launcher ([0a4f9d4](https://github.com/1arley/jev-advisor-gateway/commit/0a4f9d4afaac28f6d719dea775b22d906b82d844))
* add headroom compression feature and project rename ([2eea013](https://github.com/1arley/jev-advisor-gateway/commit/2eea01347b249ec653ca8bc9e94db150b609f32c))
* Ask for the Jev key on first run; reach Jev through OpenRouter or Vercel too ([54f3b60](https://github.com/1arley/jev-advisor-gateway/commit/54f3b600ff640e77f2805bc72dd9f0e909bc8cf3))
* **brew:** add Homebrew installation support for macOS and Linux ([68a2352](https://github.com/1arley/jev-advisor-gateway/commit/68a235273f35edc7eb7abef5a5cfe3571f0acf6e))
* **brew:** auto-bump tap formula on published releases ([c1642cb](https://github.com/1arley/jev-advisor-gateway/commit/c1642cb0e7ea3d98a5e0a8ff90085d5e0ad029b8))
* **dashboard:** meter advisor consults separately per model ([69540ed](https://github.com/1arley/jev-advisor-gateway/commit/69540ed21bb7656a63afda76fabc420ac27e92b6))
* give Claude Code an advisor and price Claude models ([e593f72](https://github.com/1arley/jev-advisor-gateway/commit/e593f725e19b9d6ae19596c6e0a36306b130a7e9))
* **headroom:** add opt-in Codex continuation compression ([8c85235](https://github.com/1arley/jev-advisor-gateway/commit/8c8523523104dbafd710f79cff2421112715f552))
* jev-devin routes Devin CLI tool calls through Jev ([#44](https://github.com/1arley/jev-advisor-gateway/issues/44)) ([8146287](https://github.com/1arley/jev-advisor-gateway/commit/81462870b4ab0484f0e48cc71ef5e937a874c570))
* **kilo:** add jev-kilo, a launcher for Kilo CLI ([#48](https://github.com/1arley/jev-advisor-gateway/issues/48)) ([2f35d22](https://github.com/1arley/jev-advisor-gateway/commit/2f35d229d6b71ca4dbbca8689c9e37f6a48281dd))
* **laya:** answer tool decisions from a local laya-serve instead of remote Jev ([2d03ee3](https://github.com/1arley/jev-advisor-gateway/commit/2d03ee34f9e8e15fb90fba25b0b3e743e9f39f60))
* **opencode:** add first-class stable support ([1156a68](https://github.com/1arley/jev-advisor-gateway/commit/1156a684f0ea2b9614f5ab1c5330e195f00a4e68))
* **opencode:** add stable launcher ([ada4b01](https://github.com/1arley/jev-advisor-gateway/commit/ada4b015ad2b81b28d4872b4a1f728d35ec1a883))
* reach Jev with an OpenCode Zen key ([#27](https://github.com/1arley/jev-advisor-gateway/issues/27)) ([a461f2e](https://github.com/1arley/jev-advisor-gateway/commit/a461f2e3f45bf5da9187a6dadc3aa698e630be03))
* rebrand to codex-jev-advisor with GPT-6 Astra advisor for Luna sessions ([635fb85](https://github.com/1arley/jev-advisor-gateway/commit/635fb856a801a448281e23bfdbceb94a273d64a6))
* route Jev to a local OpenJev endpoint with no remote key ([78815ed](https://github.com/1arley/jev-advisor-gateway/commit/78815ed9f74d1eb223ecd487c4543662a4ae7710))


### Fixed

* **brew:** detect untracked formula on first bump (R3-001) ([e2a0de6](https://github.com/1arley/jev-advisor-gateway/commit/e2a0de6af45c1088f8806cf7ef9337aa73c7113a))
* **claude:** never answer a thinking conversation by itself ([#39](https://github.com/1arley/jev-advisor-gateway/issues/39)) ([3080676](https://github.com/1arley/jev-advisor-gateway/commit/3080676ef6637f743267ed989b795f58f50e3785))
* **codex:** let Codex's automatic reviewer choose its own tools ([#56](https://github.com/1arley/jev-advisor-gateway/issues/56)) ([c2d4d2e](https://github.com/1arley/jev-advisor-gateway/commit/c2d4d2e0b4476907dfac64815480751ce75c2c29))
* **dashboard:** bill 1h cache writes and Haiku's long-context tier ([daab039](https://github.com/1arley/jev-advisor-gateway/commit/daab039e4b86c734b5354a98b0479d09338ba954))
* **dashboard:** probe unused peer ports less often, and allow ?peers=none ([f73ba83](https://github.com/1arley/jev-advisor-gateway/commit/f73ba83ec1a1b2f5f3360aa18ed1babf6b9e5ae3))
* honour JEV_DIRECT_CALLS=false for tools with no open arguments ([95e4897](https://github.com/1arley/jev-advisor-gateway/commit/95e4897aea289c31022e9633dff1bd9fef39a8ed))
* keep /health to "ok" once the gateway has a key ([ff0d308](https://github.com/1arley/jev-advisor-gateway/commit/ff0d308e5d03d285a56bf22a1a4b08c8c67768aa)), closes [#8](https://github.com/1arley/jev-advisor-gateway/issues/8)
* keep hostile tool names out of hints, and pass malformed requests through instead of failing ([b3e8bc0](https://github.com/1arley/jev-advisor-gateway/commit/b3e8bc0fc515067a85b6c9d4ec8d08d01afd82f5))
* keep tool names that are not a single inert token away from Jev and the LLM ([7c2ae51](https://github.com/1arley/jev-advisor-gateway/commit/7c2ae516380d4e1e6557a8455bb9e821ec164418)), closes [#8](https://github.com/1arley/jev-advisor-gateway/issues/8)
* **opencode:** say which agents bypass the gateway, and keep an inherited inline config ([ba44b9f](https://github.com/1arley/jev-advisor-gateway/commit/ba44b9f75e31bf8b1a31a8403b6a76fe231b1727))
* pass Codex subagent requests through instead of taking their tools away ([0274d84](https://github.com/1arley/jev-advisor-gateway/commit/0274d84a4f3a1b8b3bb8263d5fa9cbe064e5bf17))
* pass malformed requests through instead of answering 500 ([782ae79](https://github.com/1arley/jev-advisor-gateway/commit/782ae79beed4e59dbcce9f64f31e62f5b40e47ce)), closes [#8](https://github.com/1arley/jev-advisor-gateway/issues/8)
* pass requests through when a Jev error page cannot fit in a header ([f13bd46](https://github.com/1arley/jev-advisor-gateway/commit/f13bd461e23bfb099be52dedcf2033d4649c069b))
* route Chat Completions requests that also carry built-in tools ([864b412](https://github.com/1arley/jev-advisor-gateway/commit/864b41283dff0a5ae5884dc63455c41e94169863)), closes [#8](https://github.com/1arley/jev-advisor-gateway/issues/8)
* treat malformed Jev answers as passthrough instead of deciding on them ([022df50](https://github.com/1arley/jev-advisor-gateway/commit/022df50a6684e4e1d9931ab02d71df3115bfb685))

## [0.7.0](https://github.com/1arley/jev-advisor-gateway/compare/v0.6.0...v0.7.0) (2026-10-16)


### Added

* **dashboard:** meter advisor consults separately per model ([0c1a472](https://github.com/1arley/jev-advisor-gateway/commit/0c1a47238435bc7b39321fd0360c8439322951db))
* give Claude Code an advisor and price Claude models ([35bf08f](https://github.com/1arley/jev-advisor-gateway/commit/35bf08f11e7c5702b291e6c640ec0eee3f94d652))


### Fixed

* **dashboard:** bill 1h cache writes and Haiku's long-context tier ([4d4d812](https://github.com/1arley/jev-advisor-gateway/commit/4d4d812b04f892193a23f228780b345a167a77f6))

## [0.6.0](https://github.com/1arley/jev-codex-router/compare/v0.5.1...v0.6.0) (2026-10-12)


### ⚠ BREAKING CHANGES

* package renamed, binary names changed, config env vars updated

### Added

* rebrand to codex-jev-advisor with GPT-6 Astra advisor for Luna sessions ([669c993](https://github.com/1arley/jev-codex-router/commit/669c993cd630266153664ad35da6c50f98be2fab))

## [0.5.1](https://github.com/vinilana/jev-gateway/compare/v0.5.0...v0.5.1) (2026-10-06)


### Fixed

* **codex:** let Codex's automatic reviewer choose its own tools ([#56](https://github.com/vinilana/jev-gateway/issues/56)) ([204d6d5](https://github.com/vinilana/jev-gateway/commit/204d6d514fee8032242f0f16d0a0b975d5f81728))

## [0.5.0](https://github.com/vinilana/jev-gateway/compare/v0.4.3...v0.5.0) (2026-09-25)


### Added

* jev-devin routes Devin CLI tool calls through Jev ([#44](https://github.com/vinilana/jev-gateway/issues/44)) ([f23d1ca](https://github.com/vinilana/jev-gateway/commit/f23d1ca8853ac2a8b798caa941b38971b9bcfad4))
* **kilo:** add jev-kilo, a launcher for Kilo CLI ([#48](https://github.com/vinilana/jev-gateway/issues/48)) ([34f6de9](https://github.com/vinilana/jev-gateway/commit/34f6de9b38b4f32a50a0f65b262989ae1270405a))
* reach Jev with an OpenCode Zen key ([#27](https://github.com/vinilana/jev-gateway/issues/27)) ([aac48a9](https://github.com/vinilana/jev-gateway/commit/aac48a9150fc234369d670ecf881993053198fa1))


### Fixed

* **claude:** never answer a thinking conversation by itself ([#39](https://github.com/vinilana/jev-gateway/issues/39)) ([9ec3e0e](https://github.com/vinilana/jev-gateway/commit/9ec3e0e0988137712f42b88b7c2aa0c6ba2e4e9a))

## [0.4.3](https://github.com/vinilana/jev-gateway/compare/v0.4.2...v0.4.3) (2026-09-23)


### Fixed

* pass Codex subagent requests through instead of taking their tools away ([576d89f](https://github.com/vinilana/jev-gateway/commit/576d89f770b4e6397b389fdd1de46665d8fc5f98))
* pass requests through when a Jev error page cannot fit in a header ([0eab07b](https://github.com/vinilana/jev-gateway/commit/0eab07bdc70239c12b6cb71e3ff94cb9b8892915))

## [0.4.2](https://github.com/vinilana/jev-gateway/compare/v0.4.1...v0.4.2) (2026-09-23)


### Fixed

* **dashboard:** probe unused peer ports less often, and allow ?peers=none ([fbe327d](https://github.com/vinilana/jev-gateway/commit/fbe327d4b1cbf4c094074ab837c965ac358808f8))
* honour JEV_DIRECT_CALLS=false for tools with no open arguments ([aa5af35](https://github.com/vinilana/jev-gateway/commit/aa5af3580ff4c30282187cae9f07428c724cb098))
* **opencode:** say which agents bypass the gateway, and keep an inherited inline config ([384e7f4](https://github.com/vinilana/jev-gateway/commit/384e7f40779c7b12fe2f1625092364ece9abf483))

## [0.4.1](https://github.com/vinilana/jev-gateway/compare/v0.4.0...v0.4.1) (2026-09-20)


### Fixed

* keep /health to "ok" once the gateway has a key ([57651ff](https://github.com/vinilana/jev-gateway/commit/57651ff8e6d1d40fd0cacabb8941c6703c4a773d)), closes [#8](https://github.com/vinilana/jev-gateway/issues/8)
* keep hostile tool names out of hints, and pass malformed requests through instead of failing ([40fd608](https://github.com/vinilana/jev-gateway/commit/40fd60848915dc08e61305b3b1620ac0f035ccfb))
* keep tool names that are not a single inert token away from Jev and the LLM ([f306026](https://github.com/vinilana/jev-gateway/commit/f306026d74156a93f50a5fa9f2b035163a74956c)), closes [#8](https://github.com/vinilana/jev-gateway/issues/8)
* pass malformed requests through instead of answering 500 ([174d84a](https://github.com/vinilana/jev-gateway/commit/174d84a09cdbb0810409bfb59ac7b74c2a139147)), closes [#8](https://github.com/vinilana/jev-gateway/issues/8)
* route Chat Completions requests that also carry built-in tools ([f6fd00c](https://github.com/vinilana/jev-gateway/commit/f6fd00c95dc0e6a36bb2ba8b23dcd5aaecce9137)), closes [#8](https://github.com/vinilana/jev-gateway/issues/8)

## [0.4.0](https://github.com/vinilana/jev-gateway/compare/v0.3.1...v0.4.0) (2026-09-20)

### Added
- **First-run setup.** Every `jev-` launcher now asks where to reach Jev and for the key when none
  is configured, checks the key with one real call, and saves it to `~/.jev-gateway/.env`. No file
  to write by hand. `--setup` runs it again, `--status` shows which provider is in use, and without
  a terminal a launcher exits naming what is missing instead of waiting for input.
- **Jev through OpenRouter and Vercel AI Gateway**, next to TypeSafe's own API. Set
  `OPENROUTER_API_KEY` or `AI_GATEWAY_API_KEY`, or pick one in the setup. `JEV_PROVIDER` chooses
  when several keys are present.

### Changed
- The gateway calls Jev over plain HTTP for all three providers, so `@typesafe-ai/sdk` is no longer
  installed with the package. `TYPESAFE_BASE_URL` still redirects the TypeSafe provider, and
  `JEV_URL` replaces the endpoint of any provider.

## 0.3.1

First version published by the release workflow. It carries everything listed under 0.3.0, which
was tagged but never reached npm.

### Changed
- Releases are automatic: pushing a `vX.Y.Z` tag publishes to npm through trusted publishing
  (OIDC), with provenance and without tokens, then creates the GitHub release. See
  `docs/releasing.md`.
- Pull requests and pushes to `main` run the type check, the tests and the build in CI, on Node
  22.15 and 24.

### Fixed
- The Homebrew workflow checks for its token before anything else, instead of polling npm for half
  an hour and then failing when no tap is configured.

## 0.3.0

### Added
- **OpenCode support.** `jev-opencode` runs stable OpenCode (v1) through a gateway on port 8791,
  injecting a provider through `OPENCODE_CONFIG_CONTENT` so nothing in your OpenCode config is
  written. Checked against OpenCode 1.18.31. Thanks to @viniciosrab (#4).
- **Gemini API support.** The gateway routes `POST /v1beta/models/<model>:generateContent` and
  `:streamGenerateContent`, forcing a tool through `toolConfig.functionCallingConfig`, and
  `jev-gemini` points the Gemini CLI at a gateway on port 8788. For clients that use a Gemini API
  key. Unit-tested, not yet run against the real API. Thanks to @andrecodexvictor (#5).
- **Homebrew release automation.** A workflow that updates a formula in `vinilana/homebrew-tap`
  after each release. It does nothing until the tap and its token exist; see
  `docs/homebrew-tap.md`. Thanks to @viniciosrab (#2).
- Token metering understands Gemini's `usageMetadata`, streamed or not.

### Fixed
- The proxy dropped the leading `/v1` from any path that started with it, so `/v1beta/...` was
  forwarded as `beta/...`. Only the `/v1` segment is dropped now.

## 0.2.2

### Changed
- How each agent is pointed at a gateway now lives in `bin/clients.mjs`, and `bin/launcher.mjs`
  exports what is needed to start a gateway process. The
  [benchmark](https://github.com/vinilana/jev-gateway-bench) uses both, so it drives agents exactly
  the way `jev-codex` and `jev-claude` do. No change in behaviour.

## 0.2.1

### Fixed
- Token metering now works with Codex on a ChatGPT subscription. That backend streams its replies
  without a content-type header, so 0.2.0 read them as plain JSON and recorded no tokens at all.

## 0.2.0

### Added
- **Monitoring dashboard.** `jev-codex --dashboard` (or `jev-claude --dashboard`) opens a local page
  that shows whether each gateway is routing, passing traffic through, idle, or failing, and why.
  One page covers both gateways and updates live. It shows request metadata only, never prompts,
  tool arguments, or credentials.
- **Token metering.** Every forwarded request records what the provider says it cost: input tokens
  (and how many came from the prompt cache), output tokens (and how many were reasoning), and
  duration. Works for Chat Completions, the Responses API, and Anthropic Messages.
- **Baseline mode.** `--routing off` stops asking Jev but keeps metering, so the dashboard can show
  token use with and without Jev side by side. Also a button on the dashboard and `JEV_ROUTING=off`.
- `HOST` setting for the interface to listen on.

### Changed
- **The gateway now listens on `127.0.0.1` only.** 0.1.0 listened on every interface, which made a
  gateway that forwards your credentials reachable from the local network. Upgrade.
- Launcher flags lost their `jev-` prefix: `--dashboard`, `--routing`, `--status`, `--logs`,
  `--start`, `--stop`. The gateway's own help and config are `--gateway-help` and `--print-config`,
  because `--help` and `--config` belong to Codex and Claude Code. The old `--jev-*` spellings still
  work.
- Requests are logged when their reply ends instead of when it starts, since that is when token
  counts are known.
- Requires Node.js 22.15 or newer.
- README rewritten around getting started.

### Fixed
- `--stop` now stops whichever gateway answers on the port, including one started by an older
  version that recorded its pid elsewhere.

## 0.1.0

First release: tool selection routed to Jev for Chat Completions, the Responses API, and Anthropic
Messages, with the `jev-codex` and `jev-claude` launchers.
