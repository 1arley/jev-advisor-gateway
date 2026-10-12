# Graph Report - codex-jev-advisor  (2026-10-08)

## Corpus Check
- 69 files · ~60,779 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .example 1)

## Summary
- 599 nodes · 1295 edges · 26 communities (24 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `37ff9829`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- responses.ts
- clients.mjs
- exa.ts
- app.ts
- createApp
- decide.ts
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
- events.ts
- launcher.mjs
- setup.test.ts
- Arquitetura: Codex + Luna + Astra + Jev
- launcher.test.ts
- jev-gateway conventions
- mock-jev.mjs

## God Nodes (most connected - your core abstractions)
1. `createApp()` - 39 edges
2. `concat()` - 27 edges
3. `fakeJev()` - 22 edges
4. `vitest` - 21 edges
5. `testConfig()` - 21 edges
6. `field()` - 19 edges
7. `fakeUpstream()` - 19 edges
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

## Communities (26 total, 2 thin omitted)

### Community 0 - "responses.ts"
Cohesion: 0.06
Nodes (58): Adding a wire format, Where things live, Adapter, sse(), directJson(), directStream(), ids(), toInput() (+50 more)

### Community 1 - "clients.mjs"
Cohesion: 0.13
Nodes (17): codexAdvisor, codexProvider(), codexSpec(), codexUpstream(), isObject(), keepStrings(), kilo, kiloInlineConfig() (+9 more)

### Community 2 - "exa.ts"
Cohesion: 0.09
Nodes (48): apply(), byField(), directStream(), encode(), envelope(), exaAdapter, ExaRequest, fieldOf() (+40 more)

### Community 3 - "app.ts"
Cohesion: 0.08
Nodes (34): chatAdapter, geminiAdapter, messagesAdapter, responsesAdapter, ResponsesRequest, AnyRequest, decisionHeaders(), DECODERS (+26 more)

### Community 4 - "createApp"
Cohesion: 0.08
Nodes (44): Tests, vitest, createApp(), AskJev, NO_TOOL, Feed, lights, setup() (+36 more)

### Community 5 - "decide.ts"
Cohesion: 0.07
Nodes (48): Invariants: never break these, @hono/node-server, @typesafe-ai/sdk, ACTIONS, decideSessionAction(), SessionAction, SessionDecision, Config (+40 more)

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

### Community 19 - "events.ts"
Cohesion: 0.15
Nodes (12): hono, AdvisorSwitch, dashboardRoutes(), page, RoutingSwitch, createEventLog(), EventLog, number() (+4 more)

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

### Community 24 - "jev-gateway conventions"
Cohesion: 0.29
Nodes (6): Before calling a change done, Code, Commits and pull request titles, jev-gateway conventions, Prose: README, CHANGELOG, docs, pull requests, Releases

### Community 25 - "mock-jev.mjs"
Cohesion: 0.29
Nodes (5): answer(), ARG_CERTAINTY, CONFIDENCE, PORT, SCRIPT

## Knowledge Gaps
- **228 isolated node(s):** `ROOT`, `STATE_DIR`, `FROM_SOURCE`, `ENV_FILES`, `name` (+223 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 271 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Contributing to jev-gateway` connect `Contributing to jev-gateway` to `responses.ts`?**
  _High betweenness centrality (0.167) - this node is a cross-community bridge._
- **What connects `ROOT`, `STATE_DIR`, `FROM_SOURCE` to the rest of the system?**
  _228 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `responses.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05894736842105263 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `createApp` to `exa.ts`, `app.ts`, `decide.ts`, `package.json`, `setup.test.ts`, `launcher.test.ts`?**
  _High betweenness centrality (0.149) - this node is a cross-community bridge._
- **Should `clients.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.13405797101449277 - nodes in this community are weakly interconnected._
- **Why does `Where things live` connect `responses.ts` to `Contributing to jev-gateway`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Should `exa.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09394205443371378 - nodes in this community are weakly interconnected._