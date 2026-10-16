import { describe, expect, it } from "vitest";
import { advisorFor, appendAdvisorNote, buildAdvisorRequest, consultAdvisor, extractAdvisorText } from "../src/codex/advisor.js";
import { responsesAdapter } from "../src/adapters/responses.js";
import { createApp } from "../src/app.js";
import { createEventLog } from "../src/events.js";
import { NO_TOOL } from "../src/questions.js";
import { addRecent, createSessionStore, readResponseId, type SessionState } from "../src/codex/session-state.js";
import { fakeJev, fakeUpstream, settled, testConfig } from "./helpers.js";

describe("Codex advisor request", () => {
  it("branches from the Luna response without exposing tools or replacing the main chain", () => {
    const request = buildAdvisorRequest({
      model: "gpt-6-luna",
      previous_response_id: "resp_luna_parent",
      tools: [{ type: "function", name: "shell" }],
      input: [
        { type: "message", role: "user", content: "Fix the failing test" },
        { type: "additional_tools", tools: [{ type: "custom", name: "exec" }] },
        { type: "message", role: "developer", content: "Codex system prompt" },
      ],
    }, testConfig({ advisorModel: "gpt-6-astra" }), {
      recent: ["tool result: repeated failure"], lastAdvisorAt: 0, advisorCalls: 0,
    });

    expect(request).toMatchObject({
      model: "gpt-6-astra",
      // The ChatGPT Codex backend answers 400 to `stream: false`, to a missing
      // `reasoning.context: all_turns`, and to `parallel_tool_calls` other than false.
      stream: true,
      store: false,
      reasoning: { context: "all_turns" },
      parallel_tool_calls: false,
    });
    // The advisor reads the conversation as input; chaining onto the session's own id would
    // splice the advisor's reply into the main model's history.
    expect("previous_response_id" in request).toBe(false);
    expect("tools" in request).toBe(false);
    expect(request.input).toHaveLength(2);
    expect(JSON.stringify(request)).not.toContain("Codex system prompt");
    expect(JSON.stringify(request)).not.toContain("additional_tools");
  });

  it("records on every Codex request why the advisor answered or stayed silent", async () => {
    // The route log carries the tool decision alone, so without this an advisor consult that
    // produced nothing is indistinguishable from a gateway that never asked.
    const logs: Record<string, any>[] = [];
    const jev = fakeJev({ session_action: { choice: "consult_advisor" }, tool: { choice: NO_TOOL }, needs_tool: { noul: 0.1 } });
    const app = createApp({
      config: testConfig({ client: "codex", advisorEnabled: true }),
      askJev: jev.askJev,
      log: (entry) => { logs.push(entry); },
      fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return Response.json(body.model === "gpt-6-astra" ? { id: "resp_a", output: [] } : { id: "resp_luna", output: [] });
      }) as typeof fetch,
    });
    const res = await app.request("/v1/responses", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-6-luna",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "fix the test" }] }],
        tools: [{ type: "function", name: "shell", description: "Run a shell command", parameters: { type: "object", properties: {} } }],
      }),
    });

    expect(res.status).toBe(200);
    await settled();
    // The advisor answered with no output_text, so no note was added; the request still went through.
    expect(logs[0]!.advisor).toMatchObject({ action: "consult_advisor", consulted: true, noteAdded: false, skipped: "advisor_empty_reply" });
  });

  it("meters the advisor consult, so the dashboard shows its cost apart from the session", async () => {
    const jev = fakeJev({ session_action: { choice: "consult_advisor" }, tool: { choice: NO_TOOL }, needs_tool: { noul: 0.1 } });
    const events = createEventLog();
    const app = createApp({
      config: testConfig({ client: "codex", advisorEnabled: true, advisorModel: "gpt-6-astra" }),
      askJev: jev.askJev,
      events,
      fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        if (body.model !== "gpt-6-astra") return Response.json({ id: "resp_luna", output: [] });
        const sse = [
          'data: {"type":"response.output_text.delta","delta":"Check the retry path."}',
          "",
          'data: {"type":"response.completed","response":{"id":"resp_a","output":[{"type":"message","content":[{"type":"output_text","text":"Check the retry path."}]}],"usage":{"input_tokens":800,"output_tokens":40,"input_tokens_details":{"cached_tokens":600}}}}',
          "",
        ].join("\n");
        return new Response(sse, { status: 200 });
      }) as typeof fetch,
    });
    await app.request("/v1/responses", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-6-luna",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "fix the test" }] }],
        tools: [{ type: "function", name: "shell", description: "Run a shell command", parameters: { type: "object", properties: {} } }],
      }),
    });

    await settled();
    const [event] = events.since(0);
    expect(event!.advisor).toMatchObject({ model: "gpt-6-astra", consulted: true, usage: { input: 800, output: 40, cached: 600 } });
  });

  it("still logs the advisor block when Jev's session-action call fails", async () => {
    const logs: Record<string, any>[] = [];
    const upstream = fakeUpstream({ id: "resp_luna" });
    const app = createApp({
      config: testConfig({ client: "codex", advisorEnabled: true }),
      // A Jev outage must not take the gateway down, and must not hide that the advisor is on.
      askJev: async () => { throw new Error("jev down"); },
      log: (entry) => { logs.push(entry); },
      fetch: upstream.fetchImpl,
    });
    const res = await app.request("/v1/responses", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-6-luna",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "fix the test" }] }],
        tools: [{ type: "function", name: "shell", description: "Run a shell command", parameters: { type: "object", properties: {} } }],
      }),
    });

    expect(res.status).toBe(200);
    await settled();
    expect(upstream.calls).toHaveLength(1);
    expect(logs[0]!.advisor).toMatchObject({ action: "pass", confidence: 0, calls: 0 });
  });

  it("adds the advisor result as bounded, explicitly untrusted input without changing the model", () => {
    const original = { model: "gpt-6-luna", input: "continue" };
    const rewritten = appendAdvisorNote(original, "Check the retry path.");
    expect(rewritten.model).toBe("gpt-6-luna");
    expect(rewritten.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
      expect.objectContaining({ role: "developer", content: [expect.objectContaining({ text: expect.stringContaining("Untrusted read-only advisor note") })] }),
    ]);
    expect(extractAdvisorText({ output: [{ content: [{ type: "output_text", text: "Review the retry." }] }] })).toBe("Review the retry.");
  });
});

