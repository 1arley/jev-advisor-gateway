// How each coding agent is pointed at a gateway. Shared by the launchers and the benchmark runner,
// so a benchmark drives an agent exactly the way `jev-codex`, `jev-claude`, and `jev-opencode` do.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseJsonc, repointOpenCodeConfig, repointOpenCodeOverlay, restoreOpenCodeConfig } from "./opencode-config.mjs";

export { parseJsonc } from "./opencode-config.mjs";

/** Codex talks to a different backend depending on how the user logged in. */
function codexUpstream() {
  if (process.env.JEV_CODEX_UPSTREAM_BASE_URL) return process.env.JEV_CODEX_UPSTREAM_BASE_URL;
  try {
    const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
    const auth = JSON.parse(readFileSync(join(codexHome, "auth.json"), "utf8"));
    if (auth.auth_mode === "chatgpt" || (auth.tokens && !auth.OPENAI_API_KEY)) {
      return "https://chatgpt.com/backend-api/codex";
    }
  } catch {
    // No readable login: assume API-key usage.
  }
  return "https://api.openai.com/v1";
}

const codexProvider = (origin, name) => ({
  name: `"${name}"`,
  base_url: `"${origin}/v1"`,
  wire_api: `"responses"`,
  // Reuse whatever login Codex already has; the gateway forwards it upstream untouched.
  requires_openai_auth: "true",
});

const codexSpec = ({ name, provider, portEnv, defaultPort, advisor, pinLuna }) => ({
  name,
  client: "codex",
  portEnv,
  defaultPort,
  gatewayEnv: { JEV_ADVISOR: advisor ? "on" : "off" },
  upstream: codexUpstream,
  upstreamHelp:
    "JEV_CODEX_UPSTREAM_BASE_URL   where Codex traffic goes; default follows your Codex login:\n" +
    "                                ChatGPT login → https://chatgpt.com/backend-api/codex\n" +
    "                                API key       → https://api.openai.com/v1",
  args: (origin) => [
    "-c",
    `model_provider="${provider}"`,
    ...(pinLuna ? ["-c", `model="gpt-6-luna"`] : []),
    ...Object.entries(codexProvider(origin, provider)).flatMap(([key, value]) => ["-c", `model_providers.${provider}.${key}=${value}`]),
  ],
  configHelp: (origin) =>
    `# Add to ~/.codex/config.toml, then keep the gateway running with \`${name} --start\`.\n\n[model_providers.${provider}]\n` +
    Object.entries(codexProvider(origin, provider))
      .map(([key, value]) => `${key} = ${value}`)
      .join("\n") +
    (pinLuna ? `\n\n[profiles.jev]\nmodel = "gpt-6-luna"\nmodel_provider = "${provider}"\n` : "\n"),
});

export const codexAdvisor = codexSpec({
  name: "jev-codex-advisor",
  provider: "jev-advisor-gateway",
  portEnv: "JEV_CODEX_PORT",
  defaultPort: 8790,
  advisor: true,
  pinLuna: true,
});

export const codex = codexSpec({
  name: "jev-codex",
  provider: "jev-codex",
  portEnv: "JEV_CODEX_BASIC_PORT",
  defaultPort: 8794,
  advisor: false,
  pinLuna: false,
});

const claudeConfigHelp = (launcher, origin) =>
  `# Keep the gateway running (${launcher} --start), then either:\n` +
  `#   ANTHROPIC_BASE_URL=${origin} claude\n` +
  `# or add to ~/.claude/settings.json:\n` +
  JSON.stringify({ env: { ANTHROPIC_BASE_URL: origin } }, null, 2);

export const claude = {
  name: "jev-claude",
  client: "claude",
  portEnv: "JEV_CLAUDE_PORT",
  defaultPort: 8789,
  upstream: () => process.env.JEV_CLAUDE_UPSTREAM_BASE_URL ?? "https://api.anthropic.com/v1",
  upstreamHelp: "JEV_CLAUDE_UPSTREAM_BASE_URL   where Claude traffic goes (default https://api.anthropic.com/v1)",
  // Only the base URL is set. With no gateway credential alongside it, Claude Code keeps using its
  // saved claude.ai login, so a Pro/Max subscription (or an existing API key) keeps working as is.
  env: (origin) => ({ ANTHROPIC_BASE_URL: origin }),
  configHelp: (origin) => claudeConfigHelp("jev-claude", origin),
};

