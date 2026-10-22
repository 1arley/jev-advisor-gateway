#!/usr/bin/env node
// jev-opencode-advisor: run OpenCode through the gateway with the read-only advisor enabled.
import { opencodeAdvisor } from "./clients.mjs";
import { runLauncher } from "./launcher.mjs";

await runLauncher(opencodeAdvisor);
