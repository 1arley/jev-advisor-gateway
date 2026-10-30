import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { geminiAdapter, type GeminiRequest } from "../src/adapters/gemini.js";
import {
  advisorFor,
  appendGeminiAdvisorNote,
  buildGeminiAdvisorRequest,
  extractGeminiAdvisorText,
} from "../src/advisor/advisor.js";
import { NO_TOOL } from "../src/questions.js";
import type { SessionState } from "../src/advisor/session-state.js";
import { fakeJev, settled, testConfig } from "./helpers.js";

const session: SessionState = { recent: ["tool result: repeated failure"], lastAdvisorAt: 0, advisorCalls: 0 };
const request: GeminiRequest = {
  contents: [
    { role: "user", parts: [{ text: "Fix the test." }] },
    { role: "model", parts: [{ functionCall: { name: "read_file", args: { path: "test.ts" } } }] },
    { role: "user", parts: [{ functionResponse: { name: "read_file", response: { output: "failure" } } }] },
  ],
  systemInstruction: { parts: [{ text: "Private client system prompt." }] },
  tools: [{ functionDeclarations: [{ name: "read_file", description: "Read a file." }] }],
  toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["read_file"] } },
};

describe("Gemini advisor request", () => {
  it("asks without client system instructions or tools and caps output", () => {
    const body = buildGeminiAdvisorRequest(request, testConfig({ advisorModel: "gemini-3.1-pro-preview", advisorMaxOutputTokens: 321 }), session);
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: expect.stringContaining("read-only advisor") }] },
      generationConfig: { maxOutputTokens: 321 },
    });
    expect(body.contents).toHaveLength(3);
    expect(body.contents.at(-1)).toMatchObject({ role: "user", parts: [
      { functionResponse: { name: "read_file" } },
      { text: expect.stringContaining("Recent router state") },
    ] });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("toolConfig");
    expect(body).not.toHaveProperty("model");
    expect(JSON.stringify(body)).not.toContain("Private client system prompt.");
  });

  it("appends the bounded note to the trailing user turn without mutating the request", () => {
    const original = structuredClone(request);
    const result = appendGeminiAdvisorNote(request, "Try the smaller change.");
    expect(result.contents?.at(-1)?.parts?.at(-1)?.text).toContain("Untrusted read-only advisor note");
    expect(result.contents?.at(-1)?.parts?.at(-1)?.text).toContain("Try the smaller change.");
    expect(request).toEqual(original);
  });

  it("reads JSON, chunked SSE, and Gemini's JSON-array stream, while rejecting empty text", () => {
    const chunk = (text: string) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
    expect(extractGeminiAdvisorText(chunk("A concise note."))).toBe("A concise note.");
    expect(extractGeminiAdvisorText(`data: ${chunk("Check ")}\n\ndata: ${chunk("the retry.")}\n\ndata: [DONE]\n\n`)).toBe("Check the retry.");
    expect(extractGeminiAdvisorText(`[${chunk("Array ")},${chunk("stream")}]`)).toBe("Array stream");
    expect(extractGeminiAdvisorText("data: not-json\n\n")).toBeUndefined();
  });

  it("registers the Gemini wire adapter for advisor consultations", () => {
    const advisor = advisorFor(geminiAdapter);
    expect(advisor).toBeDefined();
    expect(advisor?.externalMessages(request, testConfig())).toEqual([
      { role: "user", content: "Fix the test." },
    ]);
  });
});

describe("Gemini advisor consult", () => {
  const body = JSON.stringify(request);
  const path = "/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse&key=synthetic-key";
  const jevAnswers = {
    session_action: { choice: "consult_advisor" },
    tool: { choice: NO_TOOL },
    needs_tool: { noul: 0.1 },
  };

  it("uses the configured advisor model in the URL and adds its note to the forwarded request", async () => {
    const jev = fakeJev(jevAnswers);
    const calls: Array<{ url: string; body: GeminiRequest }> = [];
    const logs: Record<string, unknown>[] = [];
    const app = createApp({
      config: testConfig({ client: "agy", advisorEnabled: true, advisorModel: "gemini-3.1-pro-preview", directCalls: false }),
      askJev: jev.askJev,
      log: (entry) => logs.push(entry),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const sent = JSON.parse(String(init?.body)) as GeminiRequest;
        calls.push({ url, body: sent });
        if (url.includes("gemini-3.1-pro-preview:streamGenerateContent")) {
          return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Check the retry." }] } }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 4 } })}\n\n`, { status: 200 });
        }
        return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "main answer" }] } }], usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 6 } })}\n\n`, { status: 200 });
      }) as typeof fetch,
    });

    const response = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse&key=synthetic-key");
    expect(calls[0]!.body).not.toHaveProperty("tools");
    expect(calls[0]!.body).not.toHaveProperty("toolConfig");
    expect(calls[0]!.body.systemInstruction).toBeDefined();
    expect(calls[1]!.url).toContain("/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse&key=synthetic-key");
    expect(calls[1]!.body.contents?.at(-1)?.parts?.at(-1)?.text).toContain("Untrusted read-only advisor note");
    expect(logs.some((entry) => JSON.stringify(entry).includes("synthetic-key"))).toBe(false);
    await settled();
  });

  it("forwards the original body unchanged if the advisor rejects the request", async () => {
    const jev = fakeJev(jevAnswers);
    const calls: Array<{ url: string; body: string }> = [];
    let decisions = 0;
    const app = createApp({
      config: testConfig({ client: "agy", advisorEnabled: true, advisorModel: "gemini-3.1-pro-preview", directCalls: false }),
      askJev: async (input) => {
        if ("session_action" in input.questions) return jev.askJev(input);
        decisions++;
        throw new Error("synthetic decision failure");
      },
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const sent = typeof init?.body === "string"
          ? init.body
          : init?.body instanceof Uint8Array
            ? Buffer.from(init.body).toString("utf8")
            : init?.body instanceof ReadableStream
              ? await new Response(init.body).text()
              : String(init?.body);
        calls.push({ url, body: sent });
        return url.includes("gemini-3.1-pro-preview:streamGenerateContent")
          ? new Response("unavailable", { status: 503 })
          : new Response('{"candidates":[]}');
      }) as typeof fetch,
    });

    const response = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(decisions).toBe(1);
    expect(calls[1]!.body).toBe(body);
    await settled();
  });
});
