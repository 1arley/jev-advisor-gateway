import { peel } from "./proto/connect.js";
import { readFields, text } from "./proto/wire.js";

/**
 * Token usage of one LLM call, in one vocabulary whatever the provider's. `input` is everything
 * the model read, cached or not — Anthropic reports its three input buckets separately, OpenAI
 * reports a total with the cached part inside; both end up here as a total plus its cached share.
 */
export interface Usage {
  input: number;
  output: number;
  /** Part of `input` served from the prompt cache (billed at a fraction). */
  cached: number;
  /** Part of `input` written to the prompt cache (Anthropic only; billed at a premium). */
  cacheWrite: number;
  /**
   * Part of `cacheWrite` written with a 1h TTL, billed above the 5m rate. Stays zero when the
   * upstream does not break the writes down by TTL, so billing falls back to the 5m rate.
   */
  cacheWrite1h: number;
  /** Part of `output` spent on hidden reasoning, when the provider says (OpenAI). */
  reasoning: number;
}

type Raw = Record<string, unknown>;

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const obj = (value: unknown): Raw => (value && typeof value === "object" ? (value as Raw) : {});

/** Fold one provider `usage` object into the running total; later reports override earlier ones. */
function merge(into: Partial<Usage>, raw: Raw): void {
  if ("prompt_tokens" in raw || "completion_tokens" in raw) {
    // Chat Completions
    into.input = num(raw.prompt_tokens);
    into.output = num(raw.completion_tokens);
    into.cached = num(obj(raw.prompt_tokens_details).cached_tokens);
    into.reasoning = num(obj(raw.completion_tokens_details).reasoning_tokens);
  } else if ("cache_read_input_tokens" in raw || "cache_creation_input_tokens" in raw) {
    // Anthropic, message_start: the input side, with a placeholder output count.
    into.cached = num(raw.cache_read_input_tokens);
    into.cacheWrite = num(raw.cache_creation_input_tokens);
    // The TTL split only arrives in the breakdown; a later event that repeats the total without
    // it must not wipe the split, so only overwrite when the breakdown is actually present.
    const creation = obj(raw.cache_creation);
    if ("ephemeral_1h_input_tokens" in creation || "ephemeral_5m_input_tokens" in creation) {
      into.cacheWrite1h = num(creation.ephemeral_1h_input_tokens);
    }
    into.input = num(raw.input_tokens) + into.cached + into.cacheWrite;
    into.output = num(raw.output_tokens);
  } else if ("promptTokenCount" in raw || "candidatesTokenCount" in raw) {
    // Google Gemini API (usageMetadata)
    into.input = num(raw.promptTokenCount);
    into.output = num(raw.candidatesTokenCount);
    into.cached = num(raw.cachedContentTokenCount);
  } else {
    // Responses API — or Anthropic's message_delta, which only updates the output count.
    if ("input_tokens" in raw) {
      into.input = num(raw.input_tokens);
      into.cached = num(obj(raw.input_tokens_details).cached_tokens);
    }
    if ("output_tokens" in raw) {
      into.output = num(raw.output_tokens);
      into.reasoning = num(obj(raw.output_tokens_details).reasoning_tokens);
    }
  }
}

function collect(payload: unknown, into: Partial<Usage>): void {
  const root = obj(payload);
  // Where each API keeps it: top level (JSON replies, chat chunks, message_delta),
  // `response.usage` (Responses events), `message.usage` (Anthropic message_start), `usageMetadata` (Gemini).
  for (const holder of [root, obj(root.response), obj(root.message)]) {
    if (holder.usage && typeof holder.usage === "object") merge(into, holder.usage as Raw);
    if (holder.usageMetadata && typeof holder.usageMetadata === "object") merge(into, holder.usageMetadata as Raw);
  }
}

/**
 * The name of the first tool the reply called, whatever it streamed in: Chat Completions deltas
 * and JSON carry `tool_calls: [{ function: { name } }]`, Responses items are `function_call` /
 * `custom_tool_call` with the name on top, Anthropic blocks are `tool_use`, Gemini parts are
 * `functionCall`. Only tool-shaped nodes count, so an assistant answering with the word "tool"
 * in text never becomes one.
 */
function firstToolName(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const name = firstToolName(item);
      if (name !== undefined) return name;
    }
    return undefined;
  }
  const raw = obj(node);
  const calls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
  for (const call of calls) {
    const name = obj(obj(call).function).name;
    if (typeof name === "string") return name;
  }
  if (
    typeof raw.name === "string" &&
    (raw.type === "function_call" || raw.type === "custom_tool_call" || raw.type === "tool_use")
  ) return raw.name;
  const called = obj(raw.functionCall);
  if (typeof called.name === "string") return called.name;
  for (const value of Object.values(raw)) {
    const name = firstToolName(value);
    if (name !== undefined) return name;
  }
  return undefined;
}

