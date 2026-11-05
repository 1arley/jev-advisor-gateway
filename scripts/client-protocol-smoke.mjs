#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const client = process.argv[2] ?? "both";
if (!["codex", "opencode", "both"].includes(client)) {
  console.error("usage: node scripts/client-protocol-smoke.mjs [codex|opencode|both]");
  process.exit(2);
}

const liveLayaUrl = process.env.SMOKE_LAYA_URL;
if (liveLayaUrl) {
  const url = new URL(liveLayaUrl);
  assert.ok(
    url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password,
    "SMOKE_LAYA_URL must be an unauthenticated loopback HTTP URL",
  );
}
const answer = "SMOKE_OK";
const requests = [];
const consultations = [];
let activeClient;
function clientCommand(name) {
  const override = process.env[`${name.toUpperCase()}_BIN`];
  if (override) return override;
  try {
    return execFileSync("mise", ["which", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return name;
  }
}

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (req.url === "/v1/systemone") {
    const criteria = body.questions?.tool?.criteria ?? {};
    const selected = Object.entries(criteria).find(([, description]) => /^(exec_command|bash|shell):/.test(description));
    if (!selected && body.questions?.warmup) {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            answers: { warmup: { type: "choice", choice: "warm", confidence: 0.99 } },
            usage: { input_tokens: 1, output_tokens: 0 },
          }),
        );
      return;
    }
    if (!selected) {
      res.writeHead(422, { "content-type": "application/json" }).end(JSON.stringify({ error: "No safe shell tool in native roster" }));
      return;
    }
    consultations.push({ client: activeClient, body, choice: selected[0], tool: selected[1].split(":")[0] });
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        model: "synthetic-system-one",
        usage: { input_tokens: 1, output_tokens: 0 },
        answers: {
          tool: { type: "choice", choice: selected[0], confidence: 0.99, answer_confidence: 0.99, probabilities: { [selected[0]]: 0.99 } },
        },
      }),
    );
    return;
  }
  requests.push({ client: activeClient, path: req.url, body });
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "close" });
  if (req.url === "/v1/responses") {
    const response = {
      id: "resp_smoke",
      object: "response",
      status: "completed",
      model: body.model,
      output: [
        {
          id: "msg_smoke",
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: answer, annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
    const continuation = body.input?.some((item) => item.type === "function_call_output");
    if (!continuation)
      response.output = [
        {
          id: "fc_smoke",
          type: "function_call",
          status: "completed",
          call_id: "call_smoke",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "printf SMOKE_TOOL_OK", max_output_tokens: 100 }),
        },
      ];
    const item = response.output[0];
    if (!continuation) {
      res.end(
        [
          { type: "response.created", response: { ...response, status: "in_progress", output: [], usage: null } },
          { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", arguments: "" } },
          { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments },
          { type: "response.function_call_arguments.done", item_id: item.id, output_index: 0, arguments: item.arguments },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response },
        ]
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join(""),
      );
      return;
    }
    const part = item.content[0];
    res.end(
      [
        { type: "response.created", response: { ...response, status: "in_progress", output: [], usage: null } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
        {
          type: "response.content_part.added",
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        },
        { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: answer },
        { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text: answer },
        { type: "response.content_part.done", item_id: item.id, output_index: 0, content_index: 0, part },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response },
      ]
        .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        .join("") + "data: [DONE]\n\n",
    );
    return;
  }
  if (req.url === "/v1/chat/completions") {
    if (body.tools?.length && !body.messages?.some((message) => message.role === "tool")) {
      const shellTool = body.tools.find((tool) => /^(shell|bash)$/.test(tool.function?.name));
      res.end(
        `data: ${JSON.stringify({ id: "chatcmpl_tool", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_smoke_chat", type: "function", function: { name: shellTool.function.name, arguments: JSON.stringify({ command: "printf SMOKE_TOOL_OK", description: "Synthetic local smoke" }) } }] }, finish_reason: null }] })}\n\n` +
          `data: ${JSON.stringify({ id: "chatcmpl_tool", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n` +
          "data: [DONE]\n\n",
      );
      return;
    }
    res.end(
      `data: ${JSON.stringify({ id: "chatcmpl_smoke", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: answer }, finish_reason: null }] })}\n\n` +
        `data: ${JSON.stringify({ id: "chatcmpl_smoke", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n` +
        "data: [DONE]\n\n",
    );
    return;
  }
  res.writeHead(404).end();
});

function listen(target) {
  return new Promise((resolveListen, reject) => {
    target.once("error", reject);
    target.listen(0, "127.0.0.1", () => {
      target.off("error", reject);
      resolveListen(target.address().port);
    });
  });
}

