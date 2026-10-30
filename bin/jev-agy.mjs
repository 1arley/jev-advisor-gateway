#!/usr/bin/env node
// jev-agy: run Antigravity CLI through a local jev-advisor-gateway.
import { agy } from "./clients.mjs";
import { runLauncher } from "./launcher.mjs";

await runLauncher(agy);
