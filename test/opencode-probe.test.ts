import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeOpencodeDir } from "./helpers.js";

// @ts-ignore: bin/ is plain JavaScript outside the tsconfig include; resolved at runtime.
const { probeOpenCodeModel } = await import("../bin/clients.mjs");

const origin = "http://127.0.0.1:8795";
const upstream = "http://127.0.0.1:20128/v1";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("OpenCode upstream model probe", () => {
  it("sends one synthetic request for the selected model and keeps credentials out of output", async () => {
    const path = fakeOpencodeDir(
      `printf '%s\\n' '{"model":"9router/main","providers":{"9router":{"settings":{"baseURL":"${origin}/v1","apiKey":"{env:OPENAI_API_KEY}"}}}}'`,
    );
    dirs.push(path);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));

    const result = await probeOpenCodeModel({
      origin,
      upstream,
      argv: ["--model", "9router/slm"],
      env: { PATH: path, OPENAI_API_KEY: "synthetic-probe-key" },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(init).toBeDefined();
    expect(url).toBe(`${upstream}/chat/completions`);
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer synthetic-probe-key");
    expect(JSON.parse(String(init!.body))).toEqual({
      model: "slm",
      messages: [{ role: "user", content: "Reply OK" }],
      max_tokens: 1,
      stream: false,
    });
  });

  it("reports an HTTP status without exposing its response body", async () => {
    const path = fakeOpencodeDir(`printf '%s\\n' '{"model":"9router/main","provider":{"9router":{"options":{"baseURL":"${origin}/v1"}}}}'`);
    dirs.push(path);
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("private provider detail", { status: 401 }),
    );
    const result = await probeOpenCodeModel({ origin, upstream, env: { PATH: path }, fetchImpl });
    expect(result).toEqual({ ok: false, reason: "http_401" });
  });
});
