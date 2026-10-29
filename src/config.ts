import { isIP } from "node:net";
import { PROVIDERS, resolveModel, resolveProvider, resolveUrl, type ProviderId } from "./jev.js";
export type AdvisorProvider = "openai-compatible" | "anthropic";
export type AdvisorEffort = "low" | "medium" | "high";

export interface Config {
  /** Interface to listen on. Loopback by default: the gateway forwards credentials and must not be reachable from the LAN. */
  host: string;
  port: number;
  /** OpenAI-compatible API root, including the `/v1` suffix. */
  upstreamBaseUrl: string;
  /** Replaces the client's Authorization header upstream when set. */
  upstreamApiKey?: string;
  /** When set, clients must present this key to use the gateway. */
  routerApiKey?: string;
  /** Model used upstream once Jev has already picked the tool. */
  argsModel?: string;
  /** Model Jev may consult for a read-only second opinion. */
  advisorModel: string;
  advisorProvider?: AdvisorProvider;
  advisorUrl?: string;
  advisorApiKey?: string;
  advisorEffort?: AdvisorEffort;
  advisorEnabled: boolean;
  advisorTimeoutMs: number;
  advisorMaxOutputTokens: number;
  advisorMaxCallsPerSession: number;
  /** Optional loopback-only Headroom /v1/compress endpoint. */
  headroomUrl?: string;
  headroomMode: "off" | "shadow" | "compress";
  headroomTimeoutMs: number;
  /** Who serves Jev: TypeSafe itself, a gateway that resells it, or a local Laya checkpoint. */
  jevProvider: ProviderId;
  /** The key for that provider; the launchers ask for it when it is missing. */
  jevApiKey?: string;
  /** Endpoint the questions are posted to; the provider's own unless overridden (tests, proxies). */
  jevUrl: string;
  jevModel: string;
  jevTimeoutMs: number;
  /** Below this, Jev's tool decision is ignored and the LLM decides. */
  minConfidence: number;
  /** Per-argument certainty needed to answer without calling the LLM. */
  argMinCertainty: number;
  onNone: "force_none" | "passthrough";
  directCalls: boolean;
  /** False starts the gateway as a plain metering proxy; the dashboard can flip it at runtime. */
  routing: boolean;
  maxStateChars: number;
  maxMessageChars: number;
  /** Opt-in: dump every routed request (decoded body, redacted headers) into this directory. */
  debugDumpDir?: string;
  /** Who this router serves ("codex", "claude"); the dashboard labels its traffic with it. */
  client: string;
  /** JSON-lines file this process's stdout is appended to, if any: the dashboard's history. */
  logFile?: string;
}

type Env = Record<string, string | undefined>;

const str = (env: Env, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value ? value : undefined;
};

