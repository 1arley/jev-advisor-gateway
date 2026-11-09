import { describe, expect, it } from "vitest";
import { shouldPassThroughRecentToolResult } from "../src/client-policy.js";
import type { RouterInput, Turn } from "../src/types.js";

const input = (...turns: Turn[]): RouterInput => ({ system: "", turns, tools: [], toolChoice: "auto" });
const toolResult = (tool: string): Turn => ({ role: "tool_result", tool, content: "ok" });
const user = (text: string): Turn => ({ role: "user", text });
const assistantCall = (...names: string[]): Turn => ({
  role: "assistant",
  tool_calls: names.map((tool) => ({ tool, arguments: {} })),
});

describe("client recent-tool-result policy", () => {
  it.each(["codex", "opencode"] as const)("lets %s inspect a result from the tool Laya selected", (client) => {
    expect(
      shouldPassThroughRecentToolResult(
        { client, jevProvider: "laya" },
        input(user("check"), assistantCall("selected"), toolResult("selected"), user("continue")),
        "selected",
      ),
    ).toBe(false);
    expect(
      shouldPassThroughRecentToolResult(
        { client, jevProvider: "laya" },
        input(user("check"), assistantCall("selected"), toolResult("selected")),
        "selected",
      ),
    ).toBe(true);
  });

  it("ignores other providers, other clients, other tools and turns before the latest user message", () => {
    const recent = input(user("check"), assistantCall("selected"), toolResult("selected"));
    expect(shouldPassThroughRecentToolResult({ client: "codex", jevProvider: "typesafe" }, recent, "selected")).toBe(false);
    expect(shouldPassThroughRecentToolResult({ client: "claude", jevProvider: "laya" }, recent, "selected")).toBe(false);
    expect(shouldPassThroughRecentToolResult({ client: "codex", jevProvider: "laya" }, recent, "other")).toBe(false);
    expect(
      shouldPassThroughRecentToolResult(
        { client: "codex", jevProvider: "laya" },
        input(user("first"), assistantCall("selected"), toolResult("selected"), user("new request")),
        "selected",
      ),
    ).toBe(false);
  });
});