describe("Codex advisor reply shapes", () => {
  const config = testConfig({ client: "codex", advisorEnabled: true });
  const session: SessionState = { recent: [], lastAdvisorAt: 0, advisorCalls: 0 };
  const req = { model: "gpt-6-luna", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "go" }] }] } as const;
  const incoming = new Request("http://127.0.0.1:8790/v1/responses", { method: "POST", headers: { "content-type": "application/json" } });
  const consultWith = (reply: string) =>
    consultAdvisor(incoming, req as never, config, session, (async () => new Response(reply, { status: 200 })) as typeof fetch, advisorFor(responsesAdapter)!);

  // The ChatGPT Codex backend answers 400 to `stream: false`, so the advisor always reads SSE.
  it("reads the note from a streamed reply", async () => {
    const sse = [
      'data: {"type":"response.created","response":{"id":"resp_1"}}',
      "",
      'data: {"type":"response.output_text.delta","delta":"Rever "}',
      "",
      'data: {"type":"response.output_text.delta","delta":"o retry."}',
      "",
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","content":[{"type":"output_text","text":"Rever o retry."}]}]}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    expect(await consultWith(sse)).toEqual({ note: "Rever o retry." });
  });

  it("falls back to the deltas when the completed event carries no output", async () => {
    const sse = [
      'data: {"type":"response.output_text.delta","delta":"parcial"}',
      "",
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[]}}',
      "",
    ].join("\n");

    expect(await consultWith(sse)).toEqual({ note: "parcial" });
  });

  it("still reads a non-streamed JSON body, so a plain upstream keeps working", async () => {
    expect(await consultWith(JSON.stringify({ output: [{ content: [{ type: "output_text", text: "json" }] }] }))).toEqual({ note: "json" });
  });

  it("reports a refusal with the upstream's own words", async () => {
    const consult = await consultAdvisor(incoming, req as never, config, session, (async () =>
      new Response('{"detail":"Stream must be set to true"}', { status: 400 })) as typeof fetch, advisorFor(responsesAdapter)!);

    expect(consult).toEqual({ reason: "advisor_http_error", status: 400, detail: '{"detail":"Stream must be set to true"}' });
  });
});

describe("Codex session continuity", () => {
  it("keeps bounded summaries under upstream response IDs and isolates branches", () => {
    let now = 10;
    const store = createSessionStore(() => now);
    const state: SessionState = { recent: [], lastAdvisorAt: 0, advisorCalls: 0 };
    addRecent(state, { turns: [{ role: "user", text: "Inspect src/app.ts" }] });
    state.advisorCalls = 1;
    store.remember("resp_a", state);
    const resumed = store.resume("resp_a");
    resumed.recent.push("branch-only");
    expect(store.resume("resp_a").recent).toEqual(["user: Inspect src/app.ts"]);
    expect(store.resume("resp_a").advisorCalls).toBe(1);
    expect(store.resume("unknown").recent).toEqual([]);
    now += 31 * 60_000;
    expect(store.resume("resp_a").recent).toEqual([]);
  });

  it("captures IDs from JSON and fragmented SSE without requiring a content-type header", async () => {
    expect(await readResponseId(Response.json({ id: "resp_json" }))).toBe("resp_json");
    const chunks = ["event: response.created\ndata: {\"type\":\"response.created\",\"response\":{", "\"id\":\"resp_sse\"}}\n\n"];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(new TextEncoder().encode(next));
        else controller.close();
      },
    });
    expect(await readResponseId(new Response(stream))).toBe("resp_sse");
  });
});
