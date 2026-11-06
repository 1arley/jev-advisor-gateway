#!/usr/bin/env node
/** Compare Jiwo and Laya on the same synthetic gateway decision corpus. */
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const jiwoUrl = flag("--jiwo-url", process.env.JIWO_URL ?? "http://127.0.0.1:8765/v1/systemone");
const layaUrl = flag("--laya-url", process.env.LAYA_URL ?? "http://127.0.0.1:8000/v1/systemone");
const output = flag("--output", undefined);
const timeoutMs = Number(flag("--timeout-ms", "120000"));
const layaModels = flag("--laya-models", "multilingual")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
if (layaModels.length === 0) throw new Error("--laya-models must contain at least one model");
const providers = [
  { name: "jiwo", url: jiwoUrl, model: "jiwo-0.8b", headers: {} },
  ...layaModels.map((model) => ({ name: `laya-${model}`, url: layaUrl, model, headers: {} })),
];

const tool = (name, description) => ({ type: "function", function: { name, description, parameters: { type: "object", properties: {} } } });
const suites = {
  weather: [
    tool("get_weather", "Get current weather for a city."),
    tool("search_web", "Search the web for information."),
    tool("set_reminder", "Set a reminder for the user."),
  ],
  files: [
    tool("read_file", "Read a file from the workspace."),
    tool("write_file", "Write or edit a file in the workspace."),
    tool("list_files", "List files and directories in the workspace."),
  ],
  calendar: [
    tool("create_event", "Create a calendar event."),
    tool("list_events", "List existing calendar events."),
    tool("cancel_event", "Cancel an existing calendar event."),
  ],
  code: [
    tool("run_tests", "Run the project's tests."),
    tool("search_code", "Search source code for a pattern."),
    tool("apply_patch", "Apply a patch to source code."),
  ],
};
const tasks = {
  weather: {
    get_weather: ["Call get_weather now for Lisbon.", "What is the current weather in Lisbon? Use the weather tool."],
    search_web: ["Search the web for the latest Node.js release.", "Use web search to find the current Node.js release."],
    set_reminder: ["Set a reminder for me to check the forecast at 8 AM.", "Create a reminder to check the weather tomorrow."],
    none: ["Explain how rain forms. Do not call any tool.", "What causes wind? Answer in text without using tools."],
  },
  files: {
    read_file: ["Read README.md and summarize it.", "Use the file reader to inspect package.json."],
    write_file: ["Edit README.md to fix the typo.", "Write the requested change to src/index.ts."],
    list_files: ["List the files in the src directory.", "Show the workspace directory tree."],
    none: ["Explain what a hash function is. Do not read or write files.", "Describe semantic versioning without using tools."],
  },
  calendar: {
    create_event: ["Schedule a team meeting tomorrow at 10:00.", "Create a calendar event for lunch on Friday."],
    list_events: ["Show my calendar for tomorrow.", "List my meetings this week."],
    cancel_event: ["Cancel the dentist appointment on Friday.", "Remove the 10 AM team meeting from my calendar."],
    none: ["Explain the difference between UTC and local time. Do not use calendar tools.", "What is a time zone? Answer directly."],
  },
  code: {
    run_tests: ["Run the test suite now.", "Execute the project's tests and report failures."],
    search_code: ["Find every use of createAskJev in the source.", "Search the codebase for TODO comments."],
    apply_patch: ["Apply the requested fix to the source file.", "Patch the bug in the implementation now."],
    none: ["Explain what a unit test is. Do not run commands.", "What is static typing? Answer without using tools."],
  },
};
const cases = Object.entries(suites).flatMap(([suite, tools]) =>
  Object.entries(tasks[suite]).flatMap(([task, prompts]) =>
    prompts.map((prompt) => ({ suite, task, expected: task === "none" ? "no_tool_needed" : task, prompt, tools })),
  ),
);

async function request(provider, item) {
  const started = performance.now();
  const response = await fetch(provider.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...provider.headers },
    body: JSON.stringify({
      model: provider.model,
      state: { conversation: [{ role: "user", content: item.prompt }] },
      questions: {
        tool: {
          type: "choice",
          instructions: "Choose the next tool or no_tool_needed.",
          criteria: Object.fromEntries(
            item.tools
              .map((entry) => [entry.function.name, entry.function.description])
              .concat([["no_tool_needed", "Answer directly without a tool."]]),
          ),
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const body = await response.json();
  const answer = body?.answers?.tool;
  const actual = typeof answer?.choice === "string" ? answer.choice : undefined;
  return {
    provider: provider.name,
    suite: item.suite,
    task: item.task,
    expected: item.expected,
    actual,
    confidence: answer?.confidence ?? null,
    correct: actual === item.expected,
    ms: Math.round(performance.now() - started),
  };
}

const rows = [];
for (const item of cases) {
  for (const provider of providers) {
    try {
      rows.push(await request(provider, item));
    } catch (error) {
      rows.push({
        provider: provider.name,
        suite: item.suite,
        task: item.task,
        expected: item.expected,
        actual: undefined,
        correct: false,
        error: error instanceof Error ? error.name : String(error),
      });
    }
  }
}
const percentile = (values, p) => (values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : undefined);
const summary = Object.fromEntries(
  providers.map(({ name }) => {
    const sample = rows.filter((row) => row.provider === name);
    const latencies = sample.flatMap((row) => (Number.isFinite(row.ms) ? [row.ms] : [])).sort((a, b) => a - b);
    const correct = sample.filter((row) => row.correct).length;
    const errors = sample.filter((row) => row.error).length;
    return [
      name,
      {
        samples: sample.length,
        correct,
        accuracy: sample.length ? correct / sample.length : null,
        errors,
        meanMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
        p50Ms: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95),
      },
    ];
  }),
);
const report = {
  synthetic: true,
  corpus: "weather/files/calendar/code-v1",
  generatedAt: new Date().toISOString(),
  providers: summary,
  rows,
};
console.log(JSON.stringify(report, null, 2));
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
