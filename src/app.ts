import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { chatAdapter } from "./adapters/chat.js";
import { exaAdapter } from "./adapters/exa.js";
import { geminiAdapter } from "./adapters/gemini.js";
import { messagesAdapter } from "./adapters/messages.js";
import { responsesAdapter } from "./adapters/responses.js";
import type { Config } from "./config.js";
import { dashboardRoutes } from "./dashboard.js";
import { redactHeaders, type Dump } from "./debug.js";
import type { AskJev } from "./decide.js";
import { createEventLog, type EventLog } from "./events.js";
import { createDecisionHandler, createRouter } from "./router.js";
import { forward } from "./upstream.js";

export interface Deps {
  config: Config;
  askJev: AskJev;
  /** Upstream transport; defaults to global fetch. */
  fetch?: typeof fetch;
  log?: (entry: Record<string, unknown>) => void;
  /** What the dashboard shows; defaults to an empty in-memory log. */
  events?: EventLog;
  /** Opt-in wire dumps (see debug.ts); off by default. */
  dump?: Dump;
}

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function createApp({ config, askJev, fetch: fetchImpl = fetch, log: writeLog = () => {}, events = createEventLog(), dump }: Deps) {
  const app = new Hono();
  const routing = { enabled: config.routing };
  const advisorEnabled = { enabled: config.advisorEnabled };
  const log = (entry: Record<string, unknown>) => {
    writeLog(entry);
    events.record(entry);
  };
  const router = createRouter({
    config,
    askJev,
    fetch: fetchImpl,
    log,
    dump,
    routing,
    advisorEnabled,
  });

  // Answers before the key is checked, so that a launcher can find its gateway. A gateway that
  // has a key is one somebody else may reach: it says that it is up, and nothing about itself.
  app.get("/health", (c) =>
    c.json(config.routerApiKey
      ? { status: "ok" }
      : { status: "ok", pid: process.pid, upstream: config.upstreamBaseUrl, jev: config.jevProvider, advisor: advisorEnabled.enabled }),
  );

  app.use("*", async (c, next) => {
    if (!config.routerApiKey) return next();
    // A browser can't attach a header to a page it navigates to, so the dashboard — and only the
    // dashboard — may carry the key as `?key=`.
    const inQuery = c.req.path.startsWith("/dashboard") ? c.req.query("key") : undefined;
    const presented = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? inQuery ?? "";
    if (safeEqual(presented, config.routerApiKey)) return next();
    return c.json({ error: { message: "Invalid jev-advisor-gateway API key", type: "invalid_api_key" } }, 401);
  });

  /** Dry run: what would the router do with this body? Calls Jev, never upstream. */
  app.post("/router/decide", createDecisionHandler(config, askJev));

  app.route(
    "/dashboard",
    dashboardRoutes(
      config,
      events,
      { get: () => routing.enabled, set: (enabled) => void (routing.enabled = enabled) },
      config.client === "codex" || config.client === "claude"
        ? { get: () => advisorEnabled.enabled, set: (enabled) => void (advisorEnabled.enabled = enabled) }
        : undefined,
    ),
  );

  app.post("/v1/chat/completions", router.route(chatAdapter));
  app.post("/v1/responses", router.route(responsesAdapter));
  app.post("/v1/messages", router.route(messagesAdapter));
  app.post("/v1beta/models/*", router.route(geminiAdapter));
  app.post("/exa.api_server_pb.ApiServerService/GetChatMessage", router.route(exaAdapter));

  // Everything else (models, embeddings, …) is proxied untouched.
  app.all("/v1/*", async (c) => {
    const response = await forward(c.req.raw, config, fetchImpl);
    dump?.("other", { method: c.req.method, path: c.req.path, headers: redactHeaders(c.req.raw.headers), status: response.status });
    return response;
  });
  app.all("/v1beta/*", async (c) => {
    const response = await forward(c.req.raw, config, fetchImpl);
    dump?.("other", { method: c.req.method, path: c.req.path, headers: redactHeaders(c.req.raw.headers), status: response.status });
    return response;
  });

  // The rest of exa (seat management, model catalogue, analytics) is proxied opaque. Only exa:
  // any other unknown path stays a 404 here rather than reaching upstream with the client's key.
  app.all("/*", async (c) => {
    if (!c.req.path.startsWith("/exa.")) return c.notFound();
    const response = await forward(c.req.raw, config, fetchImpl);
    dump?.("other", { method: c.req.method, path: c.req.path, headers: redactHeaders(c.req.raw.headers), status: response.status });
    return response;
  });

  return app;
}
