# Graph Report - jev-advisor-gateway  (2026-10-16)

## Corpus Check
- 71 files · ~66,129 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 3, .example 1)

## Summary
- 626 nodes · 1385 edges · 25 communities (24 shown, 1 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5948c3d4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Architecture
- clients.mjs
- exa.ts
- createApp
- config.ts
- Contributing to jev-advisor-gateway
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
- Jev Advisor Gateway
- decide.ts
- launcher.mjs
- setup.test.ts
- launcher.test.ts
- mock-jev.mjs
- events.ts
- responses.ts
- app.ts

## God Nodes (most connected - your core abstractions)
1. `createApp()` - 41 edges
2. `concat()` - 27 edges
3. `fakeJev()` - 24 edges
4. `vitest` - 22 edges
5. `testConfig()` - 22 edges
6. `fakeUpstream()` - 20 edges
7. `field()` - 19 edges
8. `Jev Advisor Gateway` - 19 edges
9. `Adapter` - 17 edges
10. `utf8()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Adding a wire format` --references--> `Adapter`  [INFERRED]
  CONTRIBUTING.md → src/adapters/adapter.ts
- `Code` --references--> `Adapter`  [INFERRED]
  .agents/skills/jev-gateway-conventions/SKILL.md → src/adapters/adapter.ts
- `Invariants: never break these` --references--> `loadConfig()`  [INFERRED]
  .agents/skills/jev-gateway-conventions/SKILL.md → src/config.ts
- `Code` --references--> `Decision`  [INFERRED]
  .agents/skills/jev-gateway-conventions/SKILL.md → src/decide.ts
- `Where things live` --references--> `Decision`  [INFERRED]
  CONTRIBUTING.md → src/decide.ts

## Import Cycles
- None detected.

## Communities (25 total, 1 thin omitted)

### Community 0 - "Architecture"
Cohesion: 0.20
Nodes (8): Acceptance checks, Advisors, Architecture, Goal, Jev policy, Modules, Per-request flow, Privacy and limits

### Community 1 - "clients.mjs"
Cohesion: 0.15
Nodes (15): claude, codexProvider(), codexSpec(), codexUpstream(), isObject(), keepStrings(), kiloInlineConfig(), kiloModel() (+7 more)

### Community 2 - "exa.ts"
Cohesion: 0.10
Nodes (48): apply(), byField(), directStream(), encode(), envelope(), exaAdapter, ExaRequest, fieldOf() (+40 more)

### Community 4 - "createApp"
Cohesion: 0.07
Nodes (45): Tests, vitest, createApp(), parseBody(), safeEqual(), NO_TOOL, Feed, lights (+37 more)

### Community 5 - "config.ts"
Cohesion: 0.09
Nodes (27): Before calling a change done, Code, Commits and pull request titles, Invariants: never break these, jev-gateway conventions, Prose: README, CHANGELOG, docs, pull requests, Releases, @hono/node-server (+19 more)

### Community 6 - "Contributing to jev-advisor-gateway"
Cohesion: 0.05
Nodes (35): Adding a client launcher, Adding a wire format, Code style, Commit messages and pull request titles, Contributing to jev-advisor-gateway, License, Pull requests, Releases (+27 more)

### Community 7 - "package.json"
Cohesion: 0.11
Nodes (17): author, bugs, url, description, engines, node, files, homepage (+9 more)

### Community 8 - "scripts"
Cohesion: 0.12
Nodes (16): scripts, build, claude, claude-advisor, codex, dev, devin, gemini (+8 more)

### Community 9 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, module, moduleResolution, noUncheckedIndexedAccess, outDir, resolveJsonModule, skipLibCheck (+4 more)

### Community 10 - "bin"
Cohesion: 0.20
Nodes (10): bin, codex-jev-advisor, jev-claude, jev-claude-advisor, jev-codex, jev-codex-advisor, jev-devin, jev-gemini (+2 more)

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
Nodes (33): 0.1.0, 0.2.0, 0.2.1, 0.2.2, 0.3.0, 0.3.1, [0.4.0](https://github.com/vinilana/jev-gateway/compare/v0.3.1...v0.4.0) (2026-09-20), [0.4.1](https://github.com/vinilana/jev-gateway/compare/v0.4.0...v0.4.1) (2026-09-20) (+25 more)

### Community 18 - "Jev Advisor Gateway"
Cohesion: 0.08
Nodes (25): Benchmark, Commands, Configuration, Credentials and upstream, Dashboard, Development, How it works, Is it worth it? Compare with a baseline (+17 more)

### Community 19 - "decide.ts"
Cohesion: 0.18
Nodes (22): @typesafe-ai/sdk, Answers, decide(), JevTrace, resolveArgs(), shortlist(), skipReason(), argKey() (+14 more)

### Community 20 - "launcher.mjs"
Cohesion: 0.13
Nodes (14): claudeAdvisor, codex, codexAdvisor, devin, gemini, kilo, opencode, ENV_FILES (+6 more)

### Community 21 - "setup.test.ts"
Cohesion: 0.21
Nodes (10): configuredProvider(), loadProviders(), present(), runSetup(), saveEnv(), upsertEnv(), validateKey(), resolved (+2 more)

### Community 23 - "launcher.test.ts"
Cohesion: 0.15
Nodes (9): claude, codex, codexAdvisor, devin, launcherBin, LauncherSpec, managedEnv, opencode (+1 more)

### Community 25 - "mock-jev.mjs"
Cohesion: 0.29
Nodes (5): answer(), ARG_CERTAINTY, CONFIDENCE, PORT, SCRIPT

### Community 27 - "events.ts"
Cohesion: 0.15
Nodes (13): hono, AdvisorSwitch, dashboardRoutes(), page, RoutingSwitch, createEventLog(), EventLog, number() (+5 more)

### Community 28 - "responses.ts"
Cohesion: 0.06
Nodes (57): Where things live, Adapter, sse(), directJson(), directStream(), ids(), toInput(), toTools() (+49 more)

### Community 29 - "app.ts"
Cohesion: 0.06
Nodes (56): chatAdapter, messagesAdapter, responsesAdapter, ResponsesRequest, AnyRequest, decisionHeaders(), DECODERS, Deps (+48 more)

## Knowledge Gaps
- **234 isolated node(s):** `ROOT`, `STATE_DIR`, `FROM_SOURCE`, `ENV_FILES`, `name` (+229 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 278 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Contributing to jev-advisor-gateway` connect `Contributing to jev-advisor-gateway` to `responses.ts`?**
  _High betweenness centrality (0.164) - this node is a cross-community bridge._
- **What connects `ROOT`, `STATE_DIR`, `FROM_SOURCE` to the rest of the system?**
  _234 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `exa.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0951048951048951 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `createApp` to `exa.ts`, `config.ts`, `package.json`, `setup.test.ts`, `launcher.test.ts`, `app.ts`?**
  _High betweenness centrality (0.159) - this node is a cross-community bridge._
- **Should `createApp` be split into smaller, more focused modules?**
  _Cohesion score 0.07412587412587412 - nodes in this community are weakly interconnected._
- **Why does `Where things live` connect `responses.ts` to `Contributing to jev-advisor-gateway`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Should `config.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0873015873015873 - nodes in this community are weakly interconnected._