import { brotliDecompressSync, gunzipSync, inflateSync, zstdDecompressSync } from "node:zlib";
import type { Context } from "hono";
import type { Adapter } from "./adapters/adapter.js";
import { chatAdapter } from "./adapters/chat.js";
import { exaAdapter } from "./adapters/exa.js";
import { geminiAdapter } from "./adapters/gemini.js";
import { messagesAdapter } from "./adapters/messages.js";
import { responsesAdapter, type ResponsesRequest } from "./adapters/responses.js";
import { advisorFor, consultAdvisor } from "./advisor/advisor.js";
import { decideSessionAction } from "./advisor/policy.js";
import { addRecent, createSessionStore, type SessionState } from "./advisor/session-state.js";
import type { Config } from "./config.js";
import { redactHeaders, summarizeResponse, type Dump } from "./debug.js";
import { decide, type AskJev, type Decision } from "./decide.js";
import { compressToolOutput, type HeadroomMetric } from "./headroom.js";
import { forward } from "./upstream.js";
import { readReply } from "./usage.js";

type AnyRequest = { model?: string; stream?: boolean; tools?: unknown[] };

export interface RouterDeps {
  config: Config;
  askJev: AskJev;
  fetch: typeof fetch;
  log: (entry: Record<string, unknown>) => void;
  dump?: Dump;
  routing: { enabled: boolean };
  advisorEnabled: { enabled: boolean };
}

const DECODERS: Record<string, (data: Uint8Array) => Buffer> = {
  zstd: zstdDecompressSync,
  gzip: gunzipSync,
  br: brotliDecompressSync,
  deflate: inflateSync,
};

/** Parse a JSON body, undoing request compression (Codex sends zstd). Undefined if unreadable. */
function parseBody<Req>(bytes: Uint8Array, encoding: string | undefined): Req | undefined {
  try {
    const decoder = encoding ? DECODERS[encoding.trim().toLowerCase()] : undefined;
    if (encoding && !decoder) return undefined;
    const parsed: unknown = JSON.parse(Buffer.from(decoder ? decoder(bytes) : bytes).toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Req) : undefined;
  } catch {
    return undefined;
  }
}

// A reason can quote whatever Jev's provider answered, such as an HTML block page. Headers.set
// throws on line breaks and on characters beyond Latin-1, and it would throw after the request
// had reached the upstream, so the client got a 500 instead of the reply it paid for.
const headerSafe = (value: string) => value.replace(/[^\x20-\x7e]+/g, " ");

function decisionHeaders(decision: Decision): Record<string, string> {
  const headers: Record<string, string> = { "x-jev-gateway-mode": decision.mode };
  if (decision.mode === "passthrough") headers["x-jev-gateway-reason"] = headerSafe(decision.reason).slice(0, 120);
  if (decision.mode === "forced" || decision.mode === "direct" || decision.mode === "hint") {
    headers["x-jev-gateway-tool"] = decision.tool;
  }
  if (decision.jev) {
    headers["x-jev-gateway-confidence"] = decision.jev.confidence.toFixed(3);
    headers["x-jev-gateway-latency-ms"] = String(decision.jev.latencyMs);
  }
  return headers;
}

function createDecider(config: Config, askJev: AskJev) {
  return async function decideFor<Req extends AnyRequest>(adapter: Adapter<Req>, req: Req): Promise<{ decision: Decision; tools?: number }> {
    // Codex needs Jev on continuations for session policy; other Responses clients retain the
    // upstream's server-side history untouched, as the original gateway did.
    if (adapter === responsesAdapter && config.client !== "codex" && (req as ResponsesRequest).previous_response_id) {
      return { decision: { mode: "passthrough", reason: "previous_response_id" } };
    }
    let input: ReturnType<Adapter<Req>["toInput"]>;
    try {
      input = adapter.toInput(req, config.maxMessageChars);
    } catch {
      return { decision: { mode: "passthrough", reason: "unreadable_request" } };
    }
    if ("skip" in input) return { decision: { mode: "passthrough", reason: input.skip } };
    // Codex's internal reviewer must keep control of its own tool selection.
    if (req.model === "codex-auto-review") {
      return { decision: { mode: "passthrough", reason: "codex_auto_review" }, tools: input.tools.length };
    }
    try {
      return { decision: await decide(input, config, askJev), tools: input.tools.length };
    } catch {
      // Same rule as decide(): the reason reaches headers and logs, so it stays a stable code.
      return { decision: { mode: "passthrough", reason: "router_error" }, tools: input.tools.length };
    }
  };
}

