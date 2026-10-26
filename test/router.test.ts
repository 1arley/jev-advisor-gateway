import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createApp } from "../src/app.js";
import { chatAdapter } from "../src/adapters/chat.js";
import { responsesAdapter } from "../src/adapters/responses.js";
import { createRouter } from "../src/router.js";
import { NO_TOOL, planTool } from "../src/questions.js";
import { buildState } from "../src/state.js";
import type { RouterInput, RouterTool } from "../src/types.js";
import { chat, fakeJev, fakeUpstream, settled, testConfig } from "./helpers.js";

const lightsAnswers = {
  tool: { choice: "set_lights" },
  needs_tool: { noul: 0.97 },
  "arg:1:room": { choice: "kitchen" },
  "arg:1:on": { noul: 0.98 },
  "arg:1:brightness": { choice: "50" },
  "stated:1:brightness": { noul: 0.04 },
};

function setup(canned: Parameters<typeof fakeJev>[0], config = testConfig()) {
  const jev = fakeJev(canned);
  const upstream = fakeUpstream();
  const app = createApp({ config, askJev: jev.askJev, fetch: upstream.fetchImpl });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer client-key", ...headers },
      body: JSON.stringify(body),
    });
  return { app, post, jev, upstream };
}

describe("router module", () => {
  it("decides before forwarding when its route is mounted directly", async () => {
    const order: string[] = [];
    const upstream = fakeUpstream();
    const jev = fakeJev(lightsAnswers);
    const instrumentedAdapter = {
      ...chatAdapter,
      apply: (req: Parameters<typeof chatAdapter.apply>[0], decision: Parameters<typeof chatAdapter.apply>[1], model?: string) => {
        order.push("prepare");
        return chatAdapter.apply(req, decision, model);
      },
      encode: (req: Parameters<typeof chatAdapter.apply>[0]) => {
        order.push("encode");
        return JSON.stringify(req);
      },
    };
    const router = createRouter({
      config: testConfig({ directCalls: false }),
      askJev: async (request) => {
        order.push("decision");
        return jev.askJev(request);
      },
      fetch: async (...args) => {
        order.push("forward");
        return upstream.fetchImpl(...args);
      },
      log: () => {},
      routing: { enabled: true },
      advisorEnabled: { enabled: false },
    });
    const app = new Hono();
    app.post("/chat", router.route(instrumentedAdapter));

    const response = await app.request("/chat", { method: "POST", body: JSON.stringify(chat("kitchen lights on")) });

    expect(response.status).toBe(200);
    expect(order.indexOf("decision")).toBeLessThan(order.indexOf("prepare"));
    expect(order.indexOf("prepare")).toBeLessThan(order.indexOf("encode"));
    expect(order.indexOf("encode")).toBeLessThan(order.indexOf("forward"));
  });

  it("decides before advisor, prepares after advisor, and forwards last", async () => {
    const order: string[] = [];
    const config = testConfig({ client: "claude", advisorEnabled: true, directCalls: false });
    const jev = fakeJev({ session_action: { choice: "consult_advisor" }, ...lightsAnswers });
    const router = createRouter({
      config,
      askJev: async (request) => {
        order.push(Object.keys(request.questions).includes("session_action") ? "session-policy" : "decision");
        return jev.askJev(request);
      },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.model === config.advisorModel) {
          order.push("advisor");
          return Response.json({ choices: [{ message: { content: "Check the next step." } }] });
        }
        order.push("forward");
        return Response.json({ choices: [] });
      },
      log: () => {},
      routing: { enabled: true },
      advisorEnabled: { enabled: true },
    });
    const app = new Hono();
    app.post("/chat", router.route(chatAdapter));
    const originalApply = chatAdapter.apply;
    const originalEncode = chatAdapter.encode;
    chatAdapter.apply = (req, decision, model) => {
      order.push("prepare");
      return originalApply(req, decision, model);
    };
    chatAdapter.encode = (req) => {
      order.push("encode");
      return JSON.stringify(req);
    };

    let response: Response;
    try {
      response = await app.request("/chat", { method: "POST", body: JSON.stringify(chat("kitchen lights on")) });
    } finally {
      chatAdapter.apply = originalApply;
      if (originalEncode) chatAdapter.encode = originalEncode;
      else delete chatAdapter.encode;
    }

    expect(response.status).toBe(200);
    expect(order).toEqual(expect.arrayContaining(["decision", "advisor", "prepare", "encode", "forward"]));
    expect(order.lastIndexOf("decision")).toBeLessThan(order.indexOf("advisor"));
    expect(order.indexOf("advisor")).toBeLessThan(order.indexOf("prepare"));
    expect(order.indexOf("prepare")).toBeLessThan(order.indexOf("encode"));
    expect(order.indexOf("encode")).toBeLessThan(order.indexOf("forward"));
  });

  it("calls Headroom after request preparation and preserves the body when it fails", async () => {
    const order: string[] = [];
    const url = "http://127.0.0.1:8788/v1/compress";
    const body = {
      model: "gpt-synthetic",
      previous_response_id: "resp_previous",
      input: [
        { type: "message", role: "user", content: "Inspect the synthetic output." },
        { type: "function_call_output", call_id: "call_synthetic", output: "synthetic output" },
      ],
      tools: [{ type: "function", name: "inspect", description: "Inspect output", parameters: { type: "object", properties: {} } }],
    };
    const jev = fakeJev({ tool: { choice: "inspect" }, needs_tool: { noul: 0.99 } });
    const router = createRouter({
      config: testConfig({ client: "codex", directCalls: false, headroomMode: "compress", headroomUrl: url }),
      askJev: async (request) => {
        order.push("decision");
        return jev.askJev(request);
      },
      fetch: async (input, init) => {
        if (String(input) === url) {
          order.push("headroom");
          throw new Error("synthetic Headroom failure");
        }
        order.push("forward");
        const raw = init?.body instanceof Uint8Array ? Buffer.from(init.body).toString("utf8") : String(init?.body);
        expect(JSON.parse(raw)).toMatchObject({
          ...body,
          tool_choice: { type: "function", name: "inspect" },
        });
        return Response.json({ id: "resp_next" });
      },
      log: () => {},
      routing: { enabled: true },
      advisorEnabled: { enabled: false },
    });
    const app = new Hono();
    app.post("/responses", router.route(responsesAdapter));
    const originalApply = responsesAdapter.apply;
    const originalEncode = responsesAdapter.encode;
    responsesAdapter.apply = (req, decision, model) => {
      order.push("prepare");
      return originalApply(req, decision, model);
    };
    responsesAdapter.encode = (req) => {
      order.push("encode");
      return JSON.stringify(req);
    };

    let response: Response;
    try {
      response = await app.request("/responses", { method: "POST", body: JSON.stringify(body) });
    } finally {
      responsesAdapter.apply = originalApply;
      if (originalEncode) responsesAdapter.encode = originalEncode;
      else delete responsesAdapter.encode;
    }

    expect(response.status, await response.clone().text()).toBe(200);
    expect(order).toEqual(["decision", "prepare", "encode", "headroom", "forward"]);
  });

  it("remembers a Responses session even when the injected logger throws", async () => {
    const jev = fakeJev({
      session_action: { choice: "pass" },
      tool: { choice: NO_TOOL },
      needs_tool: { noul: 0.1 },
    });
    const router = createRouter({
      config: testConfig({ client: "codex", advisorEnabled: true }),
      askJev: jev.askJev,
      fetch: (async () => Response.json({ id: "resp_first", output: [] })) as typeof fetch,
      log: () => { throw new Error("synthetic logger failure"); },
      routing: { enabled: true },
      advisorEnabled: { enabled: true },
    });
    const app = new Hono();
    app.post("/responses", router.route(responsesAdapter));
    const request = (text: string, previous_response_id?: string) => app.request("/responses", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-synthetic",
        ...(previous_response_id ? { previous_response_id } : {}),
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }],
        tools: [{ type: "function", name: "inspect", parameters: { type: "object", properties: {} } }],
      }),
    });

    expect((await request("first synthetic turn")).status).toBe(200);
    await settled();
    expect((await request("second synthetic turn", "resp_first")).status).toBe(200);
    const actions = jev.requests.filter((entry) => "session_action" in entry.questions);

    expect(actions).toHaveLength(2);
    const state = actions[1]!.state as Record<string, unknown> | null;
    expect(state?.recent_session_events).toContain("user: first synthetic turn");
  });

  it("fails open and preserves the request when Jev throws", async () => {
    const upstream = fakeUpstream();
    const router = createRouter({
      config: testConfig(),
      askJev: async () => { throw new Error("synthetic Jev failure"); },
      fetch: upstream.fetchImpl,
      log: () => {},
      routing: { enabled: true },
      advisorEnabled: { enabled: false },
    });
    const app = new Hono();
    app.post("/chat", router.route(chatAdapter));
    const body = chat("synthetic request");

    const response = await app.request("/chat", { method: "POST", body: JSON.stringify(body) });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-jev-gateway-reason")).toBe("jev_error");
    expect(upstream.calls[0]!.body).toEqual(body);
  });

  it("fails open with router_error when request preparation throws", async () => {
    const upstream = fakeUpstream();
    const router = createRouter({
      config: testConfig({ directCalls: false }),
      askJev: fakeJev(lightsAnswers).askJev,
      fetch: upstream.fetchImpl,
      log: () => {},
      routing: { enabled: true },
      advisorEnabled: { enabled: false },
    });
    const brokenAdapter = { ...chatAdapter, apply: () => { throw new Error("synthetic prepare failure"); } };
    const app = new Hono();
    app.post("/chat", router.route(brokenAdapter));
    const body = chat("kitchen lights on");

    const response = await app.request("/chat", { method: "POST", body: JSON.stringify(body) });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-jev-gateway-reason")).toBe("router_error");
    expect(upstream.calls[0]!.body).toEqual(body);
  });
});

