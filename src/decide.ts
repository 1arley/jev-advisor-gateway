import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import type { Config } from "./config.js";
import {
  argKey,
  buildQuestions,
  buildShortlistQuestions,
  MAX_TOOLS,
  NEEDS_TOOL_KEY,
  NO_TOOL,
  NONE_OF_THESE,
  shardKey,
  SHORTLIST_PER_SHARD,
  statedKey,
  TOOL_KEY,
  type ToolPlan,
} from "./questions.js";
import { buildState } from "./state.js";
import type { Json, RouterInput, RouterTool } from "./types.js";

/** The one Jev call the router makes; injectable so tests need no network. */
export type AskJev = (request: SystemOneRequest<Questions>) => Promise<SystemOneResult<Questions>>;

export interface JevTrace {
  choice: string;
  confidence: number;
  needsTool: number;
  topProbabilities: Record<string, number>;
  inputTokens: number;
  latencyMs: number;
  /** Tools that survived the first pass, when the roster needed one. */
  shortlist?: string[];
}

export type Decision = { jev?: JevTrace } & (
  | { mode: "passthrough"; reason: string }
  /** Jev is confident no tool is needed: the LLM replies in text. */
  | { mode: "none"; confidence: number }
  /** Jev picked the tool: the LLM only fills in its arguments. */
  | { mode: "forced"; tool: string; kind: RouterTool["kind"]; confidence: number }
  /** Jev picked the tool, but this request can only be nudged: the LLM is told, not forced. */
  | { mode: "hint"; tool: string; confidence: number }
  /** Jev picked the tool and every argument: no LLM call at all. */
  | { mode: "direct"; tool: string; args: Record<string, Json>; confidence: number }
);

