import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import type { Config } from "./config.js";
import type { AskJev } from "./decide.js";
import { fromJiwoResult, sanitizeJiwoState, toJiwoRequest } from "./jiwo.js";
import table from "./providers.json" with { type: "json" };

/** One row of the provider table: where Jev runs, which key gets there, and what to call it. */
interface Provider {
  label: string;
  note: string;
  keyEnv: string;
  keyUrl?: string;
  url: string;
  model: string;
  /** Only providers that must refuse unlisted ids have a list: the rest tell theirs apart by a slash. */
  models?: string[];
  /** A paid model setup can offer only with the user's consent. */
  paidModel?: string;
  /** Setup asks which model the upstream serves instead of assuming the table's default. */
  askModel?: boolean;
  /** Local setup can probe this endpoint without sending a model request. */
  healthUrl?: string;
  /** The upstream ignores Authorization, so the saved "key" is only a placeholder. */
  keyIgnored?: boolean;
  /** A local service that answers without a key (Laya): setup asks for none, and none is sent. */
  keyless?: boolean;
}

/**
 * Where Jev can be reached. TypeSafe's own API, and gateways that resell it: all of them take
 * the same request body and return the same answers, so one transport serves them. The table is
 * JSON because the launchers' setup wizard (plain .mjs, no build step) reads the same file.
 */
const providers = table as Record<keyof typeof table, Provider>;
export type ProviderId = keyof typeof table;
export const PROVIDERS = providers;
export const isProvider = (value: string): value is ProviderId => value in providers;

type Env = Record<string, string | undefined>;
const present = (env: Env, name: string) => Boolean(env[name]?.trim());

/** An explicit JEV_PROVIDER wins; otherwise whichever key is there, TypeSafe's own first. */
export function resolveProvider(env: Env): ProviderId {
  const chosen = env.JEV_PROVIDER?.trim().toLowerCase();
  if (chosen) {
    if (!isProvider(chosen)) throw new Error(`JEV_PROVIDER must be one of ${Object.keys(providers).join(", ")}, got "${chosen}"`);
    return chosen;
  }
  return (Object.keys(providers) as ProviderId[]).find((id) => present(env, providers[id].keyEnv)) ?? "typesafe";
}

/**
 * Model ids live in different namespaces: TypeSafe's have no slash (`jev-latest`), the gateways'
 * do (`typesafe/jev-1.13`). A JEV_MODEL written for one provider is ignored under another, so
 * switching provider never sends an id the new one cannot know. OpenCode's ids have no slash
 * either, so OpenCode accepts only its listed ids, and a setting written for TypeSafe never
 * selects its paid model. The others take any id of their shape, so a new model needs no release.
 */
export function resolveModel(provider: ProviderId, requested: string | undefined): string {
  const { model, models } = providers[provider];
  if (!requested) return model;
  if (models) return models.includes(requested) ? requested : model;
  // Local decision servers own their checkpoint names and may use either shape.
  // OpenJev's backend and Jiwo's configured checkpoint are not gateway model namespaces.
  if (provider === "openjev" || provider === "jiwo") return requested.trim() ? requested : model;
  const fits = requested.includes("/") === (provider !== "typesafe") && !providers.opencode.models?.includes(requested);
  return fits ? requested : model;
}

/**
 * JEV_URL replaces the endpoint outright. TYPESAFE_BASE_URL is the variable TypeSafe's own SDK
 * reads, kept so a local stand-in for Jev (scripts/mock-jev.mjs) plugs in the way it always did.
 */
