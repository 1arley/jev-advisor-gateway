#!/usr/bin/env node
// laya-checkpoints: measures the laya-serve checkpoints against synthetic routing fixtures,
// in the gateway's own state and question shape (see src/questions.ts), so the JEV_MODEL
// default is switched with evidence rather than a guess. Point it at a running laya-serve:
//
//   pip install "laya[serve]"; LAYA_HOST=127.0.0.1 laya-serve &
//   node scripts/laya-checkpoints.mjs [--url http://127.0.0.1:8000/v1/systemone] [--models multilingual,typed-decisions]
//
// Prints per-checkpoint accuracy (choice matches the fixture's label) and latency. Fixtures
// are deliberately unambiguous: they probe whether a checkpoint follows the roster at all,
// not how it ties to real sessions — real-session measurement stays the dashboard's work.
import { readFile } from "node:fs/promises";

const OPTIONS = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = OPTIONS.indexOf(name);
  return at !== -1 && OPTIONS[at + 1] ? OPTIONS[at + 1] : fallback;
};
const URL_ = flag("--url", process.env.LAYA_URL ?? "http://127.0.0.1:8000/v1/systemone");
const MODELS = flag("--models", "multilingual,typed-decisions").split(",").map((model) => model.trim());

const NO_TOOL = "no_tool_needed";
const NO_TOOL_CRITERION =
  "No tool call is needed right now: the assistant should reply to the user in plain text " +
  "(answer directly, ask a clarifying question, or report results that tools already returned).";
const TOOL_INSTRUCTIONS =
  "Given the conversation, what should the assistant do next? Pick the single tool whose call " +
  "best advances the user's latest request.";
const NEEDS_TOOL_INSTRUCTIONS =
  "Does the assistant need to call one of its tools now, rather than reply to the user in plain text?";

/** One routing scenario: why it is labeled, the tools on offer, and the conversation. */
const FIXTURES = [
  {
    name: "run-tests",
    label: "run_command",
    system: "You are a coding agent working in a Git repository on the user's machine.",
    tools: tools(
      tool("read_file", "Read a file from disk and return its contents."),
      tool("run_command", "Run a shell command in the working directory and return its output."),
      tool("list_files", "List the files and directories under a path."),
    ),
    turns: [
      { role: "user", text: "the CI on my branch is red, can you check?" },
      { role: "assistant", tool_calls: [{ tool: "run_command", arguments: '"git status"' }] },
      { role: "tool_result", tool: "run_command", content: "On branch fix/signup-validation\nYour branch is ahead of 'origin/main' by 2 commits." },
      { role: "user", text: "Run the signup test suite now so we see what fails." },
    ],
  },
  {
    name: "edit-file",
    label: "edit_file",
    system: "You are a coding agent working in a Git repository on the user's machine.",
    tools: tools(
      tool("read_file", "Read a file from disk and return its contents."),
      tool("edit_file", "Replace lines in an existing file with new content."),
      tool("create_file", "Create a new file with the given content."),
      tool("run_command", "Run a shell command in the working directory and return its output."),
    ),
    turns: [
      { role: "user", text: "types/config.ts exports a typo'd constant API_BASEURL, please rename it to API_BASE_URL" },
      { role: "assistant", tool_calls: [{ tool: "read_file", arguments: '"types/config.ts"' }] },
      { role: "tool_result", tool: "read_file", content: "export const API_BASEURL = \"https://api.example.com\";\nexport const API_TIMEOUT_MS = 4000;" },
    ],
  },
  {
    name: "search-web",
    label: "web_search",
    system: "You are a helpful assistant with web access.",
    tools: tools(
      tool("web_search", "Search the web for up-to-date information the assistant does not already have."),
      tool("read_file", "Read a file from disk and return its contents."),
      tool("run_command", "Run a shell command in the working directory and return its output."),
    ),
    turns: [{ role: "user", text: "Who won the 2026 Formula 1 constructors' championship?" }],
  },
  {
    name: "no-tool-chat",
    label: NO_TOOL,
    system: "You are a coding agent working in a Git repository on the user's machine.",
    tools: tools(
      tool("read_file", "Read a file from disk and return its contents."),
      tool("run_command", "Run a shell command in the working directory and return its output."),
    ),
    turns: [
      { role: "user", text: "why does the gateway fail open when Jev is down?" },
      { role: "assistant", text: "Because the gateway must never be the reason a request fails: a Jev outage routes the request untouched and the LLM decides." },
      { role: "user", text: "Got it, thanks. That answers my question." },
    ],
  },
  {
    name: "list-then-run",
    label: "list_files",
    system: "You are a coding agent working in a fresh checkout the user knows little about.",
    tools: tools(
      tool("list_files", "List the files and directories under a path."),
      tool("read_file", "Read a file from disk and return its contents."),
      tool("edit_file", "Replace lines in an existing file with new content."),
    ),
    turns: [{ role: "user", text: "What is at the top level of this project?" }],
  },
  {
    name: "clarify",
    label: NO_TOOL,
    system: "You are a coding agent working in a Git repository on the user's machine.",
    tools: tools(
      tool("run_command", "Run a shell command in the working directory and return its output."),
      tool("read_file", "Read a file from disk and return its contents."),
      tool("edit_file", "Replace lines in an existing file with new content."),
    ),
    turns: [{ role: "user", text: "My build broke. What should I do?" }],
  },
];