type Answers = SystemOneResult<Questions>["answers"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A stable reason code for a failed Jev call. Reasons reach response headers, the request log and
 * the dashboard, and a provider's error body is someone else's text (Cloudflare once served an
 * HTML block page that ended up in the reason header): so a failure is named by class, never by
 * the exception's own words.
 */
function failureReason(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "jev_timeout";
  const status = isRecord(error) && typeof error.status === "number" ? error.status : undefined;
  if (status !== undefined && status >= 100 && status <= 599) return `jev_http_${status}`;
  return "jev_error";
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validAnswer(question: Questions[string], value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (question.type === "noul") return value.type === "noul" && isProbability(value.noul);
  if (question.type !== "choice" || value.type !== "choice" || typeof value.choice !== "string") return false;
  if (!isProbability(value.confidence) || !Object.hasOwn(question.criteria, value.choice)) return false;
  const distribution = value.probabilities;
  if (!isRecord(distribution)) return false;

  const probabilities = Object.keys(distribution);
  return Object.hasOwn(distribution, value.choice) && probabilities.every((option) =>
    Object.hasOwn(question.criteria, option) && isProbability(distribution[option]),
  );
}

function validResult(result: unknown, questions: Questions): result is SystemOneResult<Questions> {
  if (!isRecord(result) || !isRecord(result.answers) || !isRecord(result.usage)) return false;
  if (!isTokenCount(result.usage.input_tokens) || !isTokenCount(result.usage.output_tokens)) return false;
  const answers = result.answers;
  return Object.entries(questions).every(([key, question]) =>
    Object.hasOwn(answers, key) && validAnswer(question, answers[key]),
  );
}

/**
 * A tool's name is whatever the client sent, and the client got it from wherever its tools come
 * from: an MCP server, a plugin, a package. The gateway offers it to Jev as an option and, in
 * `hint` mode, writes it into text the LLM reads as the host's. So it must stay one inert token,
 * with no whitespace, quotes or angle brackets to break out of either with. The providers' own
 * rules for names are at least this strict: a request that fails here is theirs to refuse.
 */
const SAFE_TOOL_NAME = /^[\p{L}\p{N}_.:/-]{1,128}$/u;

/** Why a request is not Jev's to decide, or undefined when it is. */
function skipReason(input: RouterInput): string | undefined {
  if (input.turns.length === 0) return "no_messages";
  if (input.tools.length === 0) return "no_tools";
  if (input.tools.length > MAX_TOOLS * 255) return "too_many_tools";
  if (input.tools.some((tool) => typeof tool.name !== "string" || !SAFE_TOOL_NAME.test(tool.name))) return "unsafe_tool_name";
  if (new Set(input.tools.map((tool) => tool.name)).size !== input.tools.length) return "duplicate_tool_names";
  if (input.tools.some((tool) => tool.name === NO_TOOL)) return "reserved_tool_name";
  if (input.toolChoice === "decided") return "tool_choice_already_decided";
  return undefined;
}

/** Fill every argument from Jev's answers; the weakest judgement bounds the whole call. */
function resolveArgs(
  plan: ToolPlan,
  toolIndex: number,
  answers: Answers,
  minCertainty: number,
): { args: Record<string, Json>; certainty: number } | undefined {
  const args: Record<string, Json> = {};
  let certainty = 1;
  for (const param of plan.closedParams ?? []) {
    if (param.kind === "const") {
      if (param.required) args[param.name] = param.value;
      continue;
    }
    if (!param.required) {
      const stated = answers[statedKey(toolIndex, param.name)];
      if (stated?.type !== "noul") return undefined;
      certainty = Math.min(certainty, Math.max(stated.noul, 1 - stated.noul));
      if (stated.noul < 0.5) continue;
    }
    const answer = answers[argKey(toolIndex, param.name)];
    if (param.kind === "boolean" && answer?.type === "noul") {
      args[param.name] = answer.noul >= 0.5;
      certainty = Math.min(certainty, Math.max(answer.noul, 1 - answer.noul));
    } else if (param.kind === "enum" && answer?.type === "choice" && param.values.has(answer.choice)) {
      args[param.name] = param.values.get(answer.choice)!;
      certainty = Math.min(certainty, answer.confidence);
    } else {
      return undefined;
    }
  }
  return certainty >= minCertainty ? { args, certainty } : undefined;
}

/** The strongest few tools of every shard, ranked in a single Jev call. */
async function shortlist(
  tools: RouterTool[],
  state: SystemOneRequest<Questions>["state"],
  config: Config,
  askJev: AskJev,
): Promise<{ tools: RouterTool[]; inputTokens: number } | undefined> {
  const { questions, shards } = buildShortlistQuestions(tools);
  const result = await askJev({ state, questions, model: config.jevModel });
  if (!validResult(result, questions)) return undefined;
  const kept = shards.flatMap((shard, index) => {
    const answer = result.answers[shardKey(index)];
    if (answer?.type !== "choice") return [];
    const ranked = Object.entries(answer.probabilities)
      .filter(([name]) => name !== NONE_OF_THESE)
      .sort(([, a], [, b]) => b - a)
      .slice(0, SHORTLIST_PER_SHARD)
      .map(([name]) => name);
    return shard.filter((tool) => ranked.includes(tool.name));
  });
  return { tools: kept, inputTokens: result.usage.input_tokens };
}

export async function decide(input: RouterInput, config: Config, askJev: AskJev): Promise<Decision> {
  const skip = skipReason(input);
  if (skip) return { mode: "passthrough", reason: skip };

  const startedAt = performance.now();
  const state = buildState(input, config);
  let tools = input.tools;
  let shortlistTokens = 0;
  let result: SystemOneResult<Questions>;
  let plans: ToolPlan[];
  try {
    if (tools.length > MAX_TOOLS) {
      const shortlisted = await shortlist(tools, state, config, askJev);
      if (!shortlisted) return { mode: "passthrough", reason: "jev_unexpected_answer" };
      ({ tools, inputTokens: shortlistTokens } = shortlisted);
      if (tools.length === 0) return { mode: "passthrough", reason: "jev_unexpected_answer" };
    }
    const built = buildQuestions(tools, {
      allowNone: input.toolChoice !== "required",
      withArgs: config.directCalls,
    });
    plans = built.plans;
    result = await askJev({ state, questions: built.questions, model: config.jevModel });
    if (!validResult(result, built.questions)) return { mode: "passthrough", reason: "jev_unexpected_answer" };
  } catch (error) {
    // Fail open: a Jev outage must never take the gateway down with it.
    return { mode: "passthrough", reason: failureReason(error) };
  }

  const picked = result.answers[TOOL_KEY];
  const needs = result.answers[NEEDS_TOOL_KEY];
  if (picked?.type !== "choice" || needs?.type !== "noul") {
    return { mode: "passthrough", reason: "jev_unexpected_answer" };
  }
  const jev: JevTrace = {
    choice: picked.choice,
    confidence: picked.confidence,
    needsTool: needs.noul,
    topProbabilities: Object.fromEntries(
      Object.entries(picked.probabilities)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3),
    ),
    inputTokens: result.usage.input_tokens + shortlistTokens,
    latencyMs: Math.round(performance.now() - startedAt),
    ...(tools === input.tools ? {} : { shortlist: tools.map((tool) => tool.name) }),
  };

  if (picked.confidence < config.minConfidence) return { mode: "passthrough", reason: "low_confidence", jev };
  // Two independent questions must agree before the router overrides the LLM.
  const wantsTool = picked.choice !== NO_TOOL;
  if (wantsTool ? needs.noul < 0.3 : needs.noul > 0.7) {
    return { mode: "passthrough", reason: "jev_answers_disagree", jev };
  }

  if (!wantsTool) {
    // A hint can suggest a tool; suggesting silence would only risk ending an agent's turn early.
    return config.onNone === "force_none" && input.steer !== "hint"
      ? { mode: "none", confidence: picked.confidence, jev }
      : { mode: "passthrough", reason: "no_tool_needed", jev };
  }

  const toolIndex = plans.findIndex((plan) => plan.name === picked.choice);
  const plan = plans[toolIndex];
  const tool = tools[toolIndex];
  if (!plan || !tool) return { mode: "passthrough", reason: "jev_unknown_tool", jev };
  // Provider-run tools can't be forced by name; knowing Jev wants one is still worth logging.
  if (tool.kind === "hosted") return { mode: "passthrough", reason: "hosted_tool_selected", jev };
  // Neither can namespaced ones: backends reject both `tool_choice.namespace` and the bare name.
  if (tool.namespace) return { mode: "passthrough", reason: "namespaced_tool_selected", jev };

  const resolved = plan.closedParams && resolveArgs(plan, toolIndex, result.answers, config.argMinCertainty);
  // With thinking on, an answer built here carries no thinking block. The client replays it on the
  // next turn, and the API rejects an assistant tool_use that does not start with one: the
  // session would be stuck. So such a request is steered (hint) and the LLM makes the call.
  if (config.directCalls && resolved && !input.thinking) {
    return {
      mode: "direct",
      tool: plan.name,
      args: resolved.args,
      confidence: Math.min(picked.confidence, resolved.certainty),
      jev,
    };
  }
  if (input.steer === "hint") return { mode: "hint", tool: plan.name, confidence: picked.confidence, jev };
  return { mode: "forced", tool: plan.name, kind: tool.kind, confidence: picked.confidence, jev };
}