export function resolveUrl(provider: ProviderId, env: Env): string {
  const explicit = env.JEV_URL?.trim();
  if (explicit) return explicit;
  const base = provider === "typesafe" ? env.TYPESAFE_BASE_URL?.trim() : undefined;
  return base ? `${base.replace(/\/+$/, "")}/v1/systemone` : providers[provider].url;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const MODEL_GONE = new Set([404, 410]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Some gateways return choice answers without a confidence; the winning probability stands in. */
function normalize(result: unknown, layaNative = false): SystemOneResult<Questions> {
  if (!isRecord(result)) return result as SystemOneResult<Questions>;
  const sourceAnswers = isRecord(result.answers) ? result.answers : {};
  const usage = isRecord(result.usage) ? result.usage : {};
  const answers: Record<string, unknown> = {};
  for (const [name, answer] of Object.entries(sourceAnswers)) {
    if (!isRecord(answer)) {
      answers[name] = answer;
      continue;
    }
    if (layaNative && answer.type === "choice") {
      answers[name] = { ...answer, confidence: answer.answer_confidence };
      continue;
    }
    const probabilities = isRecord(answer.probabilities)
      ? Object.values(answer.probabilities).filter((value): value is number => typeof value === "number")
      : [];
    const normalized =
      answer.type !== "noul" && typeof answer.confidence !== "number" && probabilities.length
        ? { ...answer, confidence: Math.max(...probabilities) }
        : answer;
    // Laya's own confidence is normalized entropy; x_jev_confidence carries Jev's formula, the
    // scale the gateway's confidence thresholds were tuned around, so it wins when reported.
    if (typeof answer.confidence === "number" && typeof answer.x_jev_confidence === "number") {
      (normalized as { confidence: number }).confidence = answer.x_jev_confidence;
    }
    answers[name] = normalized;
  }
  return {
    model: result.model,
    answers,
    routing: result.routing,
    usage: { ...usage, input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 },
  } as unknown as SystemOneResult<Questions>;
}

/** The one call the gateway makes to Jev, for whichever provider is configured. */
export function createAskJev(
  config: Pick<Config, "jevProvider" | "jevApiKey" | "jevUrl" | "jevTimeoutMs"> &
    Partial<Pick<Config, "jevMaxLen" | "jiwoMaxStateChars" | "layaRoutingPolicy">>,
  fetchImpl: typeof fetch = fetch,
): AskJev {
  const provider = providers[config.jevProvider];
  const jiwo = config.jevProvider === "jiwo";
  if (!config.jevApiKey && !provider.keyless) {
    throw new Error(`No API key for Jev: set ${provider.keyEnv} (${provider.label}), or run jev-codex --setup.`);
  }
  const kev = config.jevProvider === "kev";
  const once = async (request: SystemOneRequest<Questions>) => {
    if (
      kev &&
      (Object.hasOwn(request, "assets") ||
        Object.values(request.questions).some(
          (question) => !(question.type === "choice" || question.type === "noul" || question.type === "score"),
        ))
    ) {
      throw new Error("kev_unsupported_request");
    }
    const outbound = jiwo
      ? (toJiwoRequest({
          ...request,
          state: JSON.stringify(sanitizeJiwoState(request.state, config.jiwoMaxStateChars ?? 7_000)),
        }) as SystemOneRequest<Questions>)
      : request;
    const response = await fetchImpl(config.jevUrl, {
      method: "POST",
      headers: {
        ...(config.jevApiKey ? { authorization: `Bearer ${config.jevApiKey}` } : {}),
        "content-type": "application/json",
        ...(jiwo || kev
          ? {}
          : {
              "http-referer": "https://github.com/1arley/jev-advisor-gateway",
              "x-title": "jev-advisor-gateway",
            }),
      },
      // Laya may otherwise trim state to its default 1,024-token window.
      body: JSON.stringify(
        config.jevProvider === "laya" && config.jevMaxLen !== undefined ? { ...outbound, max_len: config.jevMaxLen } : outbound,
      ),
      signal: AbortSignal.timeout(config.jevTimeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      const paidHint =
        config.jevProvider === "opencode" && request.model === provider.model && MODEL_GONE.has(response.status)
          ? `free model unavailable; set JEV_MODEL=${provider.paidModel} for paid Jev. `
          : "";
      throw Object.assign(new Error(`${response.status} from ${provider.label}: ${paidHint}${detail}`), { status: response.status });
    }
    const payload = await response.json();
    if (jiwo) return fromJiwoResult(payload, request, outbound);
    return normalize(
      payload,
      config.jevProvider === "laya" && config.layaRoutingPolicy !== undefined && config.layaRoutingPolicy !== "legacy",
    );
  };
  // One fast retry only: past that, failing open to the LLM is quicker.
  return async (request) => {
    try {
      return await once(request);
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (
        config.jevProvider === "jiwo" ||
        config.jevProvider === "kev" ||
        (config.jevProvider === "laya" && (name === "TimeoutError" || name === "AbortError"))
      )
        throw error;
      const status = (error as { status?: number }).status;
      if (status !== undefined && !RETRYABLE.has(status)) throw error;
      await new Promise((done) => setTimeout(done, 100));
      return once(request);
    }
  };
}
