# Graph Report - codex-jev-advisor  (2026-10-12)

## Corpus Check
- 69 files · ~62,447 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .example 1)

## Summary
- 601 nodes · 1310 edges · 30 communities (28 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c2c8865f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- messages.ts
- clients.mjs
- exa.ts
- app.ts
- createApp
- config.ts
- Contributing to jev-gateway
- package.json
- scripts
- compilerOptions
- bin
- tsconfig.build.json
- devDependencies
- dependencies
- repository
- release-please-config.json
- Changelog
- engines
- Codex Jev Advisor
- decide.ts
- launcher.mjs
- setup.test.ts
- Arquitetura: Codex + Luna + Astra + Jev
- launcher.test.ts
- gemini.ts
- mock-jev.mjs
- responses.ts
- events.ts
- policy.ts
- chat.ts

## God Nodes (most connected - your core abstractions)
1. `createApp()` - 40 edges
2. `concat()` - 27 edges
3. `fakeJev()` - 23 edges
4. `vitest` - 21 edges
5. `testConfig()` - 21 edges
6. `fakeUpstream()` - 20 edges
7. `field()` - 19 edges
8. `Codex Jev Advisor` - 19 edges
9. `utf8()` - 17 edges
10. `Adapter` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Code` --references--> `Adapter`  [INFERRED]
  .agents/skills/jev-gateway-conventions/SKILL.md → src/adapters/adapter.ts
- `Adding a wire format` --references--> `Adapter`  [INFERRED]
  CONTRIBUTING.md → src/adapters/adapter.ts
- `Invariants: never break these` --references--> `loadConfig()`  [INFERRED]
  .agents/skills/jev-gateway-conventions/SKILL.md → src/config.ts
- `Code` --references--> `Decision`  [INFERRED]
  .agents/skills/jev-gateway-conventions/SKILL.md → src/decide.ts
- `Where things live` --references--> `Decision`  [INFERRED]
  CONTRIBUTING.md → src/decide.ts

## Import Cycles
- None detected.

## Communities (30 total, 2 thin omitted)

### Community 0 - "messages.ts"
Cohesion: 0.12
Nodes (18): Adding a wire format, Where things live, Adapter, sse(), apply(), Block, build(), directJson() (+10 more)

### Community 1 - "clients.mjs"
Cohesion: 0.13
Nodes (17): codexAdvisor, codexProvider(), codexSpec(), codexUpstream(), isObject(), keepStrings(), kilo, kiloInlineConfig() (+9 more)

### Community 2 - "exa.ts"
Cohesion: 0.09
Nodes (48): apply(), byField(), directStream(), encode(), envelope(), exaAdapter, ExaRequest, fieldOf() (+40 more)

### Community 3 - "app.ts"
Cohesion: 0.10
Nodes (31): chatAdapter, messagesAdapter, AnyRequest, decisionHeaders(), DECODERS, headerSafe(), parseBody(), safeEqual() (+23 more)

### Community 4 - "createApp"
Cohesion: 0.08
Nodes (43): Tests, vitest, createApp(), NO_TOOL, Feed, lights, setup(), app() (+35 more)

### Community 5 - "config.ts"
Cohesion: 0.08
Nodes (28): Before calling a change done, Code, Commits and pull request titles, Invariants: never break these, jev-gateway conventions, Prose: README, CHANGELOG, docs, pull requests, Releases, @hono/node-server (+20 more)

### Community 6 - "Contributing to jev-gateway"
Cohesion: 0.06
Nodes (34): Adding a client launcher, Code style, Commit messages and pull request titles, Contributing to jev-gateway, License, Pull requests, Releases, Reporting bugs and security issues (+26 more)

### Community 7 - "package.json"
Cohesion: 0.12
Nodes (15): author, bugs, url, description, files, homepage, keywords, license (+7 more)

### Community 8 - "scripts"
Cohesion: 0.13
Nodes (15): scripts, build, claude, codex, dev, devin, gemini, jev-codex (+7 more)

### Community 9 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, module, moduleResolution, noUncheckedIndexedAccess, outDir, resolveJsonModule, skipLibCheck (+4 more)

### Community 10 - "bin"
Cohesion: 0.22
Nodes (9): bin, codex-jev-advisor, jev-claude, jev-codex, jev-codex-advisor, jev-devin, jev-gemini, jev-kilo (+1 more)

### Community 11 - "tsconfig.build.json"
Cohesion: 0.29
Nodes (6): ./tsconfig.json, compilerOptions, declaration, rootDir, extends, include

### Community 12 - "devDependencies"
Cohesion: 0.33
Nodes (6): devDependencies, tsx, @types/node, @typesafe-ai/sdk, typescript, vitest

### Community 13 - "dependencies"
Cohesion: 0.67
Nodes (3): dependencies, hono, @hono/node-server

### Community 14 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 16 - "Changelog"
Cohesion: 0.06
Nodes (30): 0.1.0, 0.2.0, 0.2.1, 0.2.2, 0.3.0, 0.3.1, [0.4.0](https://github.com/vinilana/jev-gateway/compare/v0.3.1...v0.4.0) (2026-09-20), [0.4.1](https://github.com/vinilana/jev-gateway/compare/v0.4.0...v0.4.1) (2026-09-20) (+22 more)

### Community 18 - "Codex Jev Advisor"
Cohesion: 0.08
Nodes (25): Benchmark, Codex Jev Advisor, Commands, Configuration, Credentials and upstream, Dashboard, Development, How it works (+17 more)

### Community 19 - "decide.ts"
Cohesion: 0.18
Nodes (22): @typesafe-ai/sdk, Answers, decide(), JevTrace, resolveArgs(), shortlist(), skipReason(), argKey() (+14 more)

### Community 20 - "launcher.mjs"
Cohesion: 0.16
Nodes (11): claude, codex, devin, gemini, ENV_FILES, FROM_SOURCE, loadEnv(), ROOT (+3 more)

### Community 21 - "setup.test.ts"
Cohesion: 0.21
Nodes (10): configuredProvider(), loadProviders(), present(), runSetup(), saveEnv(), upsertEnv(), validateKey(), resolved (+2 more)

### Community 22 - "Arquitetura: Codex + Luna + Astra + Jev"
Cohesion: 0.15
Nodes (12): Arquitetura: Codex + Luna + Astra + Jev, Contexto e continuidade, Fluxo proposto, Identidade do fork, Módulos mínimos, Objetivo, Política do Jev, Por solicitação (+4 more)

### Community 23 - "launcher.test.ts"
Cohesion: 0.17
Nodes (9): claude, codex, codexAdvisor, devin, launcherBin, LauncherSpec, managedEnv, opencode (+1 more)

### Community 24 - "gemini.ts"
Cohesion: 0.15
Nodes (12): directJson(), directStream(), geminiAdapter, GeminiContent, GeminiFunctionDeclaration, GeminiPart, GeminiRequest, GeminiTool (+4 more)

### Community 25 - "mock-jev.mjs"
Cohesion: 0.29
Nodes (5): answer(), ARG_CERTAINTY, CONFIDENCE, PORT, SCRIPT

### Community 26 - "responses.ts"
Cohesion: 0.22
Nodes (13): build(), declaredTools(), directJson(), directStream(), hex(), HOSTED_DESCRIPTIONS, InputItem, inputItems() (+5 more)

### Community 27 - "events.ts"
Cohesion: 0.15
Nodes (12): hono, AdvisorSwitch, dashboardRoutes(), page, RoutingSwitch, createEventLog(), EventLog, number() (+4 more)

### Community 28 - "policy.ts"
Cohesion: 0.28
Nodes (8): Deps, ACTIONS, decideSessionAction(), SessionAction, SessionDecision, Config, AskJev, buildState()

### Community 30 - "chat.ts"
Cohesion: 0.17
Nodes (17): directJson(), directStream(), ids(), toInput(), toTools(), usageOf(), toInput(), Limits (+9 more)

## Knowledge Gaps
- **229 isolated node(s):** `ROOT`, `STATE_DIR`, `FROM_SOURCE`, `ENV_FILES`, `name` (+224 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 272 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Contributing to jev-gateway` connect `Contributing to jev-gateway` to `messages.ts`?**
  _High betweenness centrality (0.166) - this node is a cross-community bridge._
- **What connects `ROOT`, `STATE_DIR`, `FROM_SOURCE` to the rest of the system?**
  _229 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `messages.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1225071225071225 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `createApp` to `exa.ts`, `app.ts`, `config.ts`, `package.json`, `setup.test.ts`, `launcher.test.ts`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Should `clients.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.13405797101449277 - nodes in this community are weakly interconnected._
- **Why does `Where things live` connect `messages.ts` to `Contributing to jev-gateway`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Should `exa.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09394205443371378 - nodes in this community are weakly interconnected._