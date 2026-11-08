import { describe, expect, it } from "vitest";
import { decide } from "../src/decide.js";
import { PROVIDERS } from "../src/jev.js";
import type { RouterInput, RouterTool } from "../src/types.js";
import { fakeJev, testConfig } from "./helpers.js";

const input = (parameters: RouterTool["parameters"] = { type: "object", properties: {} }): RouterInput => ({
  system: "",
  turns: [{ role: "user", content: "Run the selected tool" }],
  tools: [{ name: "selected", kind: "function", parameters }],
  toolChoice: "auto",
});

const jiwoParameters: RouterTool["parameters"][] = [
  { type: "object", properties: {} },
  { type: "object", properties: { value: { const: "fixed" } }, required: ["value"] },
];

describe("decision provider capabilities", () => {
  it.each(jiwoParameters)("never executes a Jiwo tool directly with closed arguments: %j", async (parameters) => {
    const jev = fakeJev({ tool: { choice: "selected" }, needs_tool: { noul: 1 } });
    const result = await decide(input(parameters), testConfig({ jevProvider: "jiwo", directCalls: true }), jev.askJev);
    expect(result).toMatchObject({ mode: "forced", tool: "selected" });
    expect(Object.keys(jev.requests[0]!.questions)).toEqual(["tool", "needs_tool"]);
  });

  it.each(Object.keys(PROVIDERS).filter((provider) => provider !== "laya" && provider !== "jiwo"))(
    "keeps direct calls for the canonical provider %s",
    async (provider) => {
      const jev = fakeJev({ tool: { choice: "selected" }, needs_tool: { noul: 1 } });
      const result = await decide(input(), testConfig({ jevProvider: provider as keyof typeof PROVIDERS, directCalls: true }), jev.askJev);
      expect(result).toMatchObject({ mode: "direct", tool: "selected", args: {} });
    },
  );

  it.each(["native", "legacy"] as const)("keeps Laya %s direct-call policy", async (policy) => {
    const jev = fakeJev({ tool: { choice: policy === "native" ? "tool_0" : "selected" }, needs_tool: { noul: 1 } });
    const result = await decide(input(), testConfig({ jevProvider: "laya", layaRoutingPolicy: policy, directCalls: true }), jev.askJev);
    expect(result.mode).toBe(policy === "native" ? "forced" : "direct");
    expect(Object.keys(jev.requests[0]!.questions)).toEqual(policy === "native" ? ["tool"] : ["tool", "needs_tool"]);
  });

  it.each(["laya", "jiwo", "typesafe"] as const)("preserves %s shortlist limits and tool ordering", async (provider) => {
    const roster = input();
    roster.tools = Array.from({ length: 100 }, (_, index) => ({ name: `tool${index}`, kind: "function" }));
    let calls = 0;
    const result = await decide(
      roster,
      testConfig({ jevProvider: provider, layaRoutingPolicy: "native", directCalls: false }),
      async (request) => {
        calls++;
        const canned = Object.fromEntries(
          Object.entries(request.questions).map(([key, question]) => [
            key,
            question.type === "choice" ? { choice: Object.keys(question.criteria)[0]! } : { noul: 1 },
          ]),
        );
        return fakeJev(canned).askJev(request);
      },
    );
    expect(calls).toBe(provider === "typesafe" ? 1 : 2);
    expect(result).toMatchObject({ mode: "forced", tool: "tool0" });
    expect(result.jev?.shortlist).toEqual(provider === "typesafe" ? undefined : ["tool0", "tool50"]);
  });
});
