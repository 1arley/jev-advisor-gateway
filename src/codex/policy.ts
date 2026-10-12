import type { AskJev } from "../decide.js";
import type { Config } from "../config.js";
import { buildState } from "../state.js";
import type { RouterInput } from "../types.js";
import type { SessionState } from "./session-state.js";

const ACTION_KEY = "session_action";
const ACTIONS = {
  consult_astra: "Ask the independent advisor to review the current approach or repeated failure before the main agent continues.",
  stop: "Do not make another tool call now; ask the user, report the result, or stop after repeated failure.",
  pass: "No intervention is needed; let the main agent decide and act normally.",
};

export type SessionAction = keyof typeof ACTIONS;

export interface SessionDecision {
  action: SessionAction;
  confidence: number;
  latencyMs: number;
}

export async function decideSessionAction(
  input: RouterInput,
  session: SessionState,
  config: Config,
  askJev: AskJev,
): Promise<SessionDecision> {
  const startedAt = performance.now();
  const result = await askJev({
    model: config.jevModel,
    state: { ...buildState(input, config), recent_session_events: session.recent },
    questions: {
      [ACTION_KEY]: {
        type: "choice",
        instructions:
          "Decide whether an independent review or a stop signal is useful for the next coding-agent step. " +
          "Consult Astra before a high-stakes plan, after a repeated tool failure, when the tool decision is uncertain, " +
          "or when a proposed completion needs a final check. Otherwise pass control to the main model.",
        criteria: ACTIONS,
      },
    },
  });
  const answer = result.answers[ACTION_KEY];
  if (answer?.type !== "choice" || !(answer.choice in ACTIONS) || answer.confidence < config.minConfidence) {
    return { action: "pass", confidence: answer?.type === "choice" ? answer.confidence : 0, latencyMs: Math.round(performance.now() - startedAt) };
  }
  return {
    action: answer.choice as SessionAction,
    confidence: answer.confidence,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}
