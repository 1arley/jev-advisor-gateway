#!/usr/bin/env node
// jev-devin: run Devin CLI through a local jev-advisor-gateway. Nothing in ~/.config/devin is modified.
import { devin } from "./clients.mjs";
import { runLauncher } from "./launcher.mjs";

await runLauncher(devin);
