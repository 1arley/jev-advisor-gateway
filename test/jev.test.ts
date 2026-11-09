import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createAskJev, resolveModel, resolveProvider } from "../src/jev.js";

const request = {
  model: "m",
  state: "s",
  questions: { tool: { type: "choice" as const, instructions: "?", criteria: { a: null, b: null } } },
};

function capture(reply: () => Response) {
  const calls: { url: string; headers: Headers; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return reply();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("choosing a provider", () => {
  it("follows whichever key is present, TypeSafe's own first, unless JEV_PROVIDER says otherwise", () => {
    expect(resolveProvider({})).toBe("typesafe");
    expect(resolveProvider({ OPENROUTER_API_KEY: "k" })).toBe("openrouter");
    expect(resolveProvider({ AI_GATEWAY_API_KEY: "k" })).toBe("vercel");
    expect(resolveProvider({ OPENCODE_API_KEY: "k" })).toBe("opencode");
    expect(resolveProvider({ OPENCODE_API_KEY: "k", TYPESAFE_API_KEY: "k" })).toBe("typesafe");
    expect(resolveProvider({ TYPESAFE_API_KEY: "k", OPENROUTER_API_KEY: "k" })).toBe("typesafe");
    expect(resolveProvider({ TYPESAFE_API_KEY: "k", OPENROUTER_API_KEY: "k", JEV_PROVIDER: "OpenRouter" })).toBe("openrouter");
    expect(() => resolveProvider({ JEV_PROVIDER: "acme" })).toThrow(/JEV_PROVIDER/);
  });

  it("never sends one provider's model id to another", () => {
    expect(resolveModel("typesafe", undefined)).toBe("jev-latest");
    expect(resolveModel("typesafe", "jev-1.13.0")).toBe("jev-1.13.0");
    expect(resolveModel("openrouter", "jev-latest")).toBe("typesafe/jev-1.13");
    expect(resolveModel("openrouter", "typesafe/jev-1.13-20260917")).toBe("typesafe/jev-1.13-20260917");
    expect(resolveModel("typesafe", "typesafe-ai/jev")).toBe("jev-latest");
    expect(resolveModel("opencode", undefined)).toBe("jev-1.13-free");
    expect(resolveModel("opencode", "jev-1.13")).toBe("jev-1.13");
    expect(resolveModel("opencode", "jev-latest")).toBe("jev-1.13-free");
    expect(resolveModel("typesafe", "jev-1.13-free")).toBe("jev-latest");
    expect(resolveModel("opencode", "typesafe/jev-1.13")).toBe("jev-1.13-free");
  });

  it("takes a model id it has not heard of when it has the provider's shape", () => {
    expect(resolveModel("typesafe", "jev-1.14")).toBe("jev-1.14");
    expect(resolveModel("openrouter", "typesafe/jev-1.14-20261001")).toBe("typesafe/jev-1.14-20261001");
    expect(resolveModel("vercel", "typesafe-ai/jev-1.14")).toBe("typesafe-ai/jev-1.14");
    expect(resolveModel("opencode", "jev-1.14")).toBe("jev-1.13-free");
  });

  it("reads the matching key, endpoint and model into the config", () => {
    const config = loadConfig({ AI_GATEWAY_API_KEY: "vck", JEV_MODEL: "jev-latest" });
    expect(config).toMatchObject({
      jevProvider: "vercel",
      jevApiKey: "vck",
      jevModel: "typesafe-ai/jev",
      jevUrl: "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
    });
    expect(loadConfig({ OPENROUTER_API_KEY: "ork" }).jevUrl).toBe("https://openrouter.ai/api/alpha/decisions");
    // The variable TypeSafe's SDK reads still points a local stand-in at the gateway.
    expect(loadConfig({ TYPESAFE_API_KEY: "k", TYPESAFE_BASE_URL: "http://127.0.0.1:8799/" }).jevUrl).toBe(
      "http://127.0.0.1:8799/v1/systemone",
    );
  });

  it("keeps active Laya endpoints loopback-only and free of URL credentials or parameters", () => {
    expect(loadConfig({ JEV_PROVIDER: "laya", JEV_URL: "http://127.0.0.1:9200/v1/systemone" }).jevUrl).toBe(
      "http://127.0.0.1:9200/v1/systemone",
    );
    for (const jevUrl of [
      "https://collector.example/v1/systemone",
      "http://user@127.0.0.1:8000/v1/systemone",
      "http://127.0.0.1:8000/v1/systemone?forward=1",
      "http://127.0.0.1:8000/v1/systemone#fragment",
      "http://127.0.0.1:8000/other",
    ]) {
      expect(() => loadConfig({ JEV_PROVIDER: "laya", JEV_URL: jevUrl })).toThrow(/JEV_URL/);
    }
  });

  it("keeps OpenJev on its local System One endpoint", () => {
    expect(loadConfig({ JEV_PROVIDER: "openjev" }).jevUrl).toBe("http://localhost:6767/v1/systemone");
    expect(() => loadConfig({ JEV_PROVIDER: "openjev", JEV_URL: "https://remote.example/v1/systemone" })).toThrow(/JEV_URL/);
    expect(() => loadConfig({ JEV_PROVIDER: "openjev", JEV_URL: "http://localhost:6767/other" })).toThrow(/JEV_URL/);
  });

  it("requires Headroom to be explicitly loopback and pins its deadline", () => {
    expect(loadConfig({ JEV_HEADROOM_MODE: "shadow", JEV_HEADROOM_URL: "http://127.0.0.1:8788/v1/compress" })).toMatchObject({
      headroomMode: "shadow",
      headroomTimeoutMs: 500,
    });
    expect(() => loadConfig({ JEV_HEADROOM_MODE: "compress" })).toThrow(/JEV_HEADROOM_URL is required/);
    for (const headroomUrl of [
      "https://headroom.example/v1/compress",
      "http://127.0.0.1:8788/v1/compress?forward=1",
      "http://user@127.0.0.1:8788/v1/compress",
    ]) {
      expect(() => loadConfig({ JEV_HEADROOM_URL: headroomUrl })).toThrow(/JEV_HEADROOM_URL/);
    }
    expect(() => loadConfig({ JEV_HEADROOM_TIMEOUT_MS: "5001" })).toThrow(/JEV_HEADROOM_TIMEOUT_MS/);
  });

  it("uses OpenCode's free model unless the paid one is selected", () => {
    expect(loadConfig({ OPENCODE_API_KEY: "ock" })).toMatchObject({
      jevProvider: "opencode",
      jevApiKey: "ock",
      jevModel: "jev-1.13-free",
      jevUrl: "https://opencode.ai/zen/v1/systemone",
    });
    expect(loadConfig({ OPENCODE_API_KEY: "ock", JEV_MODEL: "jev-1.13" }).jevModel).toBe("jev-1.13");
    expect(loadConfig({ OPENCODE_API_KEY: "ock", JEV_MODEL: "jev-latest" }).jevModel).toBe("jev-1.13-free");
  });
});

describe("asking Jev", () => {
  const answer = {
    model: "m",
    answers: { tool: { type: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } } },
    usage: { input_tokens: 10, output_tokens: 0 },
  };

  it("posts the same body to whichever provider, with its key as a bearer token", async () => {
    for (const env of [{ TYPESAFE_API_KEY: "k1" }, { OPENROUTER_API_KEY: "k2" }, { AI_GATEWAY_API_KEY: "k3" }]) {
      const config = loadConfig(env);
      const { calls, fetchImpl } = capture(() => Response.json(answer));
      const result = await createAskJev(config, fetchImpl)(request);
      expect(calls[0]!.url).toBe(config.jevUrl);
      expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${Object.values(env)[0]}`);
      expect(calls[0]!.body).toEqual(request);
      expect(result.answers.tool).toMatchObject({ choice: "a", confidence: 0.9 });
    }
  });

  it("stands the winning probability in for a missing confidence, and a missing usage for zero", async () => {
    const bare = { answers: { tool: { type: "choice", choice: "a", probabilities: { a: 0.8, b: 0.2 } } } };
    const { fetchImpl } = capture(() => Response.json(bare));
    const result = await createAskJev(loadConfig({ AI_GATEWAY_API_KEY: "k" }), fetchImpl)(request);
    expect(result.answers.tool).toMatchObject({ confidence: 0.8 });
    expect(result.usage.input_tokens).toBe(0);
  });

  it("retries an overloaded provider once and gives up at once on a refused key", async () => {
    let attempts = 0;
    const flaky = capture(() => (++attempts === 1 ? new Response("busy", { status: 529 }) : Response.json(answer)));
    await createAskJev(loadConfig({ TYPESAFE_API_KEY: "k" }), flaky.fetchImpl)(request);
    expect(flaky.calls).toHaveLength(2);

    const refused = capture(() => new Response("bad key", { status: 401 }));
    await expect(createAskJev(loadConfig({ TYPESAFE_API_KEY: "k" }), refused.fetchImpl)(request)).rejects.toThrow(/401 from TypeSafe/);
    expect(refused.calls).toHaveLength(1);
  });

  it("says which variable to set when there is no key", () => {
    expect(() => createAskJev(loadConfig({ JEV_PROVIDER: "openrouter" }))).toThrow(/OPENROUTER_API_KEY/);
  });
});

describe("asking Laya locally", () => {
  const answer = {
    model: "m",
    answers: {
      tool: { type: "choice", choice: "a", confidence: 0.5, x_jev_confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } },
      needs_tool: { type: "noul", noul: 0.9 },
    },
    usage: { input_tokens: 10, output_tokens: 0 },
  };

  it("defaults to the calibrated typed-decisions checkpoint and native policy", () => {
    const config = loadConfig({ JEV_PROVIDER: "laya" });
    expect(config).toMatchObject({
      jevModel: "typed-decisions",
      layaRoutingPolicy: "native",
      layaCalibration: {
        checkpoint: "typed-decisions",
        policy: "native",
        buckets: { default: { threshold: 0.5118, samples: 32 } },
      },
    });
    expect(loadConfig({ JEV_PROVIDER: "laya", JEV_MODEL: "english", JEV_LAYA_ROUTING_POLICY: "legacy" })).toMatchObject({
      jevModel: "english",
      layaRoutingPolicy: "legacy",
    });
  });

  it("answers with no key at all, and sends no Authorization header unless one is configured", async () => {
    const keyless = loadConfig({ JEV_PROVIDER: "laya", JEV_LAYA_ROUTING_POLICY: "legacy" });
    expect(keyless).toMatchObject({
      jevProvider: "laya",
      jevApiKey: undefined,
      jevModel: "typed-decisions",
      jevUrl: "http://127.0.0.1:8000/v1/systemone",
      maxStateChars: 7_000,
      maxMessageChars: 1_500,
      jevMaxLen: 2_048,
      jevTimeoutMs: 8_000,
      onNone: "passthrough",
    });
    expect(loadConfig({ JEV_PROVIDER: "laya", JEV_ON_NONE: "force_none" }).onNone).toBe("force_none");
    expect(loadConfig({ TYPESAFE_API_KEY: "k" }).onNone).toBe("force_none");
    expect(loadConfig({ JEV_PROVIDER: "laya", JEV_TIMEOUT_MS: "4000" }).jevTimeoutMs).toBe(8_000);
    expect(loadConfig({ JEV_PROVIDER: "laya", JEV_LAYA_TIMEOUT_MS: "9000" }).jevTimeoutMs).toBe(9_000);
    const { calls, fetchImpl } = capture(() => Response.json(answer));
    const result = await createAskJev(keyless, fetchImpl)(request);
    expect(calls[0]!.headers.get("authorization")).toBeNull();
    // x_jev_confidence stands in for Laya's entropy confidence: it is the scale the thresholds count on.
    expect(result.answers.tool).toMatchObject({ choice: "a", confidence: 0.9 });
    expect(result.answers.needs_tool).toMatchObject({ noul: 0.9 });

    const withKey = loadConfig({ JEV_PROVIDER: "laya", LAYA_API_KEY: "k" });
    const keyed = capture(() => Response.json(answer));
    await createAskJev(withKey, keyed.fetchImpl)(request);
    expect(keyed.calls[0]!.headers.get("authorization")).toBe("Bearer k");
  });

  it("sends Laya's configured max_len while leaving other providers' bodies unchanged", async () => {
    const laya = loadConfig({ JEV_PROVIDER: "laya" });
    const { calls: layaCalls, fetchImpl: layaFetch } = capture(() => Response.json(answer));
    await createAskJev(laya, layaFetch)(request);
    expect(layaCalls[0]!.body).toEqual({ ...request, max_len: 2_048 });

    const configured = loadConfig({ JEV_PROVIDER: "laya", JEV_LAYA_MAX_LEN: "4096" });
    const override = capture(() => Response.json(answer));
    await createAskJev(configured, override.fetchImpl)(request);
    expect(override.calls[0]!.body.max_len).toBe(4_096);

    const other = loadConfig({ TYPESAFE_API_KEY: "k" });
    const { calls: otherCalls, fetchImpl: otherFetch } = capture(() => Response.json(answer));
    await createAskJev(other, otherFetch)(request);
    expect(otherCalls[0]!.body).toEqual(request);
    expect(otherCalls[0]!.body).not.toHaveProperty("max_len");
    expect(loadConfig({ TYPESAFE_API_KEY: "k" })).toMatchObject({ maxStateChars: 60_000, maxMessageChars: 4_000 });
    expect(loadConfig({ TYPESAFE_API_KEY: "k", JEV_LAYA_TIMEOUT_MS: "9000" }).jevTimeoutMs).toBe(8_000);
  });

  it("keeps Laya and hosted-provider size limits independent", () => {
    expect(loadConfig({ JEV_PROVIDER: "laya", JEV_MAX_STATE_CHARS: "60000", JEV_MAX_MESSAGE_CHARS: "4000" })).toMatchObject({
      maxStateChars: 7_000,
      maxMessageChars: 1_500,
    });
    expect(loadConfig({ JEV_PROVIDER: "laya", JEV_LAYA_MAX_STATE_CHARS: "8000", JEV_LAYA_MAX_MESSAGE_CHARS: "1800" })).toMatchObject({
      maxStateChars: 8_000,
      maxMessageChars: 1_800,
    });
    expect(loadConfig({ TYPESAFE_API_KEY: "k", JEV_LAYA_MAX_STATE_CHARS: "8000", JEV_LAYA_MAX_MESSAGE_CHARS: "1800" })).toMatchObject({
      maxStateChars: 60_000,
      maxMessageChars: 4_000,
    });
    expect(loadConfig({ JEV_PROVIDER: "opencode", JEV_MAX_STATE_CHARS: "12000" })).toMatchObject({
      maxStateChars: 12_000,
      maxMessageChars: 4_000,
    });
  });

  it("keeps Jiwo model names and validates its loopback URL", () => {
    expect(resolveModel("jiwo", undefined)).toBe("jiwo-0.8b");
    expect(resolveModel("jiwo", "jiwo-4b")).toBe("jiwo-4b");
    expect(loadConfig({ JEV_PROVIDER: "jiwo" })).toMatchObject({
      jevProvider: "jiwo",
      jevUrl: "http://127.0.0.1:8765/v1/systemone",
      jiwoMaxStateChars: 7_000,
    });
    expect(() => loadConfig({ JEV_PROVIDER: "jiwo", JEV_URL: "https://remote.example/v1/systemone" })).toThrow(/JEV_URL/);
  });

  it("requires Kev's documented System One endpoint on loopback", () => {
    expect(loadConfig({ JEV_PROVIDER: "kev" })).toMatchObject({
      jevProvider: "kev",
      jevUrl: "http://127.0.0.1:8009/v1/systemone",
      jevModel: "kev-latest",
    });
    expect(loadConfig({ JEV_PROVIDER: "kev", JEV_URL: "http://localhost:8009/v1/systemone/" }).jevUrl).toBe(
      "http://localhost:8009/v1/systemone/",
    );
    for (const jevUrl of ["http://127.0.0.1:8009/", "http://127.0.0.1:8009/v1/other"]) {
      expect(() => loadConfig({ JEV_PROVIDER: "kev", JEV_URL: jevUrl })).toThrow(/JEV_URL.*\/v1\/systemone/);
    }
  });

  it("sends Jiwo bounded text-only state and no provider attribution headers", async () => {
    const config = loadConfig({ JEV_PROVIDER: "jiwo" });
    const jiwoRequest = {
      model: config.jevModel,
      state: {
        assistant_instructions: "synthetic rules",
        conversation: [
          { role: "user", content: "choose a" },
          { role: "tool_result", content: "private tool output" },
          { role: "assistant", content: "synthetic reply" },
        ],
      },
      questions: {
        tool: { type: "choice" as const, instructions: "pick", criteria: { a: null, b: null } },
        needs_tool: { type: "noul" as const, instructions: "need one" },
      },
    };
    const { calls, fetchImpl } = capture(() =>
      Response.json({
        model: "jiwo-0.8b",
        answers: { tool: { type: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } } },
        usage: { input_tokens: 12, output_tokens: 0 },
      }),
    );

    const result = await createAskJev(config, fetchImpl)(jiwoRequest);
    const body = calls[0]!.body;
    expect(body.questions).toEqual({ tool: jiwoRequest.questions.tool });
    expect(JSON.parse(body.state)).toEqual({
      assistant_instructions: "synthetic rules",
      conversation: [
        { role: "user", content: "choose a" },
        { role: "assistant", content: "synthetic reply" },
      ],
    });
    expect(calls[0]!.headers.get("authorization")).toBeNull();
    expect(calls[0]!.headers.get("http-referer")).toBeNull();
    expect(result.answers.needs_tool).toEqual({ type: "noul", noul: 1 });
  });

  it("does not retry an invalid Jiwo response", async () => {
    const config = loadConfig({ JEV_PROVIDER: "jiwo" });
    const { calls, fetchImpl } = capture(() => Response.json({ answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }));
    await expect(createAskJev(config, fetchImpl)({ ...request, state: { conversation: [] } })).rejects.toThrow("jiwo_partial_response");
    expect(calls).toHaveLength(1);
  });

  it("accepts a valid Jiwo response through the configured endpoint", async () => {
    const config = loadConfig({ JEV_PROVIDER: "jiwo" });
    const jiwoAnswer = {
      model: "jiwo-0.8b",
      answers: { tool: { type: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } } },
      usage: { input_tokens: 10, output_tokens: 0 },
    };
    const { calls, fetchImpl } = capture(() => Response.json(jiwoAnswer));
    const result = await createAskJev(config, fetchImpl)({ ...request, state: { conversation: [] } });

    expect(calls[0]!.url).toBe(config.jevUrl);
    expect(result.answers.tool).toMatchObject({ choice: "a", confidence: 0.9 });
  });

  it("pins JEV_MODEL to a checkpoint Laya actually serves", () => {
    expect(resolveModel("laya", undefined)).toBe("typed-decisions");
    expect(resolveModel("laya", "english")).toBe("english");
    expect(resolveModel("laya", "typed-decisions")).toBe("typed-decisions");
    expect(resolveModel("laya", "jev-latest")).toBe("typed-decisions");
    expect(resolveModel("laya", "typesafe/jev-1.13")).toBe("typed-decisions");
  });

  it("names the local checkpoint in the config when only an optional key is present", () => {
    expect(resolveProvider({ LAYA_API_KEY: "k" })).toBe("laya");
    expect(resolveProvider({ TYPESAFE_API_KEY: "k", LAYA_API_KEY: "k" })).toBe("typesafe");
    expect(loadConfig({ JEV_PROVIDER: "laya", JEV_URL: "http://127.0.0.1:9200/v1/systemone" }).jevUrl).toBe(
      "http://127.0.0.1:9200/v1/systemone",
    );
  });
});

describe("OpenCode model availability", () => {
  const answer = {
    model: "m",
    answers: { tool: { type: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } } },
    usage: { input_tokens: 10, output_tokens: 0 },
  };

  it.each([404, 410])("passes through when the free model returns %i without calling the paid model", async (status) => {
    const config = loadConfig({ OPENCODE_API_KEY: "ock" });
    const { calls, fetchImpl } = capture(() => new Response("model not found ".repeat(20), { status }));
    const ask = createAskJev(config, fetchImpl);
    const error = await ask({ ...request, model: config.jevModel }).catch((caught: Error) => caught);
    if (!(error instanceof Error)) throw new Error("Expected the free model call to fail");
    expect(error.message.slice(0, 100)).toContain("JEV_MODEL=jev-1.13");
    expect(calls.map((call) => call.body.model)).toEqual(["jev-1.13-free"]);
  });

  it("uses the paid model when explicitly selected", async () => {
    const config = loadConfig({ OPENCODE_API_KEY: "ock", JEV_MODEL: "jev-1.13" });
    const { calls, fetchImpl } = capture(() => Response.json(answer));
    await createAskJev(config, fetchImpl)({ ...request, model: config.jevModel });
    expect(calls.map((call) => call.body.model)).toEqual(["jev-1.13"]);
  });

  it.each([429, 500, 503])("stays on the free model when it answers %i, which says nothing about the model", async (status) => {
    const config = loadConfig({ OPENCODE_API_KEY: "ock" });
    const { calls, fetchImpl } = capture(() => new Response("busy", { status }));
    await expect(createAskJev(config, fetchImpl)({ ...request, model: config.jevModel })).rejects.toThrow(`${status} from OpenCode`);
    expect(calls.map((call) => call.body.model)).toEqual(["jev-1.13-free", "jev-1.13-free"]);
  });

  it("stays on the free model when it is only slow", async () => {
    const config = loadConfig({ OPENCODE_API_KEY: "ock" });
    const models: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      models.push(JSON.parse(String(init.body)).model);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(createAskJev(config, fetchImpl)({ ...request, model: config.jevModel })).rejects.toThrow(/timeout/);
    expect(models).toEqual(["jev-1.13-free", "jev-1.13-free"]);
  });

  it.each(["TimeoutError", "AbortError"])("does not retry a Laya %s but retries a refused local connection", async (name) => {
    const config = loadConfig({ JEV_PROVIDER: "laya" });
    let calls = 0;
    const timeout = (async () => {
      calls++;
      throw new DOMException("Timed out", name);
    }) as unknown as typeof fetch;
    await expect(createAskJev(config, timeout)(request)).rejects.toThrow("Timed out");
    expect(calls).toBe(1);

    calls = 0;
    const refused = (async () => {
      calls++;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(createAskJev(config, refused)(request)).rejects.toThrow("fetch failed");
    expect(calls).toBe(2);
  });

  it("does not retry a refused key", async () => {
    const config = loadConfig({ OPENCODE_API_KEY: "ock" });
    const { calls, fetchImpl } = capture(() => new Response("bad key", { status: 401 }));
    await expect(createAskJev(config, fetchImpl)({ ...request, model: config.jevModel })).rejects.toThrow(/401 from OpenCode/);
    expect(calls).toHaveLength(1);
  });
});