const num = (env: Env, key: string, fallback: number): number => {
  const raw = str(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number, got "${raw}"`);
  return value;
};

const bool = (env: Env, key: string, fallback: boolean): boolean => {
  const raw = str(env, key)?.toLowerCase();
  if (raw === undefined) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

export function loadConfig(env: Env = process.env): Config {
  const client = str(env, "JEV_CLIENT") ?? "standalone";
  const jevProvider = resolveProvider(env);
  const jevModel = resolveModel(jevProvider, str(env, "JEV_MODEL"));
  const advisorProviderValue = str(env, "JEV_ADVISOR_PROVIDER")?.toLowerCase();
  let advisorProvider: AdvisorProvider | undefined;
  if (advisorProviderValue) {
    if (advisorProviderValue !== "openai-compatible" && advisorProviderValue !== "anthropic") {
      throw new Error(`JEV_ADVISOR_PROVIDER must be "openai-compatible" or "anthropic", got "${advisorProviderValue}"`);
    }
    advisorProvider = advisorProviderValue;
  }
  const advisorUrl = str(env, "JEV_ADVISOR_URL");
  const advisorApiKey = str(env, "JEV_ADVISOR_API_KEY");
  const advisorEffortValue = str(env, "JEV_ADVISOR_EFFORT")?.toLowerCase();
  let advisorEffort: AdvisorEffort | undefined;
  if (advisorEffortValue) {
    if (advisorEffortValue !== "low" && advisorEffortValue !== "medium" && advisorEffortValue !== "high") {
      throw new Error(`JEV_ADVISOR_EFFORT must be "low", "medium" or "high", got "${advisorEffortValue}"`);
    }
    advisorEffort = advisorEffortValue;
  }
  if (advisorProvider && !advisorUrl) throw new Error("JEV_ADVISOR_URL is required when JEV_ADVISOR_PROVIDER is set");
  if (!advisorProvider && (advisorUrl || advisorApiKey)) {
    throw new Error("JEV_ADVISOR_PROVIDER is required to use JEV_ADVISOR_URL or JEV_ADVISOR_API_KEY");
  }
  if (advisorProvider && !str(env, "JEV_ADVISOR_MODEL")) {
    throw new Error("JEV_ADVISOR_MODEL is required when JEV_ADVISOR_PROVIDER is set");
  }
  if (advisorUrl) {
    let parsed: URL;
    try {
      parsed = new URL(advisorUrl);
    } catch {
      throw new Error("JEV_ADVISOR_URL must be an explicit HTTPS URL or loopback HTTP URL");
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    const ipv4 = hostname.split(".").map(Number);
    const isLoopback = hostname === "localhost" || hostname === "::1" || (isIP(hostname) === 4 && ipv4[0] === 127);
    if (
      (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("JEV_ADVISOR_URL must use HTTPS (or loopback HTTP) and have no credentials, query or fragment");
    }
  }
  const onNone = str(env, "JEV_ON_NONE") ?? "force_none";
  if (onNone !== "force_none" && onNone !== "passthrough") {
    throw new Error(`JEV_ON_NONE must be "force_none" or "passthrough", got "${onNone}"`);
  }
  const headroomMode = str(env, "JEV_HEADROOM_MODE") ?? "off";
  if (headroomMode !== "off" && headroomMode !== "shadow" && headroomMode !== "compress") {
    throw new Error(`JEV_HEADROOM_MODE must be "off", "shadow" or "compress", got "${headroomMode}"`);
  }
  const headroomUrl = str(env, "JEV_HEADROOM_URL");
  if (headroomMode !== "off" && !headroomUrl) {
    throw new Error("JEV_HEADROOM_URL is required when JEV_HEADROOM_MODE is enabled");
  }
  if (headroomUrl) {
    let parsed: URL;
    try {
      parsed = new URL(headroomUrl);
    } catch {
      throw new Error(`JEV_HEADROOM_URL must be an explicit loopback URL, got "${headroomUrl}"`);
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    const ipv4 = hostname.split(".").map(Number);
    const loopback = hostname === "localhost" || (isIP(hostname) === 4 && ipv4[0] === 127) || hostname === "::1";
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !loopback ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !parsed.pathname.endsWith("/v1/compress")
    ) {
      throw new Error(`JEV_HEADROOM_URL must be a loopback URL ending in /v1/compress, got "${headroomUrl}"`);
    }
  }
  const config: Config = {
    host: str(env, "HOST") ?? "127.0.0.1",
    port: num(env, "PORT", 8787),
    upstreamBaseUrl: (str(env, "UPSTREAM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    upstreamApiKey: str(env, "UPSTREAM_API_KEY"),
    routerApiKey: str(env, "ROUTER_API_KEY"),
    // Codex sessions must stay on Luna; these generic gateway options would silently switch it.
    argsModel: client === "codex" ? undefined : str(env, "ARGS_MODEL"),
    // The default advisor uses the client's upstream; an explicit advisor provider selects its own API.
    advisorModel: str(env, "JEV_ADVISOR_MODEL") ?? (client === "claude" ? "claude-opus-5-5" : "gpt-6-astra"),
    advisorProvider,
    advisorUrl,
    advisorApiKey,
    advisorEffort,
    advisorEnabled: bool(env, "JEV_ADVISOR", client === "codex"),
    advisorTimeoutMs: num(env, "JEV_ADVISOR_TIMEOUT_MS", 30_000),
    advisorMaxOutputTokens: num(env, "JEV_ADVISOR_MAX_OUTPUT_TOKENS", 700),
    advisorMaxCallsPerSession: num(env, "JEV_ADVISOR_MAX_CALLS_PER_SESSION", 6),
    headroomUrl,
    headroomMode,
    headroomTimeoutMs: num(env, "JEV_HEADROOM_TIMEOUT_MS", 500),
    jevProvider,
    jevApiKey: str(env, PROVIDERS[jevProvider].keyEnv),
    jevUrl: resolveUrl(jevProvider, env),
    jevModel,
    jevTimeoutMs: num(env, "JEV_TIMEOUT_MS", 4000),
    minConfidence: num(env, "JEV_MIN_CONFIDENCE", 0.7),
    argMinCertainty: num(env, "JEV_ARG_MIN_CERTAINTY", 0.8),
    onNone,
    // Synthetic Responses IDs are not known to Codex's upstream history store.
    directCalls: client === "codex" ? false : bool(env, "JEV_DIRECT_CALLS", true),
    routing: bool(env, "JEV_ROUTING", true),
    // laya-serve refuses a state above 50,000 characters; the laya default keeps under it so no
    // request goes unrouted for size.
    maxStateChars: num(env, "JEV_MAX_STATE_CHARS", jevProvider === "laya" ? 50_000 : 60_000),
    maxMessageChars: num(env, "JEV_MAX_MESSAGE_CHARS", 4_000),
    debugDumpDir: str(env, "JEV_DEBUG_DUMP_DIR"),
    client,
    logFile: str(env, "JEV_LOG_FILE"),
  };
  if (config.headroomTimeoutMs <= 0 || config.headroomTimeoutMs > 5_000) {
    throw new Error(`JEV_HEADROOM_TIMEOUT_MS must be between 1 and 5000, got "${config.headroomTimeoutMs}"`);
  }
  if (config.routerApiKey && !config.upstreamApiKey) {
    throw new Error("ROUTER_API_KEY requires UPSTREAM_API_KEY (the client key is not valid upstream)");
  }
  return config;
}
