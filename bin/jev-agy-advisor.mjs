#!/usr/bin/env node
// jev-agy-advisor: run Antigravity CLI through the gateway with the read-only advisor enabled.
import { agyAdvisor } from "./clients.mjs";
import { runLauncher } from "./launcher.mjs";

await runLauncher(agyAdvisor);