/** Claude Code with an advisor: Opus reviews, Haiku codes. Both are overridable. */
export const claudeAdvisor = {
  ...claude,
  name: "jev-claude-advisor",
  portEnv: "JEV_CLAUDE_ADVISOR_PORT",
  defaultPort: 8788,
  // Separate log/pid from jev-claude: two launchers, one client.
  state: "claude-advisor",
  configHelp: (origin) => claudeConfigHelp("jev-claude-advisor", origin),
  // Override the advisor with JEV_ADVISOR_MODEL, the coder with a `--model` after the launcher's.
  gatewayEnv: { JEV_ADVISOR: "on", JEV_ADVISOR_MODEL: "claude-opus-5-5" },
  args: () => ["--model", "claude-haiku-5-5"],
};

/** Where OpenCode traffic goes by default; override with JEV_OPENCODE_UPSTREAM_BASE_URL. */
function opencodeUpstream(env = process.env) {
  return env.JEV_OPENCODE_UPSTREAM_BASE_URL ?? "https://api.openai.com/v1";
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const OPENCODE_PROVIDER = "jev-gateway";

const providerOf = (model) => (typeof model === "string" && model.includes("/") ? model.slice(0, model.indexOf("/")) : undefined);

/**
 * The `provider/model` id of a model reference. v1 config spells it a string, and v2's
 * `debug config` hands it over as `{ providerID, model }`.
 */
const modelIdOf = (model) => {
  if (typeof model === "string") return model;
  if (isObject(model) && typeof model.providerID === "string" && typeof model.model === "string")
    return `${model.providerID}/${model.model}`;
  return undefined;
};

/**
 * OpenCode v2's `opencode debug config` prints one document per config source; v1 printed the
 * merged object. The documents arrived already ordered, so a shallow assign at the object's own
 * levels is the merge OpenCode applied: within `model`, the `agents` and `providers` maps, a
 * later source that names them replaces what an earlier one held.
 */
function mergeConfigDocuments(documents) {
  const merged = {};
  for (const document of documents) {
    const info = isObject(document) ? (document.information ?? document.info) : undefined;
    if (isObject(info)) Object.assign(merged, info);
  }
  return merged;
}

/** The value of `-m` / `--model` among the arguments meant for OpenCode, if there is one. */
function modelFlag(argv) {
  for (const [index, arg] of argv.entries()) {
    if (arg === "--") return undefined;
    if (arg === "-m" || arg === "--model") return argv[index + 1];
    if (arg.startsWith("--model=")) return arg.slice("--model=".length);
    if (/^-m./.test(arg)) return arg.slice(2).replace(/^=/, "");
  }
  return undefined;
}

/**
 * What in this OpenCode session will not go through the gateway, as lines for the user.
 *
 * The launcher sets the *default* model to one served by the gateway. OpenCode lets an agent name
 * a model of its own (`agent.<name>.model`, or `model:` in an agent's markdown file), and `-m`
 * outranks everything: either one selects another provider, whose traffic goes straight to that
 * provider. Those are the user's choices and are left alone, but a session that quietly skips Jev
 * looks exactly like one where Jev had nothing to decide, so they are said out loud.
 *
 * `resolved` is what `opencode debug config` prints: OpenCode's own merge of every config source,
 * which is the only reliable way to know what an agent will use. A provider counts as covered by
 * where it sends requests, not by its name, so one the user pointed at the gateway (`origin`)
 * themselves is not reported.
 */
export function opencodeOutsideGateway(resolved, argv = [], origin) {
  // v1 spells the provider map `provider`, v2 `providers`, and both keys may appear; `providers`
  // is the later source wherever the user wrote both.
  const providers = {
    ...(isObject(resolved) && isObject(resolved.provider) ? resolved.provider : {}),
    ...(isObject(resolved) && isObject(resolved.providers) ? resolved.providers : {}),
  };
  const covered = (model) => {
    const id = providerOf(model);
    if (id === OPENCODE_PROVIDER) return true;
    // v1 keeps the provider's endpoint in `options`, v2 in `settings`.
    const provider = providers[id];
    const baseURL = provider ? (provider.options?.baseURL ?? provider.settings?.baseURL) : undefined;
    return origin !== undefined && typeof baseURL === "string" && (baseURL === origin || baseURL.startsWith(`${origin}/`));
  };
  const outside = [];
  const flag = modelFlag(argv);
  if (flag !== undefined && !covered(flag)) outside.push(`this session (--model ${flag})`);
  if (isObject(resolved)) {
    const defaultModel = modelIdOf(resolved.model);
    if (!covered(defaultModel)) outside.push(`the default model (${defaultModel ?? "none"})`);
    // v1 spells the agent map `agent`, v2 `agents`, and v2 keeps the singular name for backwards
    // compatibility; both appear only when the user wrote them, and `agents` is the later source.
    const agents = { ...(isObject(resolved.agent) ? resolved.agent : {}), ...(isObject(resolved.agents) ? resolved.agents : {}) };
    for (const [name, agent] of Object.entries(agents)) {
      if (!isObject(agent)) continue;
      if (agent.disable === true || agent.disabled === true) continue;
      const model = modelIdOf(agent.model);
      if (model === undefined) continue;
      if (!covered(model)) outside.push(`agent "${name}" (${model})`);
    }
  }
  if (outside.length === 0) return [];
  return [
    "these go straight to their provider, not through the gateway, because they name a model of their own:",
    ...outside.map((line) => `  - ${line}`),
    `Jev only sees requests to ${OPENCODE_PROVIDER}/* models. Agents without a model of their own use the default and are covered.`,
  ];
}

/** Probe the selected OpenAI-compatible model with one synthetic, one-token request. */
export async function probeOpenCodeModel({ origin, upstream, argv = [], env = process.env, fetchImpl = fetch }) {
  const found = await opencodeResolvedConfig(env);
  if (!found || !isObject(found.resolved)) return { ok: false, reason: "config_unavailable" };
  const selected = modelFlag(argv) ?? modelIdOf(found.resolved.model);
  const separator = typeof selected === "string" ? selected.indexOf("/") : -1;
  if (separator < 1) return { ok: false, reason: "model_unresolved" };
  const providerId = selected.slice(0, separator);
  const model = selected.slice(separator + 1);
  const providers = {
    ...(isObject(found.resolved.provider) ? found.resolved.provider : {}),
    ...(isObject(found.resolved.providers) ? found.resolved.providers : {}),
  };
  const provider = providers[providerId];
  const settings = isObject(provider) ? (provider.settings ?? provider.options) : undefined;
  const baseURL = isObject(settings) && typeof settings.baseURL === "string" ? settings.baseURL : undefined;
  const upstreamURL = new URL(upstream);
  const gatewayURL = `${origin}${upstreamURL.pathname.replace(/\/+$/, "")}`;
  if (!baseURL || (baseURL.replace(/\/+$/, "") !== gatewayURL && baseURL.replace(/\/+$/, "") !== upstream.replace(/\/+$/, ""))) {
    return { ok: false, reason: "model_provider_not_routed" };
  }

  try {
    const configuredKey = isObject(settings) && typeof settings.apiKey === "string" ? settings.apiKey : undefined;
    const keyName = configuredKey?.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/)?.[1];
    const key = keyName ? env[keyName] : (configuredKey ?? (Array.isArray(provider.env) ? env[provider.env[0]] : undefined));
    const headers = new Headers({ "content-type": "application/json" });
    if (typeof key === "string" && key) headers.set("authorization", `Bearer ${key}`);
    const response = await fetchImpl(`${upstream.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply OK" }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    return { ok: response.ok, reason: response.ok ? undefined : `http_${response.status}` };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/**
 * Ask OpenCode how it resolves its configuration with the launcher's config over the user's.
 * Undefined when it cannot say. v2's answer is an array of per-source documents; v1's is the
 * merged object itself. The shape decides what `notices` says, so both travel together.
 */
function opencodeResolvedConfig(env) {
  return new Promise((resolve) => {
    execFile("opencode", ["debug", "config"], { env, timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(undefined);
      // Log lines may come first, and may hold braces or a bracket of their own: the JSON starts
      // on a line of its own.
      const start = stdout.search(/^[{[]/m);
      if (start < 0) return resolve(undefined);
      try {
        const parsed = JSON.parse(stdout.slice(start));
        resolve(Array.isArray(parsed) ? { v2: true, resolved: mergeConfigDocuments(parsed) } : { v2: false, resolved: parsed });
      } catch {
        resolve(undefined);
      }
    });
  });
}

export const opencode = {
  name: "jev-opencode",
  client: "opencode",
  portEnv: "JEV_OPENCODE_PORT",
  defaultPort: 8791,
  upstream: opencodeUpstream,
  upstreamHelp:
    "JEV_OPENCODE_UPSTREAM_BASE_URL   where OpenCode traffic goes (default https://api.openai.com/v1)\n" +
    "  JEV_OPENCODE_CHECK               off skips listing the agents that bypass the gateway (saves about a second)",
  prepare: (origin) => {
    let result;
    try {
      result = repointOpenCodeConfig({ origin, upstream: opencodeUpstream() });
    } catch {
      return {
        changed: false,
        reason: "config_update_failed",
        warning: "OpenCode config could not be updated; its original file and backup were kept.",
        abort: true,
      };
    }
    const warning = {
      config_missing: "OpenCode config file was not found; its provider was left unchanged.",
      config_invalid: "OpenCode config is invalid; it was left unchanged.",
      provider_not_found: "No configured OpenCode provider uses JEV_OPENCODE_UPSTREAM_BASE_URL; no provider was changed.",
      already_routed: "OpenCode already has a provider on this gateway URL; it was left unchanged.",
      backup_missing: "The managed OpenCode URL has no backup; it was left unchanged.",
      backup_exists: "A prior OpenCode backup exists without a valid marker; it was left unchanged.",
      marker_failed: "OpenCode routing state could not be saved; its config was left unchanged.",
      config_changed: "OpenCode config changed during setup; it was left unchanged.",
      config_update_failed: "OpenCode config could not be updated; its backup was kept.",
      marker_invalid: "The managed OpenCode config marker is invalid; its backup was kept.",
      different_gateway: "Another OpenCode gateway owns the config. Stop that launcher before switching gateways.",
    }[result.reason];
    return {
      ...result,
      ...(warning ? { warning } : {}),
      ...(result.reason === "different_gateway" || (result.reason !== undefined && result.reason !== "already_routed")
        ? { abort: true }
        : {}),
    };
  },
  restore: (origin) => restoreOpenCodeConfig({ origin, upstream: opencodeUpstream() }),
  probe: (origin, argv) =>
    probeOpenCodeModel({
      origin,
      upstream: opencodeUpstream(),
      argv,
      env: { ...process.env, ...opencode.env(origin) },
    }),
  // Keep model choice and provider IDs as OpenCode configured them; only their matching endpoint moves.
  env: (origin, inherited = process.env) => ({
    ...(inherited.OPENCODE_CONFIG_CONTENT !== undefined
      ? {
          OPENCODE_CONFIG_CONTENT: repointOpenCodeOverlay(inherited.OPENCODE_CONFIG_CONTENT, {
            origin,
            upstream: opencodeUpstream(inherited),
          }),
        }
      : {}),
    OPENCODE_EXPERIMENTAL_NATIVE_LLM: "false",
    OPENCODE_EXPERIMENTAL_CODE_MODE: "false",
  }),
  // JEV_OPENCODE_CHECK=off skips the config read and bypass summary.
  notices: async function (origin, argv, inherited = process.env) {
    if (inherited.JEV_OPENCODE_CHECK === "off") return [];
    const found = await opencodeResolvedConfig({ ...inherited, ...opencode.env(origin, inherited) });
    return opencodeOutsideGateway(found?.resolved, argv, origin);
  },
  configHelp: (origin) =>
    `# Set JEV_OPENCODE_UPSTREAM_BASE_URL to the OpenAI-compatible provider URL already in opencode.json.\n` +
    `# The launcher backs up the file, repoints matching providers to ${origin}/v1, and restores them\n` +
    `# when the gateway stops. Model IDs, provider names, agents, and --model choices remain unchanged.\n` +
    `# Use ~/.jev-gateway/.env.opencode for OpenCode-only upstream settings.\n` +
    `# Run ${opencode.name} --start to activate the route; ${opencode.name} --stop restores the saved URL.`,
};
export const opencodeAdvisor = {
  ...opencode,
  name: "jev-opencode-advisor",
  portEnv: "JEV_OPENCODE_ADVISOR_PORT",
  defaultPort: 8795,
  state: "opencode-advisor",
  gatewayEnv: { JEV_ADVISOR: "on" },
};

export const devin = {
  name: "jev-devin",
  client: "devin",
  portEnv: "JEV_DEVIN_PORT",
  defaultPort: 8792,
  upstream: () => process.env.JEV_DEVIN_UPSTREAM_BASE_URL ?? "https://server.codeium.com",
  upstreamHelp: "JEV_DEVIN_UPSTREAM_BASE_URL   where Devin traffic goes (default https://server.codeium.com)",
  // The variable's name is a leftover compiled into the devin binary itself; it is the only
  // knob that redirects the exa protocol. DEVIN_API_URL points at api.devin.ai instead.
  env: (origin) => ({ WINDSURF_API_SERVER_URL: origin }),
  configHelp: (origin) => `# Keep the gateway running (jev-devin --start), then:\n` + `#   WINDSURF_API_SERVER_URL=${origin} devin\n`,
};

function kiloUpstream() {
  return process.env.JEV_KILO_UPSTREAM_BASE_URL ?? "https://api.kilo.ai/api/openrouter";
}

function kiloModel() {
  return process.env.JEV_KILO_MODEL ?? "kilo-auto/free";
}

// Kilo's built-in `kilo` provider cannot be reused: it appends `/openrouter/` to any base URL, which
// misses the routed endpoint. So Kilo gets a provider of its own, and the user's key reaches it
// through `{env:KILO_API_KEY}`, which Kilo expands itself, so the key never enters the config.
function kiloInlineConfig(origin) {
  const model = kiloModel();
  return {
    $schema: "https://kilo.ai/config.json",
    model: `${OPENCODE_PROVIDER}/${model}`,
    small_model: `${OPENCODE_PROVIDER}/${model}`,
    provider: {
      [OPENCODE_PROVIDER]: {
        npm: "@ai-sdk/openai-compatible",
        name: "Jev Gateway",
        options: { baseURL: `${origin}/v1`, apiKey: "{env:KILO_API_KEY}" },
        models: { [model]: { name: `Jev Gateway (${model})` } },
      },
    },
  };
}

export const kilo = {
  name: "jev-kilo",
  client: "kilo",
  portEnv: "JEV_KILO_PORT",
  defaultPort: 8793,
  upstream: kiloUpstream,
  upstreamHelp:
    "JEV_KILO_UPSTREAM_BASE_URL   where Kilo traffic goes (default https://api.kilo.ai/api/openrouter)\n" +
    "JEV_KILO_MODEL               model selected as jev-gateway/<model> (default kilo-auto/free)\n" +
    "KILO_API_KEY                 your Kilo key, forwarded untouched; unset means free models only",
  env: (origin) => ({ KILO_CONFIG_CONTENT: JSON.stringify(kiloInlineConfig(origin)) }),
  configHelp: (origin) => {
    const config = kiloInlineConfig(origin);
    const manual = JSON.stringify({ model: config.model, small_model: config.small_model, provider: config.provider }, null, 2);
    return (
      `# Keep the gateway running (jev-kilo --start), then add to kilo.jsonc\n` +
      `# (project root or ~/.config/kilo/kilo.jsonc):\n` +
      `${manual}\n` +
      `# then select it with: kilo --model ${config.model}`
    );
  },
};

export const gemini = {
  name: "jev-gemini",
  client: "gemini",
  portEnv: "JEV_GEMINI_PORT",
  defaultPort: 8788,
  upstream: () => process.env.JEV_GEMINI_UPSTREAM_BASE_URL ?? "https://generativelanguage.googleapis.com",
  upstreamHelp: "JEV_GEMINI_UPSTREAM_BASE_URL   where Gemini traffic goes (default https://generativelanguage.googleapis.com)",
  env: (origin) => ({
    GEMINI_API_BASE: origin,
    GOOGLE_GEMINI_BASE_URL: origin,
  }),
  configHelp: (origin) =>
    `# Point your Gemini client or SDK at:\n` + `#   GEMINI_API_BASE=${origin}\n` + `#   or endpoint: ${origin}/v1beta\n`,
};

export function agyClientArgs(args) {
  const settingsArgs = [];
  const clientArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--settings") {
      if (!args[i + 1]) throw new Error("--settings requires a JSON object or file path.");
      settingsArgs.push(args[++i]);
    } else if (args[i].startsWith("--settings=")) {
      settingsArgs.push(args[i].slice("--settings=".length));
    } else {
      clientArgs.push(args[i]);
    }
  }
  if (settingsArgs.length > 1) throw new Error("Use one --settings option; duplicate settings are not merged by agy.");

  let settings = { modelProvider: "gemini" };
  if (settingsArgs.length) {
    const value = settingsArgs[0].trim();
    if (value.startsWith("{") || value.startsWith("[")) {
      let supplied;
      try {
        supplied = JSON.parse(value);
      } catch {
        throw new Error("--settings JSON must be a valid object.");
      }
      if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new Error("--settings JSON must be an object.");
      settings = { ...supplied, modelProvider: "gemini" };
    } else {
      let supplied;
      try {
        supplied = JSON.parse(readFileSync(resolve(value), "utf8"));
      } catch {
        throw new Error("--settings file must be readable JSON and set modelProvider to gemini.");
      }
      if (!supplied || typeof supplied !== "object" || Array.isArray(supplied) || supplied.modelProvider !== "gemini") {
        throw new Error("--settings file must already set modelProvider to gemini; the launcher will not edit or copy it.");
      }
      settings = undefined;
    }
  }
  return [...(settings ? ["--settings", JSON.stringify(settings)] : ["--settings", settingsArgs[0]]), ...clientArgs];
}

