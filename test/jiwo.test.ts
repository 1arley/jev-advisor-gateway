import { describe, expect, it } from "vitest";
import { fromJiwoResult, buildJiwoState, sanitizeJiwoState, toJiwoRequest } from "../src/jiwo.js";
import { TOOL_KEY } from "../src/questions.js";

const request = {
  model: "jiwo-0.8b",
  state: {
    conversation: [
      { role: "user", content: "turn lights on" },
      { role: "tool_result", content: "secret" },
    ],
  },
  questions: {
    tool: { type: "choice" as const, instructions: "pick", criteria: { lights: "lights", no_tool_needed: "none" } },
    needs_tool: { type: "noul" as const, instructions: "need one" },
  },
};

const answer = {
  model: "jiwo-0.8b",
  answers: { tool: { type: "choice", choice: "lights", confidence: 0.9, probabilities: { lights: 0.9, no_tool_needed: 0.1 } } },
  usage: { input_tokens: 12, output_tokens: 0 },
};

describe("Jiwo adapter", () => {
  it("keeps only user and assistant text in bounded state", () => {
    const state = buildJiwoState(
      {
        system: "rules",
        turns: [
          { role: "user", content: "hello" },
          { role: "tool_result", content: "secret" },
          { role: "assistant", content: [{ type: "text", text: "reply" }, { type: "image" }] },
        ],
      },
      1_000,
    );
    expect(state).toEqual({
      assistant_instructions: "rules",
      conversation: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "reply\n[image]" },
      ],
    });
  });

  it("preserves router state turns that use the text field", () => {
    expect(sanitizeJiwoState({ conversation: [{ role: "user", text: "call the weather tool" }] }, 1_000)).toEqual({
      conversation: [{ role: "user", content: "call the weather tool" }],
    });
  });

  it("sends only choice questions and restores the derived noul answer", () => {
    const choiceRequest = toJiwoRequest(request);
    expect(Object.keys(choiceRequest.questions)).toEqual([TOOL_KEY]);
    const result = fromJiwoResult(answer, request, choiceRequest);
    expect(result.answers.needs_tool).toEqual({ type: "noul", noul: 1 });
  });

  it("rejects partial, unknown-choice, and invalid-confidence responses", () => {
    expect(() => fromJiwoResult({ ...answer, answers: {} }, request, toJiwoRequest(request))).toThrow("jiwo_partial_response");
    expect(() =>
      fromJiwoResult({ ...answer, answers: { tool: { ...answer.answers.tool, choice: "unknown" } } }, request, toJiwoRequest(request)),
    ).toThrow("jiwo_invalid_choice");
    expect(() =>
      fromJiwoResult({ ...answer, answers: { tool: { ...answer.answers.tool, confidence: 2 } } }, request, toJiwoRequest(request)),
    ).toThrow("jiwo_invalid_choice");
  });
});
