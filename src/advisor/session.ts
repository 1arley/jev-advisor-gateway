import type { AskJev, Decision } from "../decide.js";
import type { Config } from "../config.js";
import { buildState } from "../state.js";
import type { RouterInput, Turn } from "../types.js";
import { readReply } from "../usage.js";

const ACTION_KEY = "session_action";
const ACTIONS = {
  consult_advisor: "Ask the independent advisor to review the current approach or repeated failure before the main agent continues.",
  stop: "Do not make another tool call now; ask the user, report the result, or stop after repeated failure.",
  pass: "No intervention is needed; let the main model decide and act normally.",
};
const CLAUDE_ADVISOR_REASONS = new Set(["low_confidence", "jev_answers_disagree"]);
const CLAUDE_FAILURE_MARKERS = /\b(?:error|fail(?:ed|ure)?|invalid|rejected|denied|timeout|exception|boom)\b/i;
const TTL_MS = 30 * 60_000;
const MAX_SESSIONS = 512;
const MAX_RECENT = 12;
const MAX_EVENT_CHARS = 1400;

export type SessionAction = keyof typeof ACTIONS;

export interface SessionDecision {
  action: SessionAction;
  confidence: number;
  latencyMs: number;
}

export interface SessionState {
  recent: string[];
  lastAdvisorAt: number;
  advisorCalls: number;
}

export interface AdvisorSession {
  input: RouterInput;
  state: SessionState;
  action?: SessionDecision;
}

function empty(): SessionState {
  return { recent: [], lastAdvisorAt: 0, advisorCalls: 0 };
}

function summarize(turn: Turn): string {
  if (turn.role === "tool_result") return `tool result (${String(turn.tool ?? "unknown")}): ${JSON.stringify(turn.content ?? "")}`;
  const calls = Array.isArray(turn.tool_calls) ? turn.tool_calls : [];
  if (calls.length) {
    return `assistant tool call: ${calls
      .map((call) => {
        const value = call && typeof call === "object" ? (call as Record<string, unknown>) : {};
        return `${String(value.tool ?? "unknown")} ${JSON.stringify(value.arguments ?? "")}`;
      })
      .join("; ")}`;
  }
  return `${String(turn.role ?? "unknown")}: ${typeof turn.text === "string" ? turn.text : JSON.stringify(turn.text ?? "")}`;
}

export function addRecent(state: SessionState, input: Pick<RouterInput, "turns">): void {
  for (const turn of input.turns) {
    const line = summarize(turn).slice(0, MAX_EVENT_CHARS);
    if (line.trim()) state.recent.push(line);
  }
  if (state.recent.length > MAX_RECENT) state.recent.splice(0, state.recent.length - MAX_RECENT);
}

function shouldRunClaudePolicy(input: RouterInput): boolean {
  return input.turns.some((turn) => turn.role === "tool_result" || (turn.role === "assistant" && Array.isArray(turn.tool_calls)));
}

function shouldReviewClaude(decision: Decision, state: SessionState): boolean {
  if (decision.mode === "passthrough" && CLAUDE_ADVISOR_REASONS.has(decision.reason)) return true;
  return state.recent.some((event) => event.startsWith("tool result") && CLAUDE_FAILURE_MARKERS.test(event));
}

