import { describe, expect, it } from "vitest";
import { chatAdapter } from "../src/adapters/chat.js";
import { messagesAdapter } from "../src/adapters/messages.js";
import { advisorFor, buildMessagesAdvisorRequest, extractMessagesAdvisorText } from "../src/advisor/advisor.js";
import type { SessionState } from "../src/advisor/session-state.js";
import { createApp } from "../src/app.js";
import { NO_TOOL } from "../src/questions.js";
import { fakeJev, settled, testConfig } from "./helpers.js";

const session: SessionState = { recent: ["tool result: repeated failure"], lastAdvisorAt: 0, advisorCalls: 0 };

/** Shaped like what Claude Code sends: a tool_use turn answered by a trailing tool_result. */
const request = {
  model: "claude-haiku-5-5",
  max_tokens: 1024,
  stream: true,
  system: [{ type: "text", text: "You are Claude Code." }],
  messages: [
    { role: "user", content: [{ type: "text", text: "fix the test" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "boom" }] },
  ],
  tools: [{ name: "Bash", description: "Run a shell command.", input_schema: { type: "object", properties: {} } }],
};

describe("Claude advisor request", () => {
  it("asks on the Messages format, without the client's tools or system prompt", () => {
    const built = buildMessagesAdvisorRequest(request, testConfig({ advisorModel: "claude-opus-5-5" }), session);

    expect(built).toMatchObject({ model: "claude-opus-5-5", stream: true, max_tokens: 700 });
    expect(built.system).toContain("read-only advisor");
    expect("tools" in built).toBe(false);
    expect(JSON.stringify(built)).not.toContain("You are Claude Code.");
    // Two user turns in a row would be rejected: the brief joins the client's trailing user turn.
    expect(built.messages?.filter((message) => message.role === "user")).toHaveLength(2);
    expect(built.messages?.at(-1)?.role).toBe("user");
    expect(JSON.stringify(built.messages?.at(-1))).toContain("read-only second opinion");
  });

  it("reads the note from Anthropic's stream or a JSON body, and nothing from an error reply", () => {
    const sse = [
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":5,"output_tokens":1}}}',
      "",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Rever "}}',
      "",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"o retry."}}',
      "",
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");
    expect(extractMessagesAdvisorText(sse)).toBe("Rever o retry.");
    expect(extractMessagesAdvisorText(JSON.stringify({ content: [{ type: "text", text: "json" }] }))).toBe("json");
    expect(extractMessagesAdvisorText(JSON.stringify({ type: "error", error: { message: "nope" } }))).toBeUndefined();
  });

  it("offers the advisor only to the formats it can speak", () => {
    expect(advisorFor(messagesAdapter)).toBeDefined();
    expect(advisorFor(chatAdapter)).toBeDefined();
  });
});

describe("Claude advisor consult", () => {
  it("joins the note into the main request and meters the consult apart from the session", async () => {
    const jev = fakeJev({ session_action: { choice: "consult_advisor" }, tool: { choice: NO_TOOL }, needs_tool: { noul: 0.1 } });
    const logs: Record<string, any>[] = [];
    const sent: Record<string, any>[] = [];
    const app = createApp({
      config: testConfig({ client: "claude", advisorEnabled: true, advisorModel: "claude-opus-5-5" }),
      askJev: jev.askJev,
      log: (entry) => { logs.push(entry); },
      fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        sent.push(body);
        if (body.model !== "claude-opus-5-5") return Response.json({ id: "msg_main", content: [{ type: "text", text: "ok" }] });
        const sse = [
          'data: {"type":"message_start","message":{"id":"msg_a","usage":{"input_tokens":100,"cache_read_input_tokens":600,"cache_creation_input_tokens":0,"output_tokens":1}}}',
          "",
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Check the retry path."}}',
          "",
          'data: {"type":"message_stop"}',
          "",
        ].join("\n");
        return new Response(sse, { status: 200 });
      }) as typeof fetch,
    });
    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    expect(res.status).toBe(200);
    await settled();
    expect(logs[0]!.advisor).toMatchObject({ model: "claude-opus-5-5", action: "consult_advisor", consulted: true, usage: { input: 700, output: 1, cached: 600 } });
    // The main request still went up, with the note joined into its trailing user turn.
    const main = sent.find((body) => body.model === "claude-haiku-5-5");
    expect(JSON.stringify(main?.messages)).toContain("Untrusted read-only advisor note");
  });
});
