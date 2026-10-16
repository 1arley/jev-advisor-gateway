#!/usr/bin/env node
// jev-claude-advisor: run Claude Code through a local jev-advisor-gateway with the read-only advisor on.
import { claudeAdvisor } from "./clients.mjs";
import { runLauncher } from "./launcher.mjs";

await runLauncher(claudeAdvisor);
