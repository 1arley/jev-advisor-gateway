import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-ignore: bin/ is plain JavaScript outside the tsconfig include; resolved at runtime.
const clients = await import("../bin/clients.mjs");
// @ts-ignore: bin/ is plain JavaScript outside the tsconfig include; resolved at runtime.
const { loadEnv } = await import("../bin/launcher.mjs");

interface LauncherSpec {
  name: string;
  client: string;
  portEnv: string;
  defaultPort: number;
  gatewayEnv?: Record<string, string> | (() => Record<string, string>);
  upstream: () => string;
  upstreamHelp: string;
  args?: (origin: string) => string[];
  env?: (origin: string) => Record<string, string>;
  configHelp: (origin: string, env?: Record<string, string>) => string | Promise<string>;
}

const opencode = clients.opencode as LauncherSpec;
const opencodeAdvisor = clients.opencodeAdvisor as LauncherSpec;
const codex = clients.codex as LauncherSpec;
const codexAdvisor = clients.codexAdvisor as LauncherSpec;
const claude = clients.claude as LauncherSpec;
const devin = clients.devin as LauncherSpec;
const agy = clients.agy as LauncherSpec;
const agyAdvisor = clients.agyAdvisor as LauncherSpec;

const origin = "http://127.0.0.1:8791";
const launcherBin = fileURLToPath(new URL("../bin/jev-opencode.mjs", import.meta.url));
const agyLauncherBin = fileURLToPath(new URL("../bin/jev-agy.mjs", import.meta.url));

const managedEnv = [
  "OPENCODE_CONFIG_CONTENT",
  "JEV_OPENCODE_UPSTREAM_BASE_URL",
  "JEV_CODEX_UPSTREAM_BASE_URL",
  "JEV_CLAUDE_UPSTREAM_BASE_URL",
  "JEV_DEVIN_UPSTREAM_BASE_URL",
  "JEV_ADVISOR_MODEL",
  "CODEX_HOME",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of managedEnv) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of managedEnv) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("jev-opencode spec", () => {
  it("identifies itself as the opencode launcher on its own port", () => {
    expect(opencode.name).toBe("jev-opencode");
    // launcher.mjs spawns the gateway with JEV_CLIENT: spec.client, so this is what reaches it.
    expect(opencode.client).toBe("opencode");
    expect(opencode.portEnv).toBe("JEV_OPENCODE_PORT");
    expect(opencode.defaultPort).toBe(8791);
    expect([codex.defaultPort, claude.defaultPort]).not.toContain(opencode.defaultPort);
  });

  it("defaults upstream to OpenAI with a JEV_OPENCODE_UPSTREAM_BASE_URL override", () => {
    expect(opencode.upstream()).toBe("https://api.openai.com/v1");
    process.env.JEV_OPENCODE_UPSTREAM_BASE_URL = "https://llm.test/v1";
    expect(opencode.upstream()).toBe("https://llm.test/v1");
    expect(opencode.upstreamHelp).toContain("JEV_OPENCODE_UPSTREAM_BASE_URL");
  });

  it("does not inject a provider or change OpenCode's model choice", () => {
    const env = opencode.env!(origin);
    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain("jev-gateway");
    expect(JSON.stringify(env)).not.toContain("gpt-5");
  });

  it("keeps the experimental native LLM and code modes disabled for the launched process", () => {
    const env = opencode.env!(origin);
    expect(env.OPENCODE_EXPERIMENTAL_NATIVE_LLM).toBe("false");
    expect(env.OPENCODE_EXPERIMENTAL_CODE_MODE).toBe("false");
  });

  it("adds no leading client args, so user flags (including -m) forward untouched", () => {
    // launcher.mjs appends the raw argv after spec.args; the selected model is never rewritten.
    expect(opencode.args).toBeUndefined();
    expect(typeof opencode.env).toBe("function");
  });

  it("explains the automatic backup and temporary provider repoint", async () => {
    const help = await opencode.configHelp(origin);
    expect(help).toContain(`${origin}/v1`);
    expect(help).toContain("opencode.json");
    expect(help).toContain("jev-opencode --start");
    expect(help).toContain("jev-opencode --stop");
    expect(help).toContain("Model IDs");
  });
});