function run(command, args, env, timeoutMs = 90_000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: temp, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const forceTimer = setTimeout(() => child.kill("SIGKILL"), timeoutMs + 2_000);
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      resolveRun({ code, signal, stdout, stderr });
    });
  });
}

async function waitForGateway(url, child, output) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`gateway exited before readiness:\n${output()}`);
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`gateway did not become ready:\n${output()}`);
}

const temp = await mkdtemp(join(tmpdir(), "jev-client-smoke-"));
let gateway;
try {
  const home = join(temp, "home");
  const codexHome = join(temp, "codex");
  const configDir = join(temp, "config");
  const dataDir = join(temp, "data");
  const cacheDir = join(temp, "cache");
  await Promise.all([home, codexHome, configDir, dataDir, cacheDir].map((path) => mkdir(path, { recursive: true })));
  const upstreamPort = await listen(server);
  const upstream = `http://127.0.0.1:${upstreamPort}/v1`;
  const routerProbe = createServer();
  const routerPort = await listen(routerProbe);
  await new Promise((done) => routerProbe.close(done));
  const origin = `http://127.0.0.1:${routerPort}`;
  const baseEnv = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: temp,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
    XDG_CACHE_HOME: cacheDir,
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    JEV_SKIP_PROJECT_ENV: "1",
    JEV_PROVIDER: "laya",
    JEV_URL: liveLayaUrl ?? `http://127.0.0.1:${upstreamPort}/v1/systemone`,
    JEV_MODEL: "english",
    JEV_LAYA_ROUTING_POLICY: "native",
    JEV_DIRECT_CALLS: "off",
    TYPESAFE_API_KEY: "synthetic-smoke-key",
    JEV_ROUTING: "on",
    JEV_ADVISOR: "off",
    JEV_HEADROOM_MODE: "off",
    UPSTREAM_BASE_URL: upstream,
    PORT: String(routerPort),
  };
  let gatewayOutput = "";
  gateway = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ROOT,
    env: { ...baseEnv, JEV_CLIENT: client === "both" ? "standalone" : client },
    stdio: ["ignore", "pipe", "pipe"],
  });
  gateway.stdout.setEncoding("utf8").on("data", (chunk) => (gatewayOutput += chunk));
  gateway.stderr.setEncoding("utf8").on("data", (chunk) => (gatewayOutput += chunk));
  await waitForGateway(origin, gateway, () => gatewayOutput);

  const runs = [];
  if (client === "codex" || client === "both") {
    activeClient = "codex";
    await writeFile(
      join(codexHome, "config.toml"),
      `model = "gpt-5"\nmodel_provider = "smoke"\napproval_policy = "never"\nsandbox_mode = "read-only"\n\n[model_providers.smoke]\nname = "Local smoke"\nbase_url = "${origin}/v1"\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\nrequires_openai_auth = false\n`,
    );
    const codexAnswer = join(temp, "codex-answer.txt");
    const result = await run(
      clientCommand("codex"),
      [
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "-C",
        temp,
        "-o",
        codexAnswer,
        "Run printf SMOKE_TOOL_OK once in the shell, then reply SMOKE_OK.",
      ],
      { ...baseEnv, CODEX_HOME: codexHome, OPENAI_API_KEY: "synthetic-smoke-key", JEV_CLIENT: "codex" },
    );
    result.stdout += await readFile(codexAnswer, "utf8").catch(() => "");
    runs.push({ client: "codex", ...result });
  }
  if (client === "opencode" || client === "both") {
    activeClient = "opencode";
    const configPath = join(temp, "opencode.json");
    await writeFile(
      configPath,
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        model: "smoke/gpt-smoke",
        provider: {
          smoke: {
            npm: "@ai-sdk/openai-compatible",
            name: "Local smoke",
            options: { baseURL: `${origin}/v1`, apiKey: "synthetic-smoke-key" },
            models: { "gpt-smoke": { name: "Synthetic smoke model" } },
          },
        },
      }),
    );
    const result = await run(
      clientCommand("opencode"),
      ["run", "--standalone", "--format", "json", "Run printf SMOKE_TOOL_OK once in the shell, then reply SMOKE_OK."],
      { ...baseEnv, OPENCODE_CONFIG: configPath, JEV_CLIENT: "opencode" },
    );
    runs.push({ client: "opencode", ...result });
  }

  // Codex currently replays full history; this explicit wire probe covers provider-owned IDs too.
  activeClient = "responses-history-probe";
  const historyProbe = {
    model: "gpt-5",
    stream: true,
    previous_response_id: "resp_provider_history",
    input: [{ type: "function_call_output", call_id: "call_smoke", output: "SMOKE_TOOL_OK" }],
  };
  const probeResponse = await fetch(`${origin}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(historyProbe),
  });
  assert.equal(probeResponse.status, 200);
  await probeResponse.text();
  assert.deepEqual(requests.at(-1).body, historyProbe, "Provider history ID and tool output forwarded unchanged");
  const failures = [];
  for (const result of runs) {
    const expectedPath = result.client === "codex" ? "/v1/responses" : "/v1/chat/completions";
    if (result.code !== 0) failures.push(`${result.client} exited ${result.code ?? result.signal}:\n${result.stderr}\n${result.stdout}`);
    if (!result.stdout.includes(answer))
      failures.push(
        `${result.client} did not print ${answer}; local paths were ${requests.map(({ path }) => path).join(", ") || "none"}. Output:\n${result.stdout}`,
      );
    if (!requests.some((request) => request.path === expectedPath))
      failures.push(`${result.client} did not send ${expectedPath} to the local upstream`);
  }
  if (failures.length) throw new Error(failures.join("\n\n"));
  const evidence = [];
  for (const { client: name } of runs) {
    const observed = requests.filter((request) => request.client === name && request.body.tools?.length);
    const first = observed[0]?.body;
    const last = observed.at(-1)?.body;
    assert.ok(first?.tools.length > 0, `${name}: real client roster`);
    const tool = name === "codex" ? "exec_command" : first.tools.find((tool) => /^(shell|bash)$/.test(tool.function?.name))?.function.name;
    assert.ok(tool, `${name}: safe shell tool is present`);
    if (!liveLayaUrl)
      assert.equal(name === "codex" ? first.tool_choice?.name : first.tool_choice?.function?.name, tool, `${name}: routing transformation`);
    assert.ok(observed.length >= 2, `${name}: continuation reached upstream`);
    assert.ok(
      observed.every(({ body }) => body.stream === true),
      `${name}: streaming requests`,
    );
    if (!liveLayaUrl)
      assert.ok(
        consultations.some((entry) => entry.client === name && entry.tool === tool),
        `${name}: System One consultation`,
      );
    if (name === "codex") {
      const output = last.input.find((item) => item.type === "function_call_output" && item.call_id === "call_smoke");
      assert.ok(output && JSON.stringify(output.output).includes("SMOKE_TOOL_OK"), "Responses tool output and call ID survived");
      assert.ok(
        last.previous_response_id === "resp_smoke" ||
          last.input.some((item) => item.type === "function_call" && item.call_id === "call_smoke" && item.id === "fc_smoke"),
        "Responses history reference or replay survived",
      );
    } else {
      assert.ok(
        last.messages.some(
          (message) =>
            message.role === "tool" &&
            message.tool_call_id === "call_smoke_chat" &&
            JSON.stringify(message.content).includes("SMOKE_TOOL_OK"),
        ),
        "Chat tool output and ID survived",
      );
    }
    const routes = gatewayOutput.split("\n").flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        const path = name === "codex" ? "/v1/responses" : "/v1/chat/completions";
        return entry.event === "route" && entry.path === path && entry.tools > 0
          ? [{ mode: entry.mode, reason: entry.reason, jev: entry.jev }]
          : [];
      } catch {
        return [];
      }
    });
    for (const [index, route] of routes.entries()) {
      if (route.mode !== "forced") continue;
      const body = observed[index]?.body;
      assert.equal(
        name === "codex" ? body?.tool_choice?.name : body?.tool_choice?.function?.name,
        route.jev.choice,
        `${name}: applied choice matches route evidence`,
      );
    }
    evidence.push({
      client: name,
      routes,
      toolCount: first.tools.length,
      consultations: liveLayaUrl
        ? routes.filter((route) => route.jev).length
        : consultations.filter((entry) => entry.client === name).length,
      syntheticUpstreamTool: tool,
      routedTool: routes[0]?.jev?.choice ?? null,
      transformedToolChoice: first.tool_choice ?? null,
      upstreamRequests: observed.length,
      streaming: true,
      toolOutputAndCallIdPreserved: true,
      previousResponseId: last.previous_response_id ?? null,
    });
  }
  console.log(
    JSON.stringify(
      { motor: liveLayaUrl ? "live-laya" : "deterministic-local-system-one", evidence, explicitPreviousResponseIdProbe: "passed" },
      null,
      2,
    ),
  );
  console.log(`Protocol checks passed for ${runs.map(({ client: name }) => name).join(" and ")} via ${origin} → local synthetic upstream.`);
  console.log(`Observed local protocol paths: ${[...new Set(requests.map(({ path }) => path))].join(", ")}.`);
} finally {
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) {
    const closed = new Promise((done) => gateway.once("close", done));
    gateway.kill("SIGTERM");
    await closed;
  }
  await new Promise((done) => server.close(done));
  await rm(temp, { recursive: true, force: true });
}
