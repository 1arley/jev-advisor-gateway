#!/usr/bin/env node
// jev-codex-advisor: run Codex through a local Jev advisor gateway. Nothing in ~/.codex is modified.
import { codexAdvisor as codex } from "./clients.mjs";
import { runLauncher } from "./launcher.mjs";

await runLauncher(codex);