describe("planTool", () => {
  it("marks a tool closed-set only when every parameter is an enum, boolean or const", () => {
    const [weather, lights] = (chatAdapter.toInput(chat("hi"), 100) as RouterInput).tools as [RouterTool, RouterTool];
    expect(planTool(weather).closedParams).toBeUndefined();
    expect(planTool(lights).closedParams?.map((param) => param.kind)).toEqual(["enum", "boolean", "enum"]);
  });
});

describe("chatAdapter.toInput + buildState", () => {
  it("names the tool behind each tool result and keeps the newest turns within budget", () => {
    const input = chatAdapter.toInput(
      {
        model: "m",
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "x".repeat(500) },
          {
            role: "assistant",
            tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: "{}" } }],
          },
          { role: "tool", tool_call_id: "c1", content: "sunny" },
        ],
      },
      100,
    ) as RouterInput;
    const state = buildState(input, { maxStateChars: 200, maxMessageChars: 100 });
    expect(state.assistant_instructions).toBe("Be brief.");
    expect(state.earlier_turns_omitted).toBe(1);
    expect(state.conversation).toEqual([
      { role: "assistant", tool_calls: [{ tool: "get_weather", arguments: "{}" }] },
      { role: "tool_result", tool: "get_weather", content: "sunny" },
    ]);
  });
});

