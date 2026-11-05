import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/**
 * What the dashboard knows about one routed request. Built field by field from a log entry and
 * never by spreading it: a `direct` decision carries the tool's arguments, and those — like
 * prompts, bodies and credentials — must not reach a browser.
 */
export interface RouteEvent {
  seq: number;
  time: string;
  path: string;
  model?: string;
  tools: number;
  mode: string;
  reason?: string;
  tool?: string;
  confidence?: number;
  /** Upstream HTTP status; absent for `direct`, which never calls upstream. */
  status?: number;
  /** How long the whole request took, reply included. */
  durationMs?: number;
  /** The first tool the reply actually called, read off the response in the background. */
  actualTool?: string;
  /** What the LLM call cost, as the provider reported it; absent for `direct` and failed calls. */
  usage?: { input: number; output: number; cached: number; cacheWrite: number; cacheWrite1h: number; reasoning: number };
  /** Present whenever Jev answered, even if the router then let the LLM decide. */
  jev?: {
    choice: string;
    confidence: number;
    latencyMs: number;
    inputTokens: number;
    policy?: string;
    confidenceMetric?: string;
    requestedCheckpoint?: string;
    effectiveCheckpoint?: string;
    optionCount?: number;
    truncated?: boolean;
    truncatedQuestions?: number;
    shortlist?: string[];
  };
  shadow?: {
    policy?: string;
    mode?: string;
    reason?: string;
    choice?: string;
    confidence?: number;
    latencyMs?: number;
    agreement?: boolean;
  };
  /** The advisor consult and what it cost, when this router has one. */
  advisor?: {
    model?: string;
    consulted: boolean;
    calls: number;
    usage?: { input: number; output: number; cached: number; cacheWrite: number; cacheWrite1h: number; reasoning: number };
  };
}

export interface EventLog {
  record(entry: Record<string, unknown>): void;
  /** Events newer than `seq`, oldest first. */
  since(seq: number): RouteEvent[];
  /** Sequence number of the newest event: how many were ever recorded, history included. */
  readonly last: number;
}

const DEFAULT_CAPACITY = 1000;
/** Enough of a log's tail to fill the buffer; a Claude Code line with a shortlist is ~1 kB. */
const HISTORY_BYTES = 2 * 1024 * 1024;

const text = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : undefined);
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Operational observations from retained events, never a measure of labeled accuracy. */
export function summarizeRouting(events: RouteEvent[]) {
  const fallbacks: Record<string, number> = Object.create(null);
  const errors: Record<string, number> = Object.create(null);
  let applied = 0;
  let abstentions = 0;
  for (const event of events) {
    if (event.mode !== "passthrough") applied++;
    else {
      const reason = event.reason ?? "unknown";
      fallbacks[reason] = (fallbacks[reason] ?? 0) + 1;
      if (["low_confidence", "jev_answers_disagree"].includes(reason)) abstentions++;
      if (/^(jev_(error|timeout|http_)|router_error|upstream_rejected)/.test(reason)) errors[reason] = (errors[reason] ?? 0) + 1;
    }
  }
  const answered = events.filter((event) => event.jev);
  const latencies = answered.map((event) => event.jev!.latencyMs).sort((a, b) => a - b);
  const observed = [...events].reverse().find((event) => event.jev || errors[event.reason ?? ""]);
  const comparisons = events.filter((event) => event.shadow?.agreement !== undefined);
  return {
    retained: events.length,
    applied,
    abstentions,
    fallbacks,
    errors,
    state: !observed ? "unobserved" : observed.jev ? "answered" : "error",
    observedAt: observed?.time,
    effectiveCheckpoint: [...answered].reverse().find((event) => event.jev?.effectiveCheckpoint)?.jev?.effectiveCheckpoint,
    comparisons: comparisons.length,
    divergences: comparisons.filter((event) => event.shadow?.agreement === false).length,
    shadowErrors: events.filter((event) => event.shadow?.reason === "shadow_error").length,
    shadowBusy: events.filter((event) => event.shadow?.reason === "shadow_busy").length,
    truncationReported: answered.filter((event) => event.jev?.truncated !== undefined).length,
    truncated: answered.filter((event) => event.jev?.truncated === true).length,
    latencyMeanMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : undefined,
    latencyP95Ms: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : undefined,
  };
}

