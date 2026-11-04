import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fakeOpencodeDir } from "./helpers.js";

// @ts-ignore: bin/ is plain JavaScript outside the tsconfig include; resolved at runtime.
const { opencode, opencodeOutsideGateway } = await import("../bin/clients.mjs");

const origin = "http://127.0.0.1:8791";
// Plain shell one-liners: each overridable fake answers whatever the launcher asks it.
const says = (json: string) => `printf '%s\\n' '${json}'`;

/**
 * What `opencode debug config` printed (OpenCode 1.18.31) for a project whose opencode.json gives
 * `build` and `reviewer` a model, with a third agent defined in .opencode/agent/docs-writer.md,
 * started with a gateway-configured provider. Trimmed to the keys read here.
 */
const resolved = {
  $schema: "https://opencode.ai/config.json",
  model: "jev-gateway/gpt-5",
  small_model: "jev-gateway/gpt-5",
  agent: {
    build: { model: "anthropic/claude-sonnet-4-5", options: {}, permission: {} },
    reviewer: { mode: "subagent", description: "Reviews code.", model: "openai/gpt-5", options: {}, permission: {} },
    "docs-writer": { name: "docs-writer", description: "Writes docs.", mode: "subagent", model: "xai/grok-4", prompt: "You write docs." },
  },
  provider: { "jev-gateway": {} },
};