/** exa's counters ride in field-28 stats groups: entries keyed by name, valued as fixed32
 *  floats — the wire carries "model" strings in the same shape, so unknown keys are skipped. */
async function readConnectUsage(response: Response): Promise<Usage | undefined> {
  const found: Partial<Usage> = {};
  try {
    for (const { payload } of peel(new Uint8Array(await response.arrayBuffer()))) {
      for (const group of readFields(payload)) {
        if (group.field !== 28) continue;
        for (const entry of readFields(group.bytes ?? new Uint8Array())) {
          if (entry.field !== 2) continue;
          const e = readFields(entry.bytes ?? new Uint8Array());
          const wrapper = e.find((f) => f.field === 4)?.bytes;
          const value = wrapper ? readFields(wrapper).find((f) => f.field === 2)?.bytes : undefined;
          if (!value || value.length !== 4) continue;
          const v = new DataView(value.buffer, value.byteOffset, 4).getFloat32(0, true);
          const key = text(e.find((f) => f.field === 5));
          if (key === "input_tokens") found.input = v;
          else if (key === "output_tokens") found.output = v;
          else if (key === "cached_input_tokens") found.cached = v;
        }
      }
    }
  } catch {
    // A truncated body peels nothing: report nothing rather than guess.
  }
  if (found.input === undefined && found.output === undefined) return undefined;
  return { input: 0, output: 0, cached: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, ...found };
}

/** What one reply carries: its cost, and the first tool it called (see `firstToolName`). */
export interface Reply {
  usage?: Usage;
  tool?: string;
  responseId?: string;
}

/**
 * Read a reply to its end and report what it cost, and the tool it called. Works on a clone, in
 * the background: the client's own stream is never delayed. A stream cut short (Codex hangs up as
 * soon as it has `response.completed`) still yields whatever arrived before the cut.
 */
export async function readReply(response: Response): Promise<Reply> {
  // Connect streams are binary: peel envelopes instead of scanning lines. A Connect reply's tool
  // calls live in its own unary encoding, which the usage reader does not parse, so only usage
  // comes back for those.
  if (response.headers.get("content-type")?.includes("connect+proto")) {
    const usage = await readConnectUsage(response);
    return usage ? { usage } : {};
  }
  const found: Partial<Usage> = {};
  let tool: string | undefined;
  let responseId: string | undefined;
  const readId = (payload: unknown) => {
    const root = obj(payload);
    const id = obj(root.response).id ?? root.id;
    if (typeof id === "string" && id) responseId ??= id;
  };
  // Told apart by content, not by header: the ChatGPT Codex backend streams events without
  // sending any content-type at all.
  let streaming: boolean | undefined;
  let pending = "";
  const scan = (line: string) => {
    // Most stream events are text deltas; deltas that carry usage or a tool shape are worth
    // parsing. (`"usage` with no closing quote also matches Gemini's `usageMetadata`.)
    if (!line.startsWith("data:")) return;
    const data = line.slice(5);
    if (!(data.includes('"usage') || data.includes('"tool') || data.includes('"function_c') || data.includes('"functionCall') || data.includes('"response"') || data.includes('"id"'))) return;
    try {
      const payload: unknown = JSON.parse(data);
      collect(payload, found);
      readId(payload);
      const name = firstToolName(payload);
      if (name !== undefined && tool === undefined) tool = name;
    } catch {
      // A line cut short by the client hanging up.
    }
  };
  try {
    for await (const chunk of response.body?.pipeThrough(new TextDecoderStream()) ?? []) {
      pending += chunk;
      streaming ??= /^\s*$/.test(pending) ? undefined : !/^\s*[{[]/.test(pending);
      if (!streaming) continue;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      lines.forEach(scan);
    }
  } catch {
    // Aborted mid-stream: keep what was seen.
  }
  if (streaming) scan(pending);
  else {
    try {
      const payload: unknown = JSON.parse(pending);
      collect(payload, found);
      readId(payload);
      const name = firstToolName(payload);
      if (name !== undefined && tool === undefined) tool = name;
    } catch {
      // Not JSON (an HTML error page, an empty body): nothing to report.
    }
  }
  const usage: Usage | undefined =
    found.input === undefined && found.output === undefined
      ? undefined
      : { input: 0, output: 0, cached: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, ...found };
  return { ...(usage ? { usage } : {}), ...(tool !== undefined ? { tool } : {}), ...(responseId ? { responseId } : {}) };
}

/** The cost of one reply, alone; tool observation rides along in the same read. */
export async function readUsage(response: Response): Promise<Usage | undefined> {
  return (await readReply(response)).usage;
}
