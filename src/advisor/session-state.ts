import type { RouterInput, Turn } from "../types.js";
import { readReply } from "../usage.js";

export interface SessionState {
  recent: string[];
  lastAdvisorAt: number;
  advisorCalls: number;
}

const TTL_MS = 30 * 60_000;
const MAX_SESSIONS = 512;
const MAX_RECENT = 12;
const MAX_EVENT_CHARS = 1400;

const empty = (): SessionState => ({ recent: [], lastAdvisorAt: 0, advisorCalls: 0 });

function summarize(turn: Turn): string {
  if (turn.role === "tool_result") return `tool result (${String(turn.tool ?? "unknown")}): ${JSON.stringify(turn.content ?? "")}`;
  const calls = Array.isArray(turn.tool_calls) ? turn.tool_calls : [];
  if (calls.length) {
    return `assistant tool call: ${calls.map((call) => {
      const value = call && typeof call === "object" ? call as Record<string, unknown> : {};
      return `${String(value.tool ?? "unknown")} ${JSON.stringify(value.arguments ?? "")}`;
    }).join("; ")}`;
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

/** In-memory continuation hints only; raw conversation is never written to disk. */
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
    get size() {
      prune();
      return byResponse.size;
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
