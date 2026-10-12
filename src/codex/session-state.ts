import type { RouterInput, Turn } from "../types.js";

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

/** Read just the response ID from JSON or SSE, keeping the body clone bounded and off the client path. */
export async function readResponseId(response: Response): Promise<string | undefined> {
  try {
    let pending = "";
    const reader = response.clone().body?.pipeThrough(new TextDecoderStream()).getReader();
    if (!reader) return undefined;
    let format: "json" | "sse" | undefined;
    const responseId = (value: string): string | undefined => {
      try {
        const data = JSON.parse(value) as { type?: string; id?: unknown; response?: { id?: unknown } };
        const id = data.response?.id ?? data.id;
        return typeof id === "string" ? id : undefined;
      } catch {
        return undefined;
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) return undefined;
      pending += value;
      if (!format) {
        const first = pending.trimStart()[0];
        if (!first) continue;
        format = first === "{" ? "json" : "sse";
      }
      if (format === "json") {
        const id = responseId(pending);
        if (id) {
          await reader.cancel();
          return id;
        }
        if (pending.length > 64_000) return undefined;
        continue;
      }
      if (pending.length > 64_000) pending = pending.slice(-16_000);
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const id = responseId(line.slice(5));
        if (id) {
          await reader.cancel();
          return id;
        }
      }
    }
  } catch {
    return undefined;
  }
}
