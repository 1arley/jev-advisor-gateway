import { describe, expect, it } from "vitest";
import { chatAdapter } from "../src/adapters/chat.js";
import type { Decision } from "../src/decide.js";
import type { ChatRequest, DirectCall, ToolDef } from "../src/types.js";

const DUMMY_URL = new URL("http://localhost/v1/chat/completions");

describe("chatAdapter", () => {
  describe("toInput", () => {
    it("skips requests with missing or non-array messages", () => {
      expect(chatAdapter.toInput({} as ChatRequest, 1000)).toEqual({ skip: "no_messages" });
      expect(chatAdapter.toInput({ messages: "hello" } as unknown as ChatRequest, 1000)).toEqual({ skip: "no_messages" });
    });

    it("skips requests with malformed tool definitions", () => {
      const missingName = { type: "function", function: { description: "no name" } } as unknown as ToolDef;
      expect(chatAdapter.toInput({ model: "test", messages: [], tools: [missingName] }, 1000)).toEqual({ skip: "malformed_tools" });

      const invalidType = { type: 123 } as unknown as ToolDef;
      expect(chatAdapter.toInput({ model: "test", messages: [], tools: [invalidType] }, 1000)).toEqual({ skip: "malformed_tools" });
    });

    it("extracts system and developer instructions into system field", () => {
      const req: ChatRequest = {
        model: "test",
        messages: [
          { role: "system", content: "Instruction one." },
          { role: "developer", content: "Instruction two." },
          { role: "user", content: "Hello" },
        ],
      };
      const input = chatAdapter.toInput(req, 1000);
      expect("skip" in input).toBe(false);
      if (!("skip" in input)) {
        expect(input.system).toBe("Instruction one.\n\nInstruction two.");
        expect(input.turns).toEqual([{ role: "user", text: "Hello" }]);
      }
    });

    it("correlates tool results by tool_call_id to prior assistant tool calls", () => {
      const req: ChatRequest = {
        model: "test",
        messages: [
          { role: "user", content: "check directory" },
          {
            role: "assistant",
            content: "Checking now.",
            tool_calls: [{ id: "call_123", type: "function", function: { name: "ls", arguments: '{"dir":"."}' } }],
          },
          { role: "tool", tool_call_id: "call_123", content: "fileA\nfileB" },
          { role: "tool", tool_call_id: "call_unknown", content: "orphan result" },
        ],
      };
      const input = chatAdapter.toInput(req, 1000);
      expect("skip" in input).toBe(false);
      if (!("skip" in input)) {
        expect(input.turns).toEqual([
          { role: "user", text: "check directory" },
          {
            role: "assistant",
            text: "Checking now.",
            tool_calls: [{ tool: "ls", arguments: '{"dir":"."}' }],
          },
          { role: "tool_result", tool: "ls", content: "fileA\nfileB" },
          { role: "tool_result", tool: "unknown", content: "orphan result" },
        ]);
      }
    });

    it("parses function tools, custom tools, and deduplicates provider built-ins", () => {
      const req: ChatRequest = {
        model: "test",
        messages: [{ role: "user", content: "Hi" }],
        tools: [
          {
            type: "function",
            function: { name: "search", description: "Search query", parameters: { type: "object" } },
          },
          {
            type: "custom",
            custom: { name: "my_custom_tool", description: "A custom tool" },
          },
          { type: "web_search" },
          { type: "web_search" },
        ],
      };
      const input = chatAdapter.toInput(req, 1000);
      expect("skip" in input).toBe(false);
      if (!("skip" in input)) {
        expect(input.tools).toEqual([
          { kind: "function", name: "search", description: "Search query", parameters: { type: "object" } },
          { kind: "hosted", name: "my_custom_tool", description: "A custom tool" },
          { kind: "hosted", name: "web_search", description: "The provider's built-in web_search tool." },
        ]);
      }
    });

    it("maps tool_choice variants appropriately", () => {
      const base: ChatRequest = { model: "test", messages: [] };
      expect(chatAdapter.toInput({ ...base, tool_choice: "auto" }, 1000)).toMatchObject({ toolChoice: "auto" });
      expect(chatAdapter.toInput({ ...base, tool_choice: "required" }, 1000)).toMatchObject({ toolChoice: "required" });
      expect(chatAdapter.toInput({ ...base, tool_choice: "none" }, 1000)).toMatchObject({ toolChoice: "decided" });
      expect(chatAdapter.toInput({ ...base, tool_choice: { type: "function", function: { name: "search" } } }, 1000)).toMatchObject({
        toolChoice: "decided",
      });
    });
  });

  describe("apply", () => {
    const originalReq: ChatRequest = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "test" }],
      tool_choice: "auto",
    };

    it("forces tool selection and updates model when specified", () => {
      const decision: Decision = { mode: "forced", tool: "get_weather", kind: "function", confidence: 0.9 };
      const rewritten = chatAdapter.apply(originalReq, decision, "gpt-4o-mini");
      expect(rewritten.model).toBe("gpt-4o-mini");
      expect(rewritten.tool_choice).toEqual({
        type: "function",
        function: { name: "get_weather" },
      });
    });

    it("forces tool selection retaining original model when argsModel is not provided", () => {
      const decision: Decision = { mode: "forced", tool: "get_weather", kind: "function", confidence: 0.9 };
      const rewritten = chatAdapter.apply(originalReq, decision);
      expect(rewritten.model).toBe("gpt-4o");
      expect(rewritten.tool_choice).toEqual({
        type: "function",
        function: { name: "get_weather" },
      });
    });

    it("sets tool_choice none when decision mode is none", () => {
      const decision: Decision = { mode: "none", confidence: 0.9 };
      const rewritten = chatAdapter.apply(originalReq, decision);
      expect(rewritten.tool_choice).toBe("none");
    });

    it("leaves request unchanged on passthrough decision", () => {
      const decision: Decision = { mode: "passthrough", reason: "no_tool_needed" };
      const rewritten = chatAdapter.apply(originalReq, decision);
      expect(rewritten).toBe(originalReq);
    });
  });

  describe("directJson", () => {
    it("generates valid chat.completion payload with tool_calls and usage", () => {
      const req: ChatRequest = { model: "test-model", messages: [] };
      const call: DirectCall = {
        tool: "calc",
        args: { expr: "2 + 2" },
        inputTokens: 42,
      };
      const res = chatAdapter.directJson(req, call) as {
        object: string;
        model: string;
        system_fingerprint: string;
        choices: Array<{ finish_reason: string; message: { tool_calls: Array<{ function: { name: string; arguments: string } }> } }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      expect(res.object).toBe("chat.completion");
      expect(res.model).toBe("test-model");
      expect(res.system_fingerprint).toBe("jev-gateway");
      expect(res.choices[0]!.finish_reason).toBe("tool_calls");
      expect(res.choices[0]!.message.tool_calls[0]!.function).toEqual({
        name: "calc",
        arguments: '{"expr":"2 + 2"}',
      });
      expect(res.usage).toEqual({
        prompt_tokens: 42,
        completion_tokens: 0,
        total_tokens: 42,
      });
    });
  });

  describe("directStream", () => {
    it("streams chunk sequence ending with tool_calls and [DONE]", () => {
      const req: ChatRequest = { model: "test-model", messages: [] };
      const call: DirectCall = {
        tool: "calc",
        args: { x: 1 },
        inputTokens: 10,
      };
      const stream = chatAdapter.directStream(req, call, DUMMY_URL) as string;
      const lines = stream.split("\n\n").filter(Boolean);
      expect(lines.at(-1)).toBe("data: [DONE]");

      const jsonChunks = lines.slice(0, -1).map((l: string) => JSON.parse(l.replace(/^data: /, "")));
      expect(jsonChunks[0].choices[0].delta.tool_calls[0].function.name).toBe("calc");
      expect(jsonChunks[1].choices[0].delta.tool_calls[0].function.arguments).toBe('{"x":1}');
      expect(jsonChunks[2].choices[0].finish_reason).toBe("tool_calls");
    });

    it("includes usage chunk when stream_options.include_usage is requested", () => {
      const req: ChatRequest = {
        model: "test-model",
        messages: [],
        stream_options: { include_usage: true },
      };
      const call: DirectCall = {
        tool: "calc",
        args: {},
        inputTokens: 88,
      };
      const stream = chatAdapter.directStream(req, call, DUMMY_URL) as string;
      const lines = stream.split("\n\n").filter(Boolean);
      expect(lines.at(-1)).toBe("data: [DONE]");

      const usageChunk = JSON.parse(lines.at(-2)!.replace(/^data: /, ""));
      expect(usageChunk.choices).toEqual([]);
      expect(usageChunk.usage).toEqual({
        prompt_tokens: 88,
        completion_tokens: 0,
        total_tokens: 88,
      });
    });
  });
});
