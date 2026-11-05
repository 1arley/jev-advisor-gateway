import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { chat, fakeJev, fakeUpstream } from "./helpers.js";

async function route(choice: string, confidence = 0.95) {
  const jev = fakeJev({ tool: { choice, confidence } });
  const upstream = fakeUpstream();
  const app = createApp({
    config: loadConfig({ JEV_PROVIDER: "laya", JEV_LAYA_ROUTING_POLICY: "native" }),
    askJev: jev.askJev,
    fetch: upstream.fetchImpl,
  });
  const response = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(chat("Check the weather")),
  });
  return { response, jev, upstream };
}

describe("Laya native routing", () => {
  it("maps a single choice to the original tool without generating arguments", async () => {
    const { response, jev, upstream } = await route("tool_0");
    expect(Object.keys(jev.requests[0]!.questions)).toEqual(["tool"]);
    expect(response.headers.get("x-jev-gateway-mode")).toBe("forced");
    expect(upstream.calls[0]!.body.tool_choice.function.name).toBe("get_weather");
  });
  it("passes direct answers and low confidence through to the model", async () => {
    expect((await route("direct_answer")).response.headers.get("x-jev-gateway-reason")).toBe("no_tool_needed");
    expect((await route("tool_0", 0.2)).response.headers.get("x-jev-gateway-reason")).toBe("low_confidence");
  });
  it("validates the policy and confidence configuration", () => {
    expect(() => loadConfig({ JEV_LAYA_ROUTING_POLICY: "bad" })).toThrow();
    expect(() => loadConfig({ JEV_LAYA_MIN_CONFIDENCE: "2" })).toThrow();
  });
});
