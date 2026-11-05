import { loadConfig } from "../src/config.js";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createEventLog } from "../src/events.js";
import { chat, fakeJev, fakeUpstream, settled, testConfig } from "./helpers.js";

describe("Laya shadow", () => {
  it("forwards active decisions without waiting and bounds shadow concurrency without a queue", async () => {
    let release!: (response: Response) => void;
    let shadowCalls = 0;
    const upstream = fakeUpstream();
    const events = createEventLog();
    const jev = fakeJev({ tool: { choice: "get_weather" }, needs_tool: { noul: 0.99 } });
    const app = createApp({
      config: testConfig({
        jevProvider: "laya",
        jevUrl: "http://127.0.0.1:8080/v1/systemone",
        layaShadowPolicy: "native",
        directCalls: false,
      }),
      askJev: jev.askJev,
      events,
      fetch: (async (url, init) => {
        if (String(url).startsWith("http://127.0.0.1")) {
          shadowCalls++;
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        return upstream.fetchImpl(url, init);
      }) as typeof fetch,
    });
    const post = () =>
      app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(chat("Weather please")),
      });
    const first = await post();
    const second = await post();
    expect(first.headers.get("x-jev-gateway-tool")).toBe("get_weather");
    expect(second.headers.get("x-jev-gateway-tool")).toBe("get_weather");
    expect(upstream.calls).toHaveLength(2);
    expect(shadowCalls).toBe(1);
    release(
      Response.json({
        model: "local",
        answers: { tool: { type: "choice", choice: "tool_1", answer_confidence: 0.95, probabilities: { tool_1: 1 } } },
        usage: { input_tokens: 20, output_tokens: 0 },
      }),
    );
    await settled();
    expect(events.since(0).map((event) => event.shadow?.reason)).toContain("shadow_busy");
    expect(events.since(0).find((event) => event.shadow?.choice)?.shadow).toMatchObject({
      policy: "native",
      choice: "set_lights",
      agreement: false,
    });
  });

  it("observes active failures while disabled routing and absent shadow policy make no extra calls", async () => {
    for (const scenario of ["failure", "disabled", "baseline"]) {
      let shadowCalls = 0;
      const events = createEventLog();
      const upstream = fakeUpstream();
      const app = createApp({
        config: testConfig({
          jevProvider: "laya",
          jevUrl: "http://127.0.0.1:8080/v1/systemone",
          layaShadowPolicy: scenario === "baseline" ? undefined : "native",
          routing: scenario !== "disabled",
        }),
        askJev: async () => {
          throw new Error("synthetic failure");
        },
        events,
        fetch: (async (url, init) => {
          if (String(url).startsWith("http://127.0.0.1")) {
            shadowCalls++;
            expect(init?.redirect).toBe("error");
            return Response.json({
              model: "local",
              answers: { tool: { type: "choice", choice: "tool_0", answer_confidence: 0.95, probabilities: { tool_0: 1 } } },
              usage: { input_tokens: 20, output_tokens: 0 },
            });
          }
          return upstream.fetchImpl(url, init);
        }) as typeof fetch,
      });
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(chat("Weather please")),
      });
      expect(response.status).toBe(200);
      await settled();
      expect(shadowCalls).toBe(scenario === "failure" ? 1 : 0);
      if (scenario === "failure") expect(events.since(0)[0]?.shadow).toMatchObject({ choice: "get_weather", agreement: undefined });
    }
  });

  it("allowlists shadow fields and policy metadata without exposing request text", () => {
    const events = createEventLog();
    events.record({
      event: "route",
      mode: "passthrough",
      shadow: { policy: "native", choice: "get_weather", body: "secret", args: { secret: true }, agreement: true },
      jev: { policy: "native", confidenceMetric: "answer_confidence", state: "secret" },
    });
    expect(JSON.stringify(events.since(0))).not.toContain("secret");
    expect(events.since(0)[0]?.jev).toMatchObject({ policy: "native", confidenceMetric: "answer_confidence" });
  });
});

it("validates the shadow concurrency limit", () => {
  expect(loadConfig({ JEV_LAYA_SHADOW_CONCURRENCY: "2" }).layaShadowConcurrency).toBe(2);
  for (const value of ["0", "5", "1.5"])
    expect(() => loadConfig({ JEV_LAYA_SHADOW_CONCURRENCY: value })).toThrow("JEV_LAYA_SHADOW_CONCURRENCY");
});
