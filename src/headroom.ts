import type { ResponsesRequest } from "./adapters/responses.js";
import type { Config } from "./config.js";

/**
 * The optional Headroom compression (see decision-record.md): off by default, an explicitly
 * configured loopback `/v1/compress` URL, and the narrow Codex continuation scope recorded in the
 * decision record. Shadow and compress send the eligible tool output to the local service; shadow
 * only avoids changing the body sent upstream.
 */

export type HeadroomMetric = {
  mode: "shadow" | "compress";
  result: "ineligible" | "compressed" | "unchanged" | "error";
  latencyMs?: number;
  tokensBefore?: number;
  tokensAfter?: number;
};

/** Compress one synthetic/live tool output without sending upstream credentials or following redirects. */
export async function compressToolOutput(
  req: ResponsesRequest,
  config: Config,
  fetchImpl: typeof fetch,
): Promise<{ output?: string; inputIndex?: number; metric: HeadroomMetric }> {
  const metric: HeadroomMetric = { mode: config.headroomMode as "shadow" | "compress", result: "ineligible" };
  const items = Array.isArray(req.input) ? req.input : [];
  const outputs = items.filter((item) => item && typeof item.type === "string" && item.type.endsWith("_output"));
  const item = outputs.length === 1 ? outputs[0] : undefined;
  if (
    config.client !== "codex" ||
    !req.previous_response_id ||
    outputs.length !== 1 ||
    item?.type !== "function_call_output" ||
    typeof item.call_id !== "string" ||
    !item.call_id ||
    typeof item.output !== "string" ||
    !item.output ||
    typeof req.model !== "string" ||
    !config.headroomUrl
  ) return { metric };

  const startedAt = performance.now();
  try {
    const response = await fetchImpl(config.headroomUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: req.model, messages: [{ role: "tool", tool_call_id: item.call_id, content: item.output }] }),
      redirect: "error",
      signal: AbortSignal.timeout(config.headroomTimeoutMs),
    });
    if (!response.ok) throw new Error("Headroom rejected the request");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") throw new Error("Unexpected Headroom response");
    const result = data as Record<string, unknown>;
    const messages = result.messages;
    if (!Array.isArray(messages) || messages.length !== 1 || !Array.isArray(result.ccr_hashes) || result.ccr_hashes.length !== 0) {
      throw new Error("Unexpected Headroom response");
    }
    const message: unknown = messages[0];
    if (!message || typeof message !== "object") throw new Error("Unexpected Headroom message");
    const compressed = message as Record<string, unknown>;
    if (
      compressed.role !== "tool" ||
      compressed.tool_call_id !== item.call_id ||
      typeof compressed.content !== "string" ||
      !compressed.content ||
      compressed.content.length > item.output.length ||
      Object.keys(compressed).some((key) => !["role", "tool_call_id", "content"].includes(key)) ||
      /<<\s*ccr:|retrieve (?:more|original):\s*hash=/i.test(compressed.content)
    ) throw new Error("Unexpected Headroom output");
    metric.latencyMs = Math.round(performance.now() - startedAt);
    if (typeof result.tokens_before === "number" && Number.isFinite(result.tokens_before) && result.tokens_before >= 0) {
      metric.tokensBefore = result.tokens_before;
    }
    if (typeof result.tokens_after === "number" && Number.isFinite(result.tokens_after) && result.tokens_after >= 0) {
      metric.tokensAfter = result.tokens_after;
    }
    if (compressed.content.length === item.output.length) {
      metric.result = "unchanged";
      return { metric };
    }
    if (compressed.content.length > item.output.length) throw new Error("Headroom output grew");
    metric.result = "compressed";
    return { output: compressed.content, inputIndex: items.indexOf(item), metric };
  } catch {
    metric.result = "error";
    metric.latencyMs = Math.round(performance.now() - startedAt);
    return { metric };
  }
}