/** A provider `usage` object, rebuilt field by field so nothing else it carries is exposed. */
const usageOf = (value: unknown) => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  return (
    raw && {
      input: number(raw.input) ?? 0,
      output: number(raw.output) ?? 0,
      cached: number(raw.cached) ?? 0,
      cacheWrite: number(raw.cacheWrite) ?? 0,
      cacheWrite1h: number(raw.cacheWrite1h) ?? 0,
      reasoning: number(raw.reasoning) ?? 0,
    }
  );
};

function toEvent(entry: Record<string, unknown>, seq: number): RouteEvent | undefined {
  const mode = text(entry.mode);
  if (entry.event !== "route" || !mode) return undefined;
  const jev = entry.jev && typeof entry.jev === "object" ? (entry.jev as Record<string, unknown>) : undefined;
  const shadow = entry.shadow && typeof entry.shadow === "object" ? (entry.shadow as Record<string, unknown>) : undefined;
  const advisor = entry.advisor && typeof entry.advisor === "object" ? (entry.advisor as Record<string, unknown>) : undefined;
  const advisorUsage = usageOf(advisor?.usage);
  return {
    seq,
    time: text(entry.time) ?? new Date().toISOString(),
    path: text(entry.path) ?? "",
    model: text(entry.model),
    tools: number(entry.tools) ?? 0,
    mode,
    reason: text(entry.reason),
    tool: text(entry.tool),
    confidence: number(entry.confidence),
    status: number(entry.status),
    durationMs: number(entry.durationMs),
    actualTool: text(entry.actualTool),
    usage: usageOf(entry.usage),
    jev: jev && {
      choice: text(jev.choice) ?? "",
      confidence: number(jev.confidence) ?? 0,
      latencyMs: number(jev.latencyMs) ?? 0,
      inputTokens: number(jev.inputTokens) ?? 0,
      policy: text(jev.policy),
      confidenceMetric: text(jev.confidenceMetric),
      requestedCheckpoint: text(jev.requestedCheckpoint),
      effectiveCheckpoint: text(jev.effectiveCheckpoint),
      optionCount: number(jev.optionCount),
      truncated: typeof jev.truncated === "boolean" ? jev.truncated : undefined,
      truncatedQuestions: number(jev.truncatedQuestions),
      shortlist: Array.isArray(jev.shortlist) ? jev.shortlist.flatMap((name) => text(name) ?? []) : undefined,
    },
    shadow: shadow && {
      policy: text(shadow.policy),
      mode: text(shadow.mode),
      reason: text(shadow.reason),
      choice: text(shadow.choice),
      confidence: number(shadow.confidence),
      latencyMs: number(shadow.latencyMs),
      agreement: typeof shadow.agreement === "boolean" ? shadow.agreement : undefined,
    },
    advisor: advisor && {
      model: text(advisor.model),
      consulted: advisor.consulted === true,
      calls: number(advisor.calls) ?? 0,
      ...(advisorUsage ? { usage: advisorUsage } : {}),
    },
  };
}

/** The last `bytes` of a JSON-lines file, parsed; anything unreadable is skipped. */
function readTail(file: string, bytes: number): Record<string, unknown>[] {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const { size } = fstatSync(fd);
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    // Starting mid-file means starting mid-line.
    if (start > 0) lines.shift();
    return lines.flatMap((line) => {
      if (!line.startsWith("{")) return [];
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  } catch {
    // No history yet, or not ours to read: the dashboard just starts empty.
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The newest route events, in memory. `historyFile` is a JSON-lines log of an earlier run (the
 * launchers append the router's stdout to one): replayed once, so a restart doesn't blank the
 * dashboard.
 */
export function createEventLog({ capacity = DEFAULT_CAPACITY, historyFile }: { capacity?: number; historyFile?: string } = {}): EventLog {
  const events: RouteEvent[] = [];
  let last = 0;
  const record = (entry: Record<string, unknown>) => {
    const event = toEvent(entry, last + 1);
    if (!event) return;
    last = event.seq;
    events.push(event);
    if (events.length > capacity) events.shift();
  };
  if (historyFile) for (const entry of readTail(historyFile, HISTORY_BYTES)) record(entry);
  return {
    record,
    since: (seq) => events.filter((event) => event.seq > seq),
    get last() {
      return last;
    },
  };
}