describe("POST /v1/chat/completions", () => {
  it.each([
    ["no arguments", { type: "object", properties: {} }],
    ["only constant arguments", { type: "object", properties: { mode: { const: "brief" } }, required: ["mode"] }],
  ])("forces the tool instead of answering when direct calls are off and it takes %s", async (_name, parameters) => {
    const { app, post, upstream } = setup(
      { tool: { choice: "status" }, needs_tool: { noul: 0.99 } },
      testConfig({ directCalls: false }),
    );
    const body = {
      model: "m", messages: [{ role: "user", content: "Show status" }],
      tools: [{ type: "function", function: { name: "status", parameters } }],
    };
    const res = await post(body);
    expect(res.headers.get("x-jev-gateway-mode")).toBe("forced");
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]!.body.tool_choice).toEqual({ type: "function", function: { name: "status" } });
    const decision = await app.request("/router/decide", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    expect(await decision.json()).toMatchObject({ mode: "forced", tool: "status" });
    expect(upstream.calls).toHaveLength(1);
  });

  it("answers directly, without the LLM, when Jev can fill every argument", async () => {
    const { post, upstream } = setup(lightsAnswers);
    const res = await post(chat("turn on the kitchen lights"));
    const json = (await res.json()) as any;

    expect(upstream.calls).toHaveLength(0);
    expect(res.headers.get("x-jev-gateway-mode")).toBe("direct");
    expect(json.choices[0].finish_reason).toBe("tool_calls");
    const call = json.choices[0].message.tool_calls[0];
    expect(call.function.name).toBe("set_lights");
    // brightness is optional and was not stated, so it is left to the tool's default.
    expect(JSON.parse(call.function.arguments)).toEqual({ room: "kitchen", on: true });
  });

  it("maps enum labels back to their typed values when an optional argument is stated", async () => {
    const { post } = setup({ ...lightsAnswers, "stated:1:brightness": { noul: 0.93 } });
    const json = (await (await post(chat("kitchen lights on at half brightness"))).json()) as any;
    expect(JSON.parse(json.choices[0].message.tool_calls[0].function.arguments)).toEqual({
      room: "kitchen",
      on: true,
      brightness: 50,
    });
  });

  it("streams a direct answer as chat.completion.chunk events", async () => {
    const { post } = setup(lightsAnswers);
    const res = await post(chat("kitchen lights on", { stream: true, stream_options: { include_usage: true } }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = (await res.text()).trim().split("\n\n").map((line) => line.replace(/^data: /, ""));
    expect(events.at(-1)).toBe("[DONE]");
    const chunks = events.slice(0, -1).map((event) => JSON.parse(event));
    const args = chunks.map((chunk) => chunk.choices[0]?.delta.tool_calls?.[0]?.function?.arguments ?? "").join("");
    expect(JSON.parse(args)).toEqual({ room: "kitchen", on: true });
    expect(chunks.at(-2).choices[0].finish_reason).toBe("tool_calls");
    expect(chunks.at(-1).usage.prompt_tokens).toBe(123);
  });

  it("forces the tool Jev picked and lets the LLM fill open-ended arguments", async () => {
    const { post, upstream } = setup(
      { ...lightsAnswers, tool: { choice: "get_weather" } },
      testConfig({ argsModel: "cheap-model" }),
    );
    const res = await post(chat("weather in Lisbon?"));

    expect(res.headers.get("x-jev-gateway-mode")).toBe("forced");
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]!.url).toBe("https://llm.test/v1/chat/completions");
    expect(upstream.calls[0]!.body.tool_choice).toEqual({ type: "function", function: { name: "get_weather" } });
    expect(upstream.calls[0]!.body.model).toBe("cheap-model");
    expect(upstream.calls[0]!.headers.get("authorization")).toBe("Bearer client-key");
  });

  it("falls back to forcing the tool when an argument is uncertain", async () => {
    const { post, upstream } = setup({ ...lightsAnswers, "arg:1:room": { choice: "office", confidence: 0.4 } });
    const res = await post(chat("lights on"));
    expect(res.headers.get("x-jev-gateway-mode")).toBe("forced");
    expect(upstream.calls[0]!.body.tool_choice.function.name).toBe("set_lights");
  });

  it("sets tool_choice none when Jev is confident no tool is needed", async () => {
    const { post, upstream } = setup({ ...lightsAnswers, tool: { choice: NO_TOOL }, needs_tool: { noul: 0.05 } });
    const res = await post(chat("thanks, that's all!"));
    expect(res.headers.get("x-jev-gateway-mode")).toBe("none");
    expect(upstream.calls[0]!.body.tool_choice).toBe("none");
  });

  it("does not offer the no-tool option when the caller requires a tool", async () => {
    const { post, jev } = setup(lightsAnswers);
    await post(chat("kitchen lights on", { tool_choice: "required" }));
    const question = jev.requests[0]!.questions.tool!;
    expect(question.type === "choice" && NO_TOOL in question.criteria).toBe(false);
  });

  it.each([
    ["low confidence", { ...lightsAnswers, tool: { choice: "set_lights", confidence: 0.4 } }, "low_confidence"],
    ["disagreeing answers", { ...lightsAnswers, needs_tool: { noul: 0.1 } }, "jev_answers_disagree"],
  ])("forwards the request untouched on %s", async (_name, canned, reason) => {
    const { post, upstream } = setup(canned);
    const body = chat("hmm");
    const res = await post(body);
    expect(res.headers.get("x-jev-gateway-mode")).toBe("passthrough");
    expect(res.headers.get("x-jev-gateway-reason")).toBe(reason);
    expect(upstream.calls[0]!.body).toEqual(body);
  });

  it("fails open when Jev errors", async () => {
    const upstream = fakeUpstream();
    const app = createApp({
      config: testConfig(),
      askJev: async () => Promise.reject(new Error("529 overloaded")),
      fetch: upstream.fetchImpl,
    });
    const res = await app.request("/v1/chat/completions", { method: "POST", body: JSON.stringify(chat("hi")) });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-jev-gateway-reason")).toBe("jev_error");
    expect(upstream.calls).toHaveLength(1);
  });

  it("passes the request through when Jev returns malformed answers", async () => {
    const upstream = fakeUpstream();
    const app = createApp({
      config: testConfig(),
      askJev: async () => ({ answers: { tool: null }, usage: {} }) as never,
      fetch: upstream.fetchImpl,
    });
    const body = chat("hi");
    const res = await app.request("/v1/chat/completions", { method: "POST", body: JSON.stringify(body) });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-jev-gateway-mode")).toBe("passthrough");
    expect(res.headers.get("x-jev-gateway-reason")).toBe("jev_unexpected_answer");
    expect(upstream.calls[0]!.body).toEqual(body);
  });

  // A block page from a proxy in front of Jev (Cloudflare answers 403 with HTML) put newlines into
  // the reason header, and Headers.set threw after the upstream had already been called. Reasons
  // are stable codes now, and the provider's own words must not survive anywhere.
  it.each<[string, string | undefined, string | undefined]>([
    ["an HTML error page", '<!DOCTYPE html>\n<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->', undefined],
    ["characters a header cannot carry", "overloaded \u2014 try again", undefined],
    ["a timeout", undefined, "TimeoutError"],
  ])("fails open with a stable code when Jev fails with %s", async (_what, message, name) => {
    const upstream = fakeUpstream();
    const app = createApp({
      config: testConfig(),
      askJev: async () => {
        if (name) throw Object.assign(new Error("The operation was aborted due to timeout"), { name });
        throw new Error(message);
      },
      fetch: upstream.fetchImpl,
    });
    const res = await app.request("/v1/chat/completions", { method: "POST", body: JSON.stringify(chat("hi")) });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-jev-gateway-reason")).toBe(name ? "jev_timeout" : "jev_error");
    expect(upstream.calls).toHaveLength(1);
  });

  it("names an HTTP failure for what it is, without the provider's body", async () => {
    const upstream = fakeUpstream();
    const app = createApp({
      config: testConfig(),
      askJev: async () => Promise.reject(Object.assign(new Error("503 from TypeSafe: overloaded"), { status: 503 })),
      fetch: upstream.fetchImpl,
    });
    const res = await app.request("/v1/chat/completions", { method: "POST", body: JSON.stringify(chat("hi")) });
    expect(res.headers.get("x-jev-gateway-reason")).toBe("jev_http_503");
    expect(upstream.calls).toHaveLength(1);
  });

  it.each([
    ["there are no tools", { model: "m", messages: [{ role: "user", content: "hi" }] }, {}],
    ["the caller already chose a tool", chat("hi", { tool_choice: "none" }), {}],
    ["the caller opts out", chat("hi"), { "x-jev-gateway": "off" }],
  ])("never consults Jev when %s", async (_name, body, headers) => {
    const { post, jev, upstream } = setup(lightsAnswers);
    const res = await post(body, headers);
    expect(jev.requests).toHaveLength(0);
    expect(res.headers.get("x-jev-gateway-mode")).toBe("passthrough");
    expect(upstream.calls[0]!.headers.has("x-jev-gateway")).toBe(false);
  });
});

