import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { decide } from "../src/decide.js";
import { decisionProvider } from "../src/decision-providers/index.js";
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

const syntheticResult = (answers: Record<string, unknown>): SystemOneResult<Questions> =>
  ({ model: "synthetic", answers, usage: { input_tokens: 1, output_tokens: 0 } }) as unknown as SystemOneResult<Questions>;

const choice = (overrides: Record<string, unknown> = {}) => ({
  type: "choice",
  choice: "selected",
  confidence: 0.95,
  probabilities: { selected: 0.95 },
  ...overrides,
});
const noul = (value: number) => ({ type: "noul", noul: value });
const providerTools: RouterTool[] = [{ name: "selected", kind: "function" }];

describe("provider decision adapters", () => {
  it.each([
    ["low_confidence", { low_confidence: true }],
    ["abstained", { abstained: true }],
    ["abstention=abstained", { abstention: "abstained" }],
    ["abstention=unevaluated", { abstention: "unevaluated" }],
  ])("Laya native turns %s into a fail-open decision even with high confidence", (_name, marker) => {
    const provider = decisionProvider(testConfig({ jevProvider: "laya", layaRoutingPolicy: "native" }));
    const result = syntheticResult({ tool: choice({ choice: "tool_0", ...marker }) });
    expect(provider.assess(result, providerTools, true)).toEqual({ reason: "low_confidence" });
  });

  it("Laya applies the calibrated confidence threshold and keeps trace metadata", () => {
    const provider = decisionProvider(testConfig({ jevProvider: "laya", layaRoutingPolicy: "native" }));
    const assessment = provider.assess(syntheticResult({ tool: choice({ choice: "tool_0", confidence: 0.2 }) }), providerTools, true);
    expect(assessment).toMatchObject({
      choice: "selected",
      rejection: "low_confidence",
      trace: { policy: "native", confidenceMetric: "answer_confidence", optionCount: 2 },
    });
  });

  it.each([
    ["tool gate", "noul_refined", { noul: noul(0.05) }, { tool: choice({ choice: "tool_0" }), needs_tool: noul(0.05) }],
    [
      "binary gate",
      "binary_choice",
      { choice: "choice", confidence: 0.95 },
      { tool: choice({ choice: "tool_0" }), needs_tool: choice({ choice: "B" }) },
    ],
  ])("Laya rejects a %s that disagrees with the selected action", (_name, policy, _gate, answers) => {
    const provider = decisionProvider(testConfig({ jevProvider: "laya", layaRoutingPolicy: policy as "noul_refined" | "binary_choice" }));
    expect(provider.assess(syntheticResult(answers), providerTools, true)).toMatchObject({ rejection: "jev_answers_disagree" });
  });

  it.each([
    ["missing tool answer", {}, "jev_unexpected_answer"],
    ["wrong tool answer type", { tool: noul(0.95) }, "jev_unexpected_answer"],
    ["non-canonical tool label", { tool: choice({ choice: "tool_99" }) }, "jev_unknown_tool"],
  ])("Laya native passes malformed %s through", (_name, answers, reason) => {
    const provider = decisionProvider(testConfig({ jevProvider: "laya", layaRoutingPolicy: "native" }));
    expect(provider.assess(syntheticResult(answers), providerTools, true)).toEqual({ reason });
  });

  it("Jiwo uses its own confidence threshold and rejects a missing verification answer", () => {
    const provider = decisionProvider(testConfig({ jevProvider: "jiwo" }));
    expect(
      provider.assess(syntheticResult({ tool: choice({ confidence: 0.6 }), needs_tool: noul(0.9) }), providerTools, true),
    ).toMatchObject({
      rejection: "low_confidence",
    });
    expect(provider.assess(syntheticResult({ tool: choice() }), providerTools, true)).toEqual({ reason: "jev_unexpected_answer" });
  });

  it("canonical providers reject missing answers without treating them as a routing decision", () => {
    const provider = decisionProvider(testConfig({ jevProvider: "typesafe" }));
    expect(provider.assess(syntheticResult({}), providerTools, true)).toEqual({ reason: "jev_unexpected_answer" });
  });

  it.each(["laya", "jiwo", "typesafe"] as const)(
    "fails open before the provider seam when %s returns a malformed result",
    async (provider) => {
      const malformed = { model: "synthetic", answers: { tool: { type: "choice", choice: "selected" } }, usage: {} };
      const result = await decide(
        input(),
        testConfig({ jevProvider: provider, layaRoutingPolicy: "native" }),
        async () => malformed as unknown as SystemOneResult<Questions>,
      );
      expect(result).toMatchObject({ mode: "passthrough", reason: "jev_unexpected_answer" });
    },
  );
});
