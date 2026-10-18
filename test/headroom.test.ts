import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { fakeJev, settled, testConfig } from "./helpers.js";

const url = "http://127.0.0.1:8788/v1/compress";
const text = "synthetic output row with stable fixture values\n".repeat(80);
const bodyJson = (body: BodyInit | null | undefined) => JSON.parse(
  body instanceof Uint8Array ? Buffer.from(body).toString("utf8") : String(body),
);

function setup(mode: "shadow" | "compress", response?: unknown) {
  const calls: { url: string; init?: RequestInit; body?: any }[] = [];
  const logs: Record<string, unknown>[] = [];
  const app = createApp({
    config: testConfig({ client: "codex", routing: true, headroomMode: mode, headroomUrl: url }),
    askJev: fakeJev({}).askJev,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      const body = init?.body ? bodyJson(init.body) : undefined;
      calls.push({ url: target, init, body });
      if (target === url) {
        if (response === "error") throw new Error("synthetic failure");
        return Response.json(response ?? {
          messages: [{ role: "tool", tool_call_id: "call_fixture", content: "synthetic compressed result" }],
          tokens_before: 120,
          tokens_after: 18,
          ccr_hashes: [],
        });
      }
      return Response.json({ id: "resp_synthetic" });
    }) as typeof fetch,
    log: (entry) => logs.push(entry),
  });
  const request = {
    model: "gpt-synthetic",
    previous_response_id: "resp_previous",
    input: [
      { type: "message", role: "user", content: "Use the synthetic fixture." },
      { type: "function_call_output", id: "fco_fixture", call_id: "call_fixture", output: text },
    ],
  };
  const post = () => app.request("/v1/responses", {
    method: "POST",
    headers: { authorization: "Bearer upstream-secret", "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return { post, calls, logs, request };
}

describe("Headroom on Codex continuations", () => {
  it("compresses only the matching tool text and never forwards the upstream credential to Headroom", async () => {
    const { post, calls, request } = setup("compress");
    const response = await post();

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(url);
    expect(calls[0]!.init?.redirect).toBe("error");
    expect(new Headers(calls[0]!.init?.headers).has("authorization")).toBe(false);
    expect(calls[0]!.body).toEqual({
      model: "gpt-synthetic",
      messages: [{ role: "tool", tool_call_id: "call_fixture", content: text }],
    });
    expect(calls[1]!.body).toMatchObject({
      previous_response_id: request.previous_response_id,
      input: [request.input[0], { ...request.input[1], output: "synthetic compressed result" }],
    });
  });

  it("measures in shadow mode and forwards the original body", async () => {
    const { post, calls, request, logs } = setup("shadow");
    await post();
    expect(calls[1]!.body).toEqual(request);
    await settled();
    expect(logs[0]!.headroom).toMatchObject({ mode: "shadow", result: "compressed", tokensBefore: 120, tokensAfter: 18 });
    expect(JSON.stringify(logs)).not.toContain(text);
  });

  it("compresses only the newest output on two successive continuations", async () => {
    const upstreamBodies: any[] = [];
    let compressionCalls = 0;
    const app = createApp({
      config: testConfig({ client: "codex", routing: true, headroomMode: "compress", headroomUrl: url }),
      askJev: fakeJev({}).askJev,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === url) {
          compressionCalls++;
          const body = JSON.parse(String(init?.body));
          return Response.json({
            messages: [{ role: "tool", tool_call_id: body.messages[0].tool_call_id, content: "small synthetic output" }],
            tokens_before: 100,
            tokens_after: 12,
            ccr_hashes: [],
          });
        }
        upstreamBodies.push(JSON.parse(String(init?.body)));
        return Response.json({ id: "resp_synthetic" });
      }) as typeof fetch,
    });
    for (const id of ["resp_first", "resp_second"]) {
      await app.request("/v1/responses", {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-synthetic",
          previous_response_id: id,
          input: [{ type: "function_call_output", call_id: `call_${id}`, output: text }],
        }),
      });
    }
    expect(compressionCalls).toBe(2);
    expect(upstreamBodies.map((body) => body.previous_response_id)).toEqual(["resp_first", "resp_second"]);
    expect(upstreamBodies.every((body) => body.input[0].output === "small synthetic output")).toBe(true);
  });

  it.each([
    ["failure", "error"],
    ["wrong call id", { messages: [{ role: "tool", tool_call_id: "call_other", content: "short" }], ccr_hashes: [] }],
    ["CCR marker", { messages: [{ role: "tool", tool_call_id: "call_fixture", content: "<<ccr:deadbeef01234567>>" }], ccr_hashes: [] }],
  ])("fails open on %s", async (_name, reply) => {
    const { post, calls, request } = setup("compress", reply);
    const response = await post();
    expect(response.status).toBe(200);
    expect(calls[1]!.body).toEqual(request);
  });

  it("does not call Headroom for parallel tool outputs", async () => {
    const { calls, request } = setup("compress");
    const body = { ...request, input: [...request.input, { type: "function_call_output", call_id: "call_parallel", output: "other synthetic output" }] };
    const app = createApp({
      config: testConfig({ client: "codex", headroomMode: "compress", headroomUrl: url }),
      askJev: fakeJev({}).askJev,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init, body: init?.body ? bodyJson(init.body) : undefined });
        return Response.json({ id: "resp_synthetic" });
      }) as typeof fetch,
    });
    await app.request("/v1/responses", { method: "POST", body: JSON.stringify(body) });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual(body);
  });
});