function tool(name, description) {
  return { name, description };
}
/** Tool rosters are one flat list of `tool()` entries; spread at the call site for readability. */
function tools(...entries) {
  return entries;
}

/** The gateway's own state shape (src/state.ts with everything present). */
function buildState(fixture) {
  const state = {};
  if (fixture.system) state.assistant_instructions = fixture.system;
  state.conversation = fixture.turns;
  return state;
}

/** The gateway's own non-shortlist question shape, without argument questions (JEV_DIRECT_CALLS off). */
function buildQuestions(fixture) {
  const criteria = Object.fromEntries(fixture.tools.map((entry) => [entry.name, entry.description]));
  return {
    tool: { type: "choice", instructions: TOOL_INSTRUCTIONS, criteria: { ...criteria, [NO_TOOL]: NO_TOOL_CRITERION } },
    needs_tool: { type: "noul", instructions: NEEDS_TOOL_INSTRUCTIONS },
  };
}

async function ask(url, model, fixture) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: buildState(fixture), questions: buildQuestions(fixture), model }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw Object.assign(new Error(`${response.status} for ${fixture.name}`), { status: response.status });
  const result = /** @type {any} */ (await response.json());
  const answer = result?.answers?.tool;
  if (answer?.type !== "choice" || typeof answer.choice !== "string") {
    throw new Error(`no choice answer for ${fixture.name}: ${JSON.stringify(answer)}`);
  }
  // Confidence and the needs-tool cross-check are what the gateway acts on (JEV_MIN_CONFIDENCE
  // and the 0.3/0.7 disagreement gate), so the report carries them with the pick.
  const confidence = typeof answer.confidence === "number" ? answer.confidence.toFixed(2) : "none";
  const needs = result?.answers?.needs_tool?.noul;
  const saidNeedsTool = typeof needs === "number" ? `needs ${needs.toFixed(2)}` : "no needs_tool";
  return { choice: answer.choice, confidence, saidNeedsTool };
}

async function main() {
  const stats = new Map(MODELS.map((model) => [model, { correct: 0, ms: 0 }]));
  for (const fixture of FIXTURES) {
    const row = FIXTURES.indexOf(fixture) + 1;
    const outcomes = [];
    for (const model of MODELS) {
      const started = performance.now();
      const { choice, confidence, saidNeedsTool } = await ask(URL_, model, fixture);
      const ms = Math.round(performance.now() - started);
      const stat = stats.get(model);
      stat.correct += Number(choice === fixture.label);
      stat.ms += ms;
      const verdict = choice === fixture.label ? "hit" : "MISS";
      outcomes.push(`${model}: ${verdict} ${ms} ms (${choice}, conf ${confidence}, ${saidNeedsTool})`);
    }
    console.log(`[${row}/${FIXTURES.length}] ${fixture.name} → ${fixture.label} | ${outcomes.join(" | ")}`);
  }
  console.log("");
  for (const [model, stat] of stats) {
    const accuracy = stat.correct / FIXTURES.length;
    const meanMs = Math.round(stat.ms / FIXTURES.length);
    console.log(`${model}: ${stat.correct}/${FIXTURES.length} (${(accuracy * 100).toFixed(0)}%), mean ${meanMs} ms`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
