import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDump } from "./debug.js";
import { createAskJev } from "./jev.js";
import { createEventLog } from "./events.js";

const config = loadConfig();
const askJev = createAskJev(config);

const app = createApp({
  config,
  askJev,
  dump: createDump(config.debugDumpDir),
  events: createEventLog({ historyFile: config.logFile }),
  log: (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry })),
});

// laya-serve loads its checkpoint on the first question, which costs seconds and would eat that
// first client turn's JEV_TIMEOUT_MS budget. Fire one cheap question at startup so the load
// happens before the client speaks; a failure (serve not up yet) is the usual fail-open case.
if (config.jevProvider === "laya") {
  void askJev({
    state: {},
    questions: { warmup: { type: "choice", instructions: "Which option fits a warm-up ping? Answer warm.", criteria: { warm: "Load the checkpoint." } } },
    model: config.jevModel,
  }).catch(() => {});
}

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, ({ port }) => {
  console.log(`jev-advisor-gateway listening on http://localhost:${port} → ${config.upstreamBaseUrl} (jev: ${config.jevModel} via ${config.jevProvider})`);
  console.log(`dashboard: http://localhost:${port}/dashboard`);
});
