#!/usr/bin/env node
// Jev tool routing with the user's existing Codex model selection and no Astra advisor.
import { codex } from "./clients.mjs";
import { runLauncher } from "./launcher.mjs";

await runLauncher(codex);