describe("gateway", () => {
  it("leaves internal review unchanged in both forwarded requests and decision previews", async () => {
    const { app, post, jev, upstream } = setup(lightsAnswers);
    const body = chat("Review the synthetic command.", { model: "codex-auto-review" });
    const res = await post(body);

    expect(res.headers.get("x-jev-gateway-reason")).toBe("codex_auto_review");
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]!.body).toEqual(body);
    const decision = await app.request("/router/decide", { method: "POST", body: JSON.stringify(body) });
    expect(await decision.json()).toEqual({ mode: "passthrough", reason: "codex_auto_review" });
    expect(jev.requests).toHaveLength(0);
    expect(upstream.calls).toHaveLength(1);
  });

  it("proxies other /v1 routes and swaps in the upstream key", async () => {
    const upstream = fakeUpstream({ data: [] });
    const app = createApp({
      config: testConfig({ upstreamApiKey: "sk-upstream", routerApiKey: "router-key" }),
      askJev: fakeJev({}).askJev,
      fetch: upstream.fetchImpl,
    });

    expect((await app.request("/v1/models")).status).toBe(401);
    const res = await app.request("/v1/models?limit=5", { headers: { authorization: "Bearer router-key" } });
    expect(res.status).toBe(200);
    expect(upstream.calls[0]!.url).toBe("https://llm.test/v1/models?limit=5");
    expect(upstream.calls[0]!.headers.get("authorization")).toBe("Bearer sk-upstream");
  });

  it("reports the decision without calling upstream on /router/decide", async () => {
    const { app, upstream } = setup(lightsAnswers);
    const res = await app.request("/router/decide", { method: "POST", body: JSON.stringify(chat("kitchen lights on")) });
    expect(await res.json()).toMatchObject({ mode: "direct", tool: "set_lights", jev: { choice: "set_lights" } });
    expect(upstream.calls).toHaveLength(0);
  });
});
