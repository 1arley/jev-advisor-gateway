import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { chat, fakeJev, fakeUpstream } from "./helpers.js";

async function route(policy: string, answers: Parameters<typeof fakeJev>[0]) {
  const jev = fakeJev(answers);
  const upstream = fakeUpstream();
  const app = createApp({
    config: loadConfig({ JEV_PROVIDER: "laya", JEV_LAYA_ROUTING_POLICY: policy }),
    askJev: jev.askJev,
    fetch: upstream.fetchImpl,
  });
  const response = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(chat("Read the weather")),
  });
  return { response, jev, upstream };
}

describe.each(["noul_refined", "binary_choice"])("Laya %s", (policy) => {
  const gate = (tool: boolean, weak = false) =>
    policy === "noul_refined" ? { noul: weak ? 0.5 : tool ? 0.95 : 0.05 } : { choice: tool ? "A" : "B", confidence: weak ? 0.5 : 0.95 };
  it("applies an agreed tool in one request", async () => {
    const { response, jev } = await route(policy, { tool: { choice: "tool_0" }, needs_tool: gate(true) });
    expect(response.headers.get("x-jev-gateway-mode")).toBe("forced");
    expect(jev.requests).toHaveLength(1);
    const gateQuestion = jev.requests[0]!.questions.needs_tool;
    if (policy === "noul_refined")
      expect(gateQuestion).toMatchObject({
        type: "noul",
        labels: { true: "A", false: "B" },
        criteria: { true: expect.any(String), false: expect.any(String) },
      });
    else expect(gateQuestion).toMatchObject({ type: "choice", criteria: { A: expect.any(String), B: expect.any(String) } });
  });
  it("passes direct answers through", async () => {
    const { response } = await route(policy, { tool: { choice: "direct_answer" }, needs_tool: gate(false) });
    expect(response.headers.get("x-jev-gateway-reason")).toBe("no_tool_needed");
  });
  it("rejects disagreement and uncertain verification", async () => {
    expect(
      (await route(policy, { tool: { choice: "tool_0" }, needs_tool: gate(false) })).response.headers.get("x-jev-gateway-reason"),
    ).toBe("jev_answers_disagree");
    expect(
      (await route(policy, { tool: { choice: "tool_0" }, needs_tool: gate(true, true) })).response.headers.get("x-jev-gateway-reason"),
    ).toBe("low_confidence");
  });
  it("fails open on missing or invalid answers", async () => {
    expect((await route(policy, { tool: { choice: "tool_0" } })).response.headers.get("x-jev-gateway-mode")).toBe("passthrough");
    expect(
      (
        await route(policy, { tool: { choice: "tool_0" }, needs_tool: policy === "noul_refined" ? { noul: 2 } : { choice: "invalid" } })
      ).response.headers.get("x-jev-gateway-mode"),
    ).toBe("passthrough");
  });
});

describe.each(["noul_refined", "binary_choice"])("Laya %s HTTP", (policy) => {
  it("uses Laya answer confidence and preserves diagnostics", async () => {
    const { createAskJev } = await import("../src/jev.js");
    const config = loadConfig({ JEV_PROVIDER: "laya", JEV_LAYA_ROUTING_POLICY: policy, JEV_MODEL: "english" });
    let requestCount = 0;
    const layaFetch = (async (_url, init) => {
      requestCount++;
      const request = JSON.parse(String(init?.body));
      expect(Object.keys(request.questions)).toEqual(["tool", "needs_tool"]);
      const gate =
        policy === "noul_refined"
          ? { type: "noul", noul: 0.95 }
          : { type: "choice", choice: "A", confidence: 0.1, answer_confidence: 0.95, probabilities: { A: 0.95, B: 0.05 } };
      return Response.json({
        model: "laya-rl-agent",
        routing: { model: "english" },
        usage: { input_tokens: 12, output_tokens: 0, truncated: true, truncated_questions: ["tool"] },
        answers: {
          tool: { type: "choice", choice: "tool_0", confidence: 0.1, answer_confidence: 0.95, probabilities: { tool_0: 0.95 } },
          needs_tool: gate,
        },
      });
    }) as typeof fetch;
    const upstream = fakeUpstream();
    const logs: Record<string, unknown>[] = [];
    const app = createApp({ config, askJev: createAskJev(config, layaFetch), fetch: upstream.fetchImpl, log: (entry) => logs.push(entry) });
    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(chat("Check the weather")),
    });
    expect(response.headers.get("x-jev-gateway-mode")).toBe("forced");
    expect(requestCount).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logs.find((entry) => entry.event === "route")?.jev).toMatchObject({
      effectiveCheckpoint: "english",
      truncated: true,
      truncatedQuestions: 1,
    });
  });
});

describe.each(["noul_refined", "binary_choice"])("Laya %s failures", (policy) => {
  it("passes through when the checkpoint is unavailable or answer confidence is absent", async () => {
    const { createAskJev } = await import("../src/jev.js");
    const config = loadConfig({ JEV_PROVIDER: "laya", JEV_LAYA_ROUTING_POLICY: policy });
    for (const layaFetch of [
      async () => new Response("unavailable", { status: 404 }),
      async () =>
        Response.json({
          usage: { input_tokens: 1, output_tokens: 0 },
          answers: {
            tool: { type: "choice", choice: "tool_0", confidence: 0.99, probabilities: { tool_0: 0.99 } },
            needs_tool:
              policy === "noul_refined"
                ? { type: "noul", noul: 0.9 }
                : { type: "choice", choice: "A", answer_confidence: 0.9, probabilities: { A: 0.9 } },
          },
        }),
    ]) {
      const upstream = fakeUpstream();
      const app = createApp({ config, askJev: createAskJev(config, layaFetch as typeof fetch), fetch: upstream.fetchImpl });
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(chat("Check the weather")),
      });
      expect(response.headers.get("x-jev-gateway-mode")).toBe("passthrough");
      expect(upstream.calls[0]!.body.tool_choice).toBeUndefined();
    }
  });
});

it("respects Laya's reported abstention even when its answer has high confidence", async () => {
  const { createAskJev } = await import("../src/jev.js");
  const config = loadConfig({ JEV_PROVIDER: "laya", JEV_LAYA_ROUTING_POLICY: "native" });
  const layaFetch = (async () =>
    Response.json({
      usage: { input_tokens: 1, output_tokens: 0 },
      answers: {
        tool: {
          type: "choice",
          choice: "tool_0",
          confidence: 0.99,
          answer_confidence: 0.99,
          probabilities: { tool_0: 0.99 },
          abstention: "abstained",
        },
      },
    })) as typeof fetch;
  const upstream = fakeUpstream();
  const app = createApp({ config, askJev: createAskJev(config, layaFetch), fetch: upstream.fetchImpl });
  const response = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(chat("Check the weather")),
  });
  expect(response.headers.get("x-jev-gateway-reason")).toBe("low_confidence");
});
