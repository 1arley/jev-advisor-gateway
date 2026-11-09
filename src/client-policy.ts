import type { Config } from "./config.js";
import type { RouterInput } from "./types.js";

/**
 * Let OpenCode and Codex inspect a tool result when Laya wants to call the same tool again.
 * The rule belongs to the client/provider pairing, not to the shared decision flow.
 */
export function shouldPassThroughRecentToolResult(
  config: Pick<Config, "client" | "jevProvider">,
  input: RouterInput,
  selected: string,
): boolean {
  if (config.jevProvider !== "laya") return false;
  if (config.client !== "opencode" && config.client !== "codex") return false;
  for (const turn of input.turns.toReversed()) {
    if (turn.role === "tool_result" && turn.tool === selected) return true;
    if (turn.role === "assistant" && Array.isArray(turn.tool_calls)) return false;
    if (turn.role === "user") return false;
  }
  return false;
}
