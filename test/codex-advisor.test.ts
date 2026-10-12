import { describe, expect, it } from "vitest";
import { appendAdvisorNote, buildAdvisorRequest, extractAdvisorText } from "../src/codex/advisor.js";
import { addRecent, createSessionStore, readResponseId, type SessionState } from "../src/codex/session-state.js";
import { testConfig } from "./helpers.js";

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
      previous_response_id: "resp_luna_parent",
      stream: false,
      store: false,
    });
    expect("tools" in request).toBe(false);
    expect(request.input).toHaveLength(2);
    expect(JSON.stringify(request)).not.toContain("Codex system prompt");
    expect(JSON.stringify(request)).not.toContain("additional_tools");
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
