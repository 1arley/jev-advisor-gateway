export const MAX_LEN = 2048;

export const TOOLS = [
  { name: "exec", description: "Run JavaScript code to orchestrate/compose tool calls" },
  { name: "clock.sleep", description: "Pause execution for a specified duration.", namespace: "clock" },
];

export const FIXTURES = [
  { name: "exec", label: "exec", wait: false, text: "Run a harmless command in the project and inspect its output." },
  { name: "clock-sleep", label: "clock.sleep", wait: true, text: "Wait for 10 milliseconds before continuing." },
  { name: "no-tool", label: "no_tool_needed", wait: true, text: "Thanks, that answers my question. There is no remaining action to take." },
];

export function buildPayload(fixture, tools, model, maxLen = MAX_LEN) {
  const criteria = Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      tool.namespace === "clock" ? `[Tools for reading and waiting on time.] ${tool.description}` : tool.description,
    ]),
  );
  const conversation = [{ role: "user", text: fixture.text }];
  return {
    state: { assistant_instructions: fixture.instructions ?? "You are Codex.", conversation },
    questions: {
      tool: {
        type: "choice",
        instructions:
          "Given the conversation, what should the assistant do next? Pick the single tool whose call best advances the user's latest request.",
        criteria: {
          ...criteria,
          no_tool_needed:
            "No tool call is needed right now: the assistant should reply to the user in plain text (answer directly, ask a clarifying question, or report results that tools already returned).",
        },
      },
      needs_tool: {
        type: "noul",
        instructions: "Does the assistant need to call one of its tools now, rather than reply to the user in plain text?",
      },
    },
    model,
    max_len: maxLen,
  };
}

export function confidenceOf(answer) {
  if (typeof answer.confidence === "number" && typeof answer.x_jev_confidence === "number") return answer.x_jev_confidence;
  if (typeof answer.confidence === "number") return answer.confidence;
  const values =
    answer.probabilities && typeof answer.probabilities === "object"
      ? Object.values(answer.probabilities).filter((value) => typeof value === "number")
      : [];
  return values.length ? Math.max(...values) : undefined;
}