export function createDecisionHandler(config: Config, askJev: AskJev) {
  const decideFor = createDecider(config, askJev);
  return async (c: Context) => {
    const req = parseBody<Record<string, unknown>>(new Uint8Array(await c.req.arrayBuffer()), undefined);
    if (!req) return c.json({ error: { message: "Body must be a JSON object", type: "invalid_request_error" } }, 400);
    const adapters = { chat: chatAdapter, responses: responsesAdapter, messages: messagesAdapter, gemini: geminiAdapter };
    const tools = Array.isArray(req.tools) ? (req.tools as Record<string, unknown>[]) : [];
    const guess = "contents" in req
      ? "gemini"
      : !("messages" in req)
        ? "responses"
        : "system" in req || tools.some((tool) => "input_schema" in tool)
          ? "messages"
          : "chat";
    const format = (c.req.query("format") ?? guess) as keyof typeof adapters;
    const adapter = (adapters[format] ?? adapters[guess]) as Adapter<AnyRequest>;
    return c.json((await decideFor(adapter, req)).decision);
  };
}

export function createRouter({ config, askJev, fetch: fetchImpl, log, dump, routing, advisorEnabled }: RouterDeps) {
  const sessions = createSessionStore();
  const decideFor = createDecider(config, askJev);

  const logWhenDone = (
    entry: Record<string, unknown>,
    response: Response,
    startedAt: number,
    onResponseId?: (id: string | undefined) => void,
  ) => {
    const copy = response.clone();
    void readReply(copy).then((reply) => {
      onResponseId?.(reply.responseId);
      log({
        ...entry,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        ...(reply.tool ? { actualTool: reply.tool } : {}),
        ...(reply.usage ? { usage: reply.usage } : {}),
      });
    }).catch(() => {}); // Background logging cannot change the response already forwarded.
  };

  const dumpResponse = (kind: string, response: Response, extra: Record<string, unknown> = {}) => {
    if (!dump) return;
    const failed = response.status >= 400;
    const copy = response.clone();
    void (async () => {
      let text = "";
      try {
        for await (const chunk of copy.body?.pipeThrough(new TextDecoderStream()) ?? []) text += chunk;
      } catch {}
      dump(failed ? kind : "response", {
        status: response.status,
        ...extra,
        ...(failed ? { body: text.slice(0, 20_000) } : summarizeResponse(text)),
      });
    })();
  };

  const route = <Req extends AnyRequest>(adapter: Adapter<Req>) => async (c: Context) => {
    const startedAt = performance.now();
    const time = new Date().toISOString();
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    // Unreadable bodies are not ours to judge: upstream produces its own error for them.
    const encoding = c.req.header("content-encoding");
    let req: Req | undefined;
    try {
      req = adapter.parse ? adapter.parse(bytes, encoding) : parseBody<Req>(bytes, encoding);
    } catch {
      req = undefined;
    }
    dump?.("request", {
      method: c.req.method,
      path: c.req.path,
      headers: redactHeaders(c.req.raw.headers),
      body: req ?? `[unparseable, ${bytes.length} bytes]`,
    });

    let decision: Decision;
    let tools: number | undefined;
    let session: SessionState | undefined;
    let sessionAction: Awaited<ReturnType<typeof decideSessionAction>> | undefined;
    // Undefined for wire formats the advisor cannot speak (exa): no consult, no policy.
    const advisorImpl = advisorFor(adapter);
    if (!req) decision = { mode: "passthrough", reason: encoding ? "unsupported_encoding" : "unparseable_body" };
    else if (c.req.header("x-jev-gateway") === "off") decision = { mode: "passthrough", reason: "disabled_by_header" };
    else if (!routing.enabled) decision = { mode: "passthrough", reason: "routing_disabled" };
    else {
      // The session policy needs a conversation the router can read. Codex continues one by
      // `previous_response_id`; Claude resends the whole conversation every turn, so its session
      // is per-request (the advisor budget then caps calls within a turn, not across the chat).
      if (advisorImpl && advisorEnabled.enabled && req.model !== "codex-auto-review") {
        try {
          const input = adapter.toInput(req, config.maxMessageChars);
          if (!("skip" in input)) {
            session = sessions.resume((req as ResponsesRequest).previous_response_id);
            addRecent(session, input);
            try {
              sessionAction = await decideSessionAction(input, session, config, askJev);
            } catch {
              sessionAction = undefined;
            }
          }
        } catch {
          // The session policy is advisory; tool routing and the original request can still proceed.
        }
      }
      ({ decision, tools } = await decideFor(adapter, req));
    }

    let bodyOverride: string | undefined;
    // Why the advisor did or did not answer, recorded on every request the advisor covers. The
    // route log carries the tool decision alone, and a consult that silently produced nothing is
    // then indistinguishable from a gateway that never asked: this is the only place it shows up.
    let advisor: Record<string, unknown> | undefined;
    if (advisorImpl && advisorEnabled.enabled) {
      advisor = { model: config.advisorModel, action: sessionAction?.action ?? "unknown", confidence: sessionAction?.confidence ?? 0, calls: session?.advisorCalls ?? 0 };
    }
    if (req && session && sessionAction && advisorImpl) {
      const uncertain = decision.mode === "passthrough" && ["low_confidence", "jev_answers_disagree"].includes(decision.reason);
      if (sessionAction.action === "stop" && (tools ?? 0) > 0) {
        decision = { mode: "none", confidence: sessionAction.confidence, jev: decision.jev };
      } else if (sessionAction.action === "consult_advisor" || uncertain) {
        if (!advisorEnabled.enabled || session.advisorCalls >= config.advisorMaxCallsPerSession) {
          advisor = { ...advisor, consulted: false, skipped: advisorEnabled.enabled ? "session_budget" : "advisor_off" };
        } else {
          const consult = await consultAdvisor(c.req.raw, req, config, session, fetchImpl, advisorImpl);
          const note = "note" in consult ? consult.note : undefined;
          advisor = {
            ...advisor,
            consulted: true,
            noteAdded: note !== undefined,
            ...("usage" in consult && consult.usage ? { usage: consult.usage } : {}),
            ...("reason" in consult ? { skipped: consult.reason, ...("status" in consult ? { advisorStatus: consult.status } : {}), ...("detail" in consult ? { detail: consult.detail } : {}) } : {}),
          };
          if (note) {
            req = advisorImpl.append(req, note);
            bodyOverride = JSON.stringify(req);
            session.lastAdvisorAt = Date.now();
            session.advisorCalls++;
          }
        }
      }
    }

    const url = new URL(c.req.url);
    const fromUrl = adapter.fromUrl?.(url) ?? {};
    const entry = { event: "route", time, path: c.req.path, model: req?.model ?? fromUrl.model, tools: tools ?? req?.tools?.length ?? 0, ...(advisor ? { advisor } : {}) };
    // Building an answer or a rewrite is the gateway's own work. If it breaks, the original
    // request still goes upstream: the router must never be the reason a request fails.
    const giveUp = (error: unknown): Decision => ({
      mode: "passthrough",
      // A stable code, because the reason reaches headers and logs (see decide()).
      reason: "router_error",
      jev: decision.jev,
    });

    if (req && decision.mode === "direct") {
      try {
        const call = { tool: decision.tool, args: decision.args, inputTokens: decision.jev?.inputTokens ?? 0 };
        const headers = decisionHeaders(decision);
        const streamed = (fromUrl.stream ?? req.stream) ? adapter.directStream(req, call, url) : undefined;
        const json = streamed === undefined ? adapter.directJson(req, call) : undefined;
        log({ ...entry, ...decision });
        if (streamed === undefined) return c.json(json, 200, headers);
        if (typeof streamed !== "string") return c.body(streamed.body, 200, { ...headers, "content-type": streamed.contentType });
        return c.body(streamed, 200, { ...headers, "content-type": "text/event-stream", "cache-control": "no-cache" });
      } catch (error) {
        decision = giveUp(error);
      }
    }

    let rewritten: Req | undefined;
    if (req && decision.mode !== "passthrough") {
      try {
        rewritten = adapter.apply(req, decision, config.argsModel);
      } catch (error) {
        decision = giveUp(error);
      }
    }

    let rewrittenBody: string | Uint8Array | undefined;
    if (rewritten && decision.mode !== "passthrough") {
      try {
        rewrittenBody = adapter.encode ? adapter.encode(rewritten) : JSON.stringify(rewritten);
      } catch (error) {
        decision = giveUp(error);
      }
    }

    let preparedBody: string | Uint8Array = rewrittenBody ?? (bodyOverride ?? bytes);
    let headroom: HeadroomMetric | undefined;
    const responsesInput = req && adapter === responsesAdapter ? (req as ResponsesRequest).input : undefined;
    const hasAgentMessage = Array.isArray(responsesInput) && responsesInput.some((item) => item?.type === "agent_message");
    if (
      req &&
      adapter === responsesAdapter &&
      config.headroomMode !== "off" &&
      routing.enabled &&
      c.req.header("x-jev-gateway") !== "off" &&
      req.model !== "codex-auto-review" &&
      !hasAgentMessage
    ) {
      const beforeHeadroom = preparedBody;
      try {
        const attempt = await compressToolOutput(req as ResponsesRequest, config, fetchImpl);
        headroom = attempt.metric;
        if (attempt.output !== undefined && attempt.inputIndex !== undefined && config.headroomMode === "compress") {
          const preparedReq = (rewritten ?? req) as ResponsesRequest;
          if (Array.isArray(preparedReq.input)) {
            preparedBody = JSON.stringify({
              ...preparedReq,
              input: preparedReq.input.map((item, index) =>
                index === attempt.inputIndex ? { ...item, output: attempt.output } : item,
              ),
            });
          }
        }
      } catch {
        preparedBody = beforeHeadroom;
        headroom = { mode: config.headroomMode, result: "error" };
      }
    }

    if (rewrittenBody !== undefined && rewritten && decision.mode !== "passthrough") {
      const response = await forward(c.req.raw, config, fetchImpl, { body: preparedBody, responseHeaders: decisionHeaders(decision) });
      const sent = { mode: decision.mode, model: rewritten.model, tool_choice: (rewritten as { tool_choice?: unknown }).tool_choice };
      dumpResponse("rejected", response, { sent });
      if (response.status !== 400 && response.status !== 422) {
        // Only the Responses format continues by response id: a Claude session is per-request, so
        // remembering it under the reply's own `msg_...` would fill the store with entries nothing reads.
        logWhenDone({ ...entry, ...decision, ...(headroom ? { headroom } : {}) }, response, startedAt,
          session && response.ok && adapter === responsesAdapter ? (id) => sessions.remember(id, session!) : undefined);
        return response;
      }
      // The upstream refused the rewritten request (some backends only accept tool_choice
      // "auto"): the router must never be the reason a request fails, so replay the original.
      await response.body?.cancel();
      decision = { mode: "passthrough", reason: `upstream_rejected_${decision.mode}`, jev: decision.jev };
      preparedBody = bodyOverride ?? bytes;
    }

    const response = await forward(c.req.raw, config, fetchImpl, {
      body: preparedBody,
      responseHeaders: decisionHeaders(decision),
    });
    logWhenDone({ ...entry, ...decision, ...(headroom ? { headroom } : {}) }, response, startedAt,
      session && response.ok && adapter === responsesAdapter ? (id) => sessions.remember(id, session!) : undefined);
    dumpResponse("upstream-error", response);
    return response;
  };


  return { route };
}
