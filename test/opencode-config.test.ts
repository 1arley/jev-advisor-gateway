import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// @ts-ignore: bin/ is plain JavaScript outside the tsconfig include; resolved at runtime.
const { parseJsonc, repointOpenCodeConfig, repointOpenCodeOverlay, restoreOpenCodeConfig } = await import("../bin/opencode-config.mjs");
const readConfig = (path: string) => parseJsonc(readFileSync(path, "utf8"));

const dirs: string[] = [];
const origin = "http://127.0.0.1:8795";
const upstream = "http://127.0.0.1:20128/v1";

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "jev-opencode-config-"));
  dirs.push(dir);
  const path = join(dir, "opencode.json");
  writeFileSync(path, content);
  return { dir, path, env: { OPENCODE_CONFIG_DIR: dir } };
}

describe("OpenCode transparent provider config", () => {
  it("backs up and repoints matching providers without changing models or other blocks", () => {
    const config = fixture(`{
      // Keep the user's choices intact.
      "model": "9router/main",
      "agents": { "explorer": { "model": "9router/slm" } },
      "mcp": { "ai-memory": { "type": "remote" } },
      "providers": {
        "9router": { "settings": { "baseURL": "${upstream}" } },
        "other": { "settings": { "baseURL": "https://other.test/v1" } }
      },
    }`);
    const original = readFileSync(config.path, "utf8");

    expect(repointOpenCodeConfig({ origin, upstream, env: config.env })).toMatchObject({ changed: true, providers: ["9router"] });
    const routed = readConfig(config.path) as any;
    expect(routed.model).toBe("9router/main");
    expect(routed.agents.explorer.model).toBe("9router/slm");
    expect(routed.mcp).toEqual({ "ai-memory": { type: "remote" } });
    expect(routed.providers["9router"].settings.baseURL).toBe(`${origin}/v1`);
    expect(routed.providers.other.settings.baseURL).toBe("https://other.test/v1");
    expect(readFileSync(`${config.path}.jev-gateway.bak`, "utf8")).toBe(original);
    expect(repointOpenCodeConfig({ origin, upstream, env: config.env })).toMatchObject({ changed: false, reason: "already_routed" });
  });

  it("restores only its URL and preserves config edits made while the gateway ran", () => {
    const config = fixture(
      JSON.stringify({
        model: "9router/main",
        provider: { "9router": { options: { baseURL: upstream } } },
        permission: { bash: "ask" },
      }),
    );
    repointOpenCodeConfig({ origin, upstream, env: config.env });
    const current = JSON.parse(readFileSync(config.path, "utf8"));
    current.permission.read = "allow";
    writeFileSync(config.path, JSON.stringify(current));

    expect(restoreOpenCodeConfig({ origin, upstream, env: config.env })).toMatchObject({ changed: true });
    const restored = readConfig(config.path) as any;
    expect(restored.provider["9router"].options.baseURL).toBe(upstream);
    expect(restored.permission).toEqual({ bash: "ask", read: "allow" });
    expect(existsSync(`${config.path}.jev-gateway.json`)).toBe(false);
    expect(existsSync(`${config.path}.jev-gateway.bak`)).toBe(false);
  });

  it("keeps its backup when the user changed the managed URL", () => {
    const config = fixture(JSON.stringify({ provider: { "9router": { options: { baseURL: upstream } } } }));
    repointOpenCodeConfig({ origin, upstream, env: config.env });
    const current = JSON.parse(readFileSync(config.path, "utf8"));
    current.provider["9router"].options.baseURL = "https://another.test/v1";
    writeFileSync(config.path, JSON.stringify(current));

    expect(restoreOpenCodeConfig({ origin, upstream, env: config.env })).toMatchObject({ changed: false, reason: "user_changed_url" });
    expect(existsSync(`${config.path}.jev-gateway.json`)).toBe(true);
    expect(readConfig(`${config.path}.jev-gateway.bak`).provider["9router"].options.baseURL).toBe(upstream);
  });

  it("leaves providers with a different upstream and invalid configs untouched", () => {
    const other = fixture(JSON.stringify({ providers: { other: { settings: { baseURL: "https://other.test/v1" } } } }));
    const before = readFileSync(other.path, "utf8");
    expect(repointOpenCodeConfig({ origin, upstream, env: other.env })).toMatchObject({ changed: false, reason: "provider_not_found" });
    expect(readFileSync(other.path, "utf8")).toBe(before);
    expect(existsSync(`${other.path}.jev-gateway.bak`)).toBe(false);

    const invalid = fixture("{ invalid");
    expect(repointOpenCodeConfig({ origin, upstream, env: invalid.env })).toMatchObject({ changed: false, reason: "config_invalid" });
    expect(readFileSync(invalid.path, "utf8")).toBe("{ invalid");
  });

  it("does not delete a marker created by another launcher during backup setup", () => {
    const config = fixture(JSON.stringify({ providers: { "9router": { settings: { baseURL: upstream } } } }));
    const marker = `${config.path}.jev-gateway.json`;
    writeFileSync(marker, "owned by another process");
    expect(repointOpenCodeConfig({ origin, upstream, env: config.env })).toMatchObject({ changed: false, reason: "marker_invalid" });
    expect(readFileSync(marker, "utf8")).toBe("owned by another process");
    expect(existsSync(`${config.path}.jev-gateway.bak`)).toBe(false);
    expect(readConfig(config.path)).toEqual({ providers: { "9router": { settings: { baseURL: upstream } } } });
  });

  it("does not switch a config still managed by another launcher port", () => {
    const config = fixture(JSON.stringify({ providers: { "9router": { settings: { baseURL: upstream } } } }));
    repointOpenCodeConfig({ origin: "http://127.0.0.1:8791", upstream, env: config.env });
    expect(repointOpenCodeConfig({ origin, upstream, env: config.env })).toMatchObject({ changed: false, reason: "different_gateway" });
    expect(JSON.parse(readFileSync(config.path, "utf8")).providers["9router"].settings.baseURL).toBe("http://127.0.0.1:8791/v1");
  });

  it("leaves a pre-existing jev-gateway provider untouched", () => {
    const config = fixture(
      JSON.stringify({
        model: "jev-gateway/main",
        providers: {
          "9router": { settings: { baseURL: upstream } },
          "jev-gateway": { settings: { baseURL: `${origin}/v1` } },
        },
      }),
    );
    expect(repointOpenCodeConfig({ origin, upstream, env: config.env })).toMatchObject({ changed: true, providers: ["9router"] });
    const routed = readConfig(config.path) as any;
    expect(routed.model).toBe("jev-gateway/main");
    expect(routed.providers["jev-gateway"].settings.baseURL).toBe(`${origin}/v1`);
    expect(routed.providers["9router"].settings.baseURL).toBe(`${origin}/v1`);
    expect(restoreOpenCodeConfig({ origin, upstream, env: config.env })).toMatchObject({ changed: true });
    const restored = readConfig(config.path) as any;
    expect(restored.providers["jev-gateway"].settings.baseURL).toBe(`${origin}/v1`);
    expect(restored.providers["9router"].settings.baseURL).toBe(upstream);
  });

  it("leaves another provider on the same local gateway URL untouched through the full cycle", () => {
    const config = fixture(
      JSON.stringify({
        providers: {
          unrelated: { settings: { baseURL: "http://127.0.0.1:8795/v1" } },
          "9router": { settings: { baseURL: upstream } },
        },
      }),
    );
    repointOpenCodeConfig({ origin, upstream, env: config.env });
    restoreOpenCodeConfig({ origin, upstream, env: config.env });
    const restored = readConfig(config.path) as any;
    expect(restored.providers.unrelated.settings.baseURL).toBe("http://127.0.0.1:8795/v1");
    expect(restored.providers["9router"].settings.baseURL).toBe(upstream);
  });

  it("restores only providers changed by the launcher, preserving a pre-existing gateway URL", () => {
    const config = fixture(
      JSON.stringify({
        providers: {
          "9router": { settings: { baseURL: upstream } },
          manual: { settings: { baseURL: `${origin}/v1` } },
        },
      }),
    );
    repointOpenCodeConfig({ origin, upstream, env: config.env });
    restoreOpenCodeConfig({ origin, upstream, env: config.env });
    const restored = readConfig(config.path) as any;
    expect(restored.providers["9router"].settings.baseURL).toBe(upstream);
    expect(restored.providers.manual.settings.baseURL).toBe(`${origin}/v1`);
  });

  it("patches the v1 environment overlay without changing the selected model", () => {
    const overlay = JSON.stringify({
      model: "9router/main",
      agent: { explorer: { model: "9router/slm" } },
      provider: { "9router": { options: { baseURL: upstream } }, other: { options: { baseURL: "https://other.test/v1" } } },
    });
    const patched = JSON.parse(repointOpenCodeOverlay(overlay, { origin, upstream }));
    expect(patched.model).toBe("9router/main");
    expect(patched.agent.explorer.model).toBe("9router/slm");
    expect(patched.provider["9router"].options.baseURL).toBe(`${origin}/v1`);
    expect(patched.provider.other.options.baseURL).toBe("https://other.test/v1");
  });
});