const agyGatewayEnv = () => ({
  JEV_ADVISOR: "off",
  JEV_ADVISOR_MODEL: process.env.JEV_ADVISOR_MODEL || "gemini-3.1-pro-preview",
});
const agyAdvisorGatewayEnv = () => ({ ...agyGatewayEnv(), JEV_ADVISOR: "on" });

export const agy = {
  ...gemini,
  name: "jev-agy",
  client: "agy",
  portEnv: "JEV_AGY_PORT",
  defaultPort: 8796,
  state: "agy",
  gatewayEnv: agyGatewayEnv,
  transformArgs: (_origin, args) => agyClientArgs(args),
  configHelp: (origin) =>
    `# Requires GEMINI_API_KEY for the Gemini API. No global agy settings are changed.\n` +
    `# jev-agy sets GOOGLE_GEMINI_BASE_URL=${origin} and modelProvider=gemini for this process.\n` +
    `# jev-agy --advisor on enables a Gemini advisor (override with JEV_ADVISOR_MODEL).\n` +
    `# With a settings file, it must already contain: {"modelProvider":"gemini"}\n`,
};

export const agyAdvisor = {
  ...agy,
  name: "jev-agy-advisor",
  portEnv: "JEV_AGY_ADVISOR_PORT",
  defaultPort: 8797,
  state: "agy-advisor",
  gatewayEnv: agyAdvisorGatewayEnv,
  configHelp: (origin) =>
    `# Requires GEMINI_API_KEY for the Gemini API. No global agy settings are changed.\n` +
    `# jev-agy-advisor uses GOOGLE_GEMINI_BASE_URL=${origin}, modelProvider=gemini, and\n` +
    `# a read-only Gemini 3.1 Pro advisor (override with JEV_ADVISOR_MODEL).\n` +
    `# With a settings file, it must already contain: {"modelProvider":"gemini"}\n`,
};