async function decideSessionAction(input: RouterInput, state: SessionState, config: Config, askJev: AskJev): Promise<SessionDecision> {
  const startedAt = performance.now();
  try {
    const result = await askJev({
      model: config.jevModel,
      state: { ...buildState(input, config), recent_session_events: state.recent },
      questions: {
        [ACTION_KEY]: {
          type: "choice",
          instructions:
            "Decide whether an independent review or a stop signal is useful for the next coding-agent step. " +
            "Consult the independent advisor before a high-stakes plan, after a repeated tool failure, when the tool decision is uncertain, " +
            "or when a proposed completion needs a final check. Otherwise pass control to the main model.",
          criteria: ACTIONS,
        },
      },
    });
    const answer = result.answers[ACTION_KEY];
    if (answer?.type !== "choice" || !(answer.choice in ACTIONS) || answer.confidence < config.minConfidence) {
      return {
        action: "pass",
        confidence: answer?.type === "choice" ? answer.confidence : 0,
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
    return { action: answer.choice as SessionAction, confidence: answer.confidence, latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { action: "pass", confidence: 0, latencyMs: Math.round(performance.now() - startedAt) };
  }
}

export function createSessionStore(now: () => number = Date.now) {
  const byResponse = new Map<string, { state: SessionState; touched: number }>();
  const prune = () => {
    const expiredBefore = now() - TTL_MS;
    for (const [id, entry] of byResponse) if (entry.touched < expiredBefore) byResponse.delete(id);
    while (byResponse.size > MAX_SESSIONS) byResponse.delete(byResponse.keys().next().value!);
  };

  return {
    resume(previousResponseId?: string | null): SessionState {
      prune();
      const saved = previousResponseId ? byResponse.get(previousResponseId) : undefined;
      if (!saved) return empty();
      saved.touched = now();
      return { recent: [...saved.state.recent], lastAdvisorAt: saved.state.lastAdvisorAt, advisorCalls: saved.state.advisorCalls };
    },
    remember(responseId: string | undefined, state: SessionState): void {
      if (!responseId) return;
      prune();
      byResponse.delete(responseId);
      byResponse.set(responseId, {
        state: { recent: [...state.recent], lastAdvisorAt: state.lastAdvisorAt, advisorCalls: state.advisorCalls },
        touched: now(),
      });
      prune();
    },
  };
}

/** Owns advisor-session policy and its bounded, in-memory continuation ledger. */
export function createAdvisorSessions(config: Config, askJev: AskJev, now: () => number = Date.now) {
  const store = createSessionStore(now);

  return {
    async start(
      input: RouterInput,
      previousResponseId: string | null | undefined,
      enabled: boolean,
      model?: string,
    ): Promise<AdvisorSession | undefined> {
      if (!enabled || model === "codex-auto-review") return undefined;
      const state = store.resume(previousResponseId);
      addRecent(state, input);
      const session: AdvisorSession = { input, state };
      if (config.client !== "claude" || shouldRunClaudePolicy(input))
        session.action = await decideSessionAction(input, state, config, askJev);
      return session;
    },
    async afterDecision(session: AdvisorSession, decision: Decision): Promise<void> {
      if (config.client === "claude" && shouldReviewClaude(decision, session.state))
        session.action = await decideSessionAction(session.input, session.state, config, askJev);
    },
    stopDecision(session: AdvisorSession, toolCount: number): SessionDecision | undefined {
      return session.action?.action === "stop" && toolCount > 0 ? session.action : undefined;
    },
    consultation(
      session: AdvisorSession,
      decision: Decision,
      enabled: boolean,
    ): { required: boolean; skipped?: "advisor_off" | "session_budget" } {
      if (!session.action) return { required: false };
      const uncertain = decision.mode === "passthrough" && ["low_confidence", "jev_answers_disagree"].includes(decision.reason);
      if (session.action.action !== "consult_advisor" && !uncertain) return { required: false };
      if (!enabled) return { required: true, skipped: "advisor_off" };
      if (session.state.advisorCalls >= config.advisorMaxCallsPerSession) return { required: true, skipped: "session_budget" };
      return { required: true };
    },
    noteAdded(session: AdvisorSession): void {
      session.state.lastAdvisorAt = now();
      session.state.advisorCalls++;
    },
    remember(responseId: string | undefined, session: AdvisorSession): void {
      store.remember(responseId, session.state);
    },
  };
}

/** Read the response ID from the shared reply scan. */
export async function readResponseId(response: Response): Promise<string | undefined> {
  try {
    return (await readReply(response.clone())).responseId;
  } catch {
    return undefined;
  }
}