describe("what jev-opencode says will not go through the gateway", () => {
  it("reads OpenCode v2's agents map, spelled `agents`, as it reads v1's `agent`", () => {
    const v2 = {
      model: "9router/main",
      agents: { explorer: { mode: "subagent", model: "9router/slm" } },
      providers: { "9router": {} },
    };
    const lines = opencodeOutsideGateway(v2 as never, [], origin) as string[];
    expect(lines.join("\n")).toContain("the default model (9router/main)");
    expect(lines.join("\n")).toContain('agent "explorer" (9router/slm)');
  });

  it("reports a provider that still points directly to its upstream", async () => {
    const dir = fakeOpencodeDir(
      says(
        `[{"type":"document","information":{"model":{"providerID":"9router","model":"main"},"agents":{},"providers":{"9router":{"settings":{"baseURL":"http://127.0.0.1:20128/v1"}}}}}]`,
      ),
    );
    try {
      const lines = (await opencode.notices(origin, [], { PATH: dir })) as string[];
      const joined = lines.join("\n");
      expect(joined).toContain("the default model (9router/main)");
      expect(joined).toContain("go straight to their provider");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats default and agent models from the repointed provider as routed", async () => {
    const dir = fakeOpencodeDir(
      says(
        `[{"type":"document","information":{"model":{"providerID":"9router","model":"main"},"agents":{"explorer":{"mode":"subagent","model":{"providerID":"9router","model":"slm"}}},"providers":{"9router":{"settings":{"baseURL":"${origin}/v1"}}}}}]`,
      ),
    );
    try {
      const lines = (await opencode.notices(origin, [], { PATH: dir })) as string[];
      expect(lines).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("v1 keeps the old flow unchanged", async () => {
    const dir = fakeOpencodeDir(says(`{"model":"openai/gpt-5","agent":{},"provider":{"openai":{}}}`));
    try {
      const lines = (await opencode.notices(origin, [], { PATH: dir })) as string[];
      expect(lines.join("\n")).toContain("the default model (openai/gpt-5)");
      expect(lines.join("\n")).not.toContain("environment variables");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports direct providers for the advisor launcher too", async () => {
    const dir = fakeOpencodeDir(says(`{"model":"openai/gpt-5","agent":{},"provider":{"openai":{"options":{}}}}`));
    try {
      const lines = (await opencode.notices(origin, [], { PATH: dir })) as string[];
      expect(lines.join("\n")).toContain("the default model (openai/gpt-5)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts a provider the user pointed at the gateway as covered, by either shape of its endpoint", () => {
    const bySettings = { model: "9router/main", providers: { "9router": { settings: { baseURL: `${origin}` } }, "jev-gateway": {} } };
    expect(opencodeOutsideGateway(bySettings as never, [], origin)).toEqual([]);
    const byOptions = { model: "9router/main", providers: { "9router": { options: { baseURL: `${origin}/v1` } } } };
    expect(opencodeOutsideGateway(byOptions as never, [], origin)).toEqual([]);
  });

  it("keeps an existing gateway provider covered", async () => {
    const dir = fakeOpencodeDir(says(`[{"type":"document","information":{"providers":{"jev-gateway":{}},"model":"jev-gateway/gpt-5"}}]`));
    try {
      const lines = (await opencode.notices(origin, [], { PATH: dir, OPENCODE_CONFIG_CONTENT: "not json" })) as string[];
      expect(lines.join("\n")).not.toContain("OPENCODE_CONFIG_CONTENT");
      expect(lines).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names every agent that selects another provider's model, however it was defined", () => {
    const lines = opencodeOutsideGateway(resolved) as string[];
    expect(lines.join("\n")).toContain('agent "build" (anthropic/claude-sonnet-4-5)');
    expect(lines.join("\n")).toContain('agent "reviewer" (openai/gpt-5)');
    expect(lines.join("\n")).toContain('agent "docs-writer" (xai/grok-4)');
  });

  it("says that agents without a model of their own are covered, so silence is not read as a gap", () => {
    expect((opencodeOutsideGateway(resolved) as string[]).at(-1)).toMatch(/without a model of their own use the default and are covered/);
  });

  it("has nothing to say when every agent uses the default or a gateway model", () => {
    const covered = { ...resolved, agent: { build: {}, plan: { model: "jev-gateway/gpt-5" }, general: { mode: "subagent" } } };
    expect(opencodeOutsideGateway(covered)).toEqual([]);
  });

  it("leaves disabled agents out: they will not run", () => {
    const config = { ...resolved, agent: { reviewer: { model: "openai/gpt-5", disable: true } } };
    expect(opencodeOutsideGateway(config)).toEqual([]);
  });

  it.each([
    [["-m", "anthropic/claude-sonnet-4-5"]],
    [["run", "--model", "anthropic/claude-sonnet-4-5", "fix it"]],
    [["--model=anthropic/claude-sonnet-4-5"]],
  ])("names a --model from another provider, which outranks the default: %j", (argv) => {
    const lines = opencodeOutsideGateway({ ...resolved, agent: {} }, argv) as string[];
    expect(lines.join("\n")).toContain("this session (--model anthropic/claude-sonnet-4-5)");
  });

  it("accepts a --model served by the gateway, and ignores one meant for the prompt after --", () => {
    expect(opencodeOutsideGateway({ ...resolved, agent: {} }, ["-m", "jev-gateway/gpt-5"])).toEqual([]);
    expect(opencodeOutsideGateway({ ...resolved, agent: {} }, ["run", "--", "-m", "openai/gpt-5"])).toEqual([]);
  });

  it("notices a default model that something outranking the launcher replaced", () => {
    const lines = opencodeOutsideGateway({ ...resolved, model: "openai/gpt-5", agent: {} }) as string[];
    expect(lines.join("\n")).toContain("the default model (openai/gpt-5)");
  });

  it("still reports --model when OpenCode could not be asked, and never throws on odd input", () => {
    expect((opencodeOutsideGateway(undefined, ["-m", "openai/gpt-5"]) as string[])[1]).toContain("--model openai/gpt-5");
    expect(opencodeOutsideGateway(undefined)).toEqual([]);
    expect(opencodeOutsideGateway({ ...resolved, agent: { broken: null, odd: { model: 7 } } })).toEqual([]);
  });

  it("counts a provider the user pointed at the gateway as covered, whatever its name", () => {
    const provider = {
      opencode: { options: { baseURL: `${origin}/v1` } },
      anthropic: { options: { baseURL: "https://api.anthropic.com/v1" } },
    };
    const config = {
      ...resolved,
      model: "opencode/grok-code",
      agent: { build: { model: "opencode/grok-code" }, plan: { model: "anthropic/claude-sonnet-4-5" } },
      provider,
    };
    const lines = (opencodeOutsideGateway(config, ["-m", "opencode/grok-code"], origin) as string[]).join("\n");
    expect(lines).not.toContain("grok-code");
    expect(lines).toContain('agent "plan" (anthropic/claude-sonnet-4-5)');
  });

  it("can be switched off, without asking OpenCode anything", async () => {
    expect(await opencode.notices(origin, ["-m", "openai/gpt-5"], { JEV_OPENCODE_CHECK: "off" })).toEqual([]);
  });

  it("reads OpenCode's answer after log lines, even ones with braces, and says nothing when there is no answer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-opencode-"));
    const fake = (script: string) => {
      writeFileSync(join(dir, "opencode"), `#!/bin/sh\n${script}\n`);
      chmodSync(join(dir, "opencode"), 0o755);
    };
    try {
      fake(`printf '%s\\n' 'INFO loading config {path}' '{"model":"openai/gpt-5","agent":{}}'`);
      expect((await opencode.notices(origin, [], { PATH: dir })).join("\n")).toContain("the default model (openai/gpt-5)");
      fake(`printf '%s\\n' 'no configuration here'`);
      expect(await opencode.notices(origin, [], { PATH: dir })).toEqual([]);
      fake("exit 1");
      expect(await opencode.notices(origin, [], { PATH: dir })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("an OPENCODE_CONFIG_CONTENT the user already set", () => {
  const theirs = {
    model: "9router/main",
    permission: { bash: "ask" },
    agent: { reviewer: { mode: "subagent", model: "9router/slm" } },
    provider: {
      "9router": { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://api.openai.com/v1" } },
      local: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://127.0.0.1:11434/v1" } },
    },
  };

  it("keeps the chosen model and repoints only the provider matching the upstream", () => {
    const env = opencode.env(origin, { OPENCODE_CONFIG_CONTENT: JSON.stringify(theirs) });
    const merged = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
    expect(merged.permission).toEqual(theirs.permission);
    expect(merged.agent).toEqual(theirs.agent);
    expect(merged.provider.local).toEqual(theirs.provider.local);
    expect(merged.provider["9router"].options.baseURL).toBe(`${origin}/v1`);
    expect(merged.model).toBe("9router/main");
  });

  it("reaches the launched process through the spec's env", () => {
    const env = opencode.env(origin, { OPENCODE_CONFIG_CONTENT: JSON.stringify(theirs) });
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT).permission).toEqual(theirs.permission);
  });

  it("keeps JSONC values and the chosen model while repointing its provider", () => {
    const jsonc = `{
      // ask before running commands
      "permission": { "bash": "ask", },
      /* a local model */
      "model": "9router/main",
      "provider": { "9router": { "options": { "baseURL": "https://api.openai.com/v1" } } },
    }`;
    const merged = JSON.parse(opencode.env(origin, { OPENCODE_CONFIG_CONTENT: jsonc }).OPENCODE_CONFIG_CONTENT);
    expect(merged.permission).toEqual({ bash: "ask" });
    expect(merged.provider["9router"].options.baseURL).toBe(`${origin}/v1`);
    expect(merged.model).toBe("9router/main");
  });

  it.each(["", "   ", "not json", "[1, 2]", "null", '"text"'])("leaves content %j unchanged when it is not an object", (content) => {
    expect(opencode.env(origin, { OPENCODE_CONFIG_CONTENT: content }).OPENCODE_CONFIG_CONTENT).toBe(content);
  });

  it("has no bypass summary when the check is switched off", async () => {
    const lines = await opencode.notices(origin, [], { JEV_OPENCODE_CHECK: "off", OPENCODE_CONFIG_CONTENT: "{ not json" });
    expect(lines).toEqual([]);
    expect(await opencode.notices(origin, [], { JEV_OPENCODE_CHECK: "off", OPENCODE_CONFIG_CONTENT: '{ "model": "x", }' })).toEqual([]);
  });
});