describe("per-client launcher env", () => {
  it("overlays the client env file while preserving shell and base-file precedence", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-client-env-"));
    const project = join(dir, "project.env");
    const base = join(dir, "base.env");
    writeFileSync(project, "JEV_OPENCODE_UPSTREAM_BASE_URL=https://project.test/v1\nFROM_PROJECT=yes\n");
    writeFileSync(base, "JEV_OPENCODE_UPSTREAM_BASE_URL=https://base.test/v1\nFROM_BASE=yes\n");
    writeFileSync(
      join(dir, ".env.opencode"),
      "JEV_OPENCODE_UPSTREAM_BASE_URL=http://127.0.0.1:20128/v1\nFROM_CLIENT=yes\nSHELL_WINS=file\n",
    );
    const env = { SHELL_WINS: "shell" };
    try {
      loadEnv("opencode", env, [project, base], dir);
      expect(env).toEqual({
        SHELL_WINS: "shell",
        JEV_OPENCODE_UPSTREAM_BASE_URL: "http://127.0.0.1:20128/v1",
        FROM_PROJECT: "yes",
        FROM_BASE: "yes",
        FROM_CLIENT: "yes",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("jev-opencode entrypoint", () => {
  it("is registered in package.json with a runnable script", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as any;
    expect(pkg.bin["jev-opencode"]).toBe("bin/jev-opencode.mjs");
    expect(pkg.scripts.opencode).toBe("node bin/jev-opencode.mjs");
  });

  it("--gateway-help describes the opencode launcher without starting anything", () => {
    const out = execFileSync(process.execPath, [launcherBin, "--gateway-help"], { encoding: "utf8", timeout: 30_000 });
    expect(out).toContain("jev-opencode: opencode with tool selection routed through Jev");
    expect(out).toContain("--print-config");
  });

  it("--print-config explains transparent routing without starting anything", () => {
    const out = execFileSync(process.execPath, [launcherBin, "--print-config"], { encoding: "utf8", timeout: 30_000 });
    expect(out).toContain("http://127.0.0.1:8791/v1");
    expect(out).toContain("Model IDs");
  });
});

describe("jev-devin spec", () => {
  it("identifies itself as the devin launcher on its own port", () => {
    expect(devin.name).toBe("jev-devin");
    expect(devin.client).toBe("devin");
    expect(devin.portEnv).toBe("JEV_DEVIN_PORT");
    expect(devin.defaultPort).toBe(8792);
    expect([codex.defaultPort, claude.defaultPort, opencode.defaultPort]).not.toContain(devin.defaultPort);
  });

  it("defaults upstream to the exa backend with a JEV_DEVIN_UPSTREAM_BASE_URL override", () => {
    expect(devin.upstream()).toBe("https://server.codeium.com");
    process.env.JEV_DEVIN_UPSTREAM_BASE_URL = "https://exa.test";
    expect(devin.upstream()).toBe("https://exa.test");
    expect(devin.upstreamHelp).toContain("JEV_DEVIN_UPSTREAM_BASE_URL");
  });

  it("points the CLI at the gateway through the variable compiled into it", () => {
    // The name is a leftover from the binary's windsurf backend; there is no DEVIN_* equivalent.
    expect(devin.env!(origin)).toEqual({ WINDSURF_API_SERVER_URL: origin });
    expect(devin.configHelp(origin)).toContain(`WINDSURF_API_SERVER_URL=${origin}`);
    expect(devin.configHelp(origin)).toContain("jev-devin --start");
  });
});

describe("jev-devin entrypoint", () => {
  it("is registered in package.json with a runnable script", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as any;
    expect(pkg.bin["jev-devin"]).toBe("bin/jev-devin.mjs");
    expect(pkg.scripts.devin).toBe("node bin/jev-devin.mjs");
    expect(pkg.keywords).toContain("devin");
  });
});

describe("Antigravity launchers", () => {
  it("preserves the selected model and separates advisor settings", () => {
    expect(agy.name).toBe("jev-agy");
    expect(agy.client).toBe("agy");
    expect(agy.portEnv).toBe("JEV_AGY_PORT");
    const gatewayEnv = typeof agy.gatewayEnv === "function" ? agy.gatewayEnv() : agy.gatewayEnv;
    expect(gatewayEnv).toMatchObject({ JEV_ADVISOR: "off", JEV_ADVISOR_MODEL: "gemini-3.1-pro-preview" });
    expect(agy.env!(origin).GOOGLE_GEMINI_BASE_URL).toBe(origin);
    expect(agyAdvisor.name).toBe("jev-agy-advisor");
    expect(agyAdvisor.portEnv).toBe("JEV_AGY_ADVISOR_PORT");
    const advisorEnv = typeof agyAdvisor.gatewayEnv === "function" ? agyAdvisor.gatewayEnv() : agyAdvisor.gatewayEnv;
    expect(advisorEnv).toMatchObject({ JEV_ADVISOR: "on", JEV_ADVISOR_MODEL: "gemini-3.1-pro-preview" });
    process.env.JEV_ADVISOR_MODEL = "gemini-2.5-pro";
    expect((agy.gatewayEnv as () => Record<string, string>)()).toMatchObject({ JEV_ADVISOR_MODEL: "gemini-2.5-pro" });
    expect((agyAdvisor.gatewayEnv as () => Record<string, string>)()).toMatchObject({ JEV_ADVISOR_MODEL: "gemini-2.5-pro" });
    expect(agyAdvisor.configHelp(origin)).toContain("JEV_ADVISOR_MODEL");
  });

  it("merges inline settings, accepts only compatible files and rejects duplicates", () => {
    const args = clients.agyClientArgs as (args: string[]) => string[];
    expect(args(["--settings", '{"model":"gemini-2.5-pro","other":true}', "--prompt", "hello"])).toEqual([
      "--settings",
      '{"model":"gemini-2.5-pro","other":true,"modelProvider":"gemini"}',
      "--prompt",
      "hello",
    ]);
    const dir = mkdtempSync(join(tmpdir(), "jev-agy-settings-"));
    const file = join(dir, "settings.json");
    try {
      writeFileSync(file, '{"modelProvider":"gemini","model":"gemini-2.5-pro"}');
      expect(args(["--settings", file])).toEqual(["--settings", file]);
      writeFileSync(file, '{"modelProvider":"other"}');
      expect(() => args(["--settings", file])).toThrow("modelProvider to gemini");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(() => args(["--settings", "{}", "--settings", "{}"])).toThrow("one --settings option");
  });

  it("registers both commands and provides launcher help", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as any;
    expect(pkg.bin["jev-agy"]).toBe("bin/jev-agy.mjs");
    expect(pkg.bin["jev-agy-advisor"]).toBe("bin/jev-agy-advisor.mjs");
    expect(pkg.scripts.agy).toBe("node bin/jev-agy.mjs");
    expect(pkg.scripts["agy-advisor"]).toBe("node bin/jev-agy-advisor.mjs");
    const out = execFileSync(process.execPath, [agyLauncherBin, "--gateway-help"], { encoding: "utf8", timeout: 30_000 });
    expect(out).toContain("jev-agy: agy with tool selection routed through Jev");
    expect(out).toContain("JEV_AGY_PORT");
  });
});

describe("existing launchers", () => {
  it("keeps the codex and claude specs intact", () => {
    expect(codex.name).toBe("jev-codex");
    expect(codex.client).toBe("codex");
    expect(codex.defaultPort).toBe(8794);
    expect(codex.gatewayEnv).toEqual({ JEV_ADVISOR: "off" });
    // No readable login (CODEX_HOME is pointed at nothing): falls back to the API backend.
    process.env.CODEX_HOME = "/nonexistent-jev-test-dir";
    expect(codex.upstream()).toBe("https://api.openai.com/v1");
    expect(codex.args!(origin).join(" ")).toContain('model_provider="jev-codex"');
    expect(codex.args!(origin).join(" ")).not.toContain("gpt-6-luna");
    expect(codex.configHelp(origin)).not.toContain("[profiles.jev]");

    expect(codexAdvisor.name).toBe("jev-codex-advisor");
    expect(codexAdvisor.defaultPort).toBe(8790);
    expect(codexAdvisor.gatewayEnv).toEqual({ JEV_ADVISOR: "on" });
    expect(codexAdvisor.args!(origin).join(" ")).toContain('model="gpt-6-luna"');
    expect(codexAdvisor.configHelp(origin)).toContain("[profiles.jev]");

    expect(claude.name).toBe("jev-claude");
    expect(claude.client).toBe("claude");
    expect(claude.defaultPort).toBe(8789);
    expect(claude.upstream()).toBe("https://api.anthropic.com/v1");
    expect(claude.env!(origin)).toEqual({ ANTHROPIC_BASE_URL: origin });
  });
});

describe("OpenCode advisor launcher", () => {
  it("uses a separate port and enables the advisor for OpenCode", () => {
    expect(opencodeAdvisor.name).toBe("jev-opencode-advisor");
    expect(opencodeAdvisor.client).toBe("opencode");
    expect(opencodeAdvisor.portEnv).toBe("JEV_OPENCODE_ADVISOR_PORT");
    expect(opencodeAdvisor.defaultPort).not.toBe(opencode.defaultPort);
    expect(opencodeAdvisor.gatewayEnv).toEqual({ JEV_ADVISOR: "on" });

    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as any;
    expect(pkg.bin["jev-opencode-advisor"]).toBe("bin/jev-opencode-advisor.mjs");
    expect(pkg.scripts["opencode-advisor"]).toBe("node bin/jev-opencode-advisor.mjs");
  });
});
