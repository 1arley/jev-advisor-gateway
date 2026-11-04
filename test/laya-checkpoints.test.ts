import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildPayload, confidenceOf, FIXTURES, MAX_LEN, TOOLS } from "../scripts/laya-codex-fixtures.mjs";
import { createApp } from "../src/app.js";
import { buildQuestions } from "../src/questions.js";
import { fakeJev, fakeUpstream, testConfig } from "./helpers.js";

describe("Laya Codex roster fixtures", () => {
  it("matches the gateway question builder and wait eligibility", () => {
    for (const fixture of FIXTURES) {
      const offered = TOOLS.map((tool) => ({
        ...tool,
        kind: tool.name === "exec" ? ("custom" as const) : ("function" as const),
      }));
      const payload = buildPayload(fixture, offered, "multilingual");
      const actual = buildQuestions(
        offered.map((tool) => ({
          ...tool,
          ...(tool.namespace === "clock" ? { description: `[Tools for reading and waiting on time.] ${tool.description}` } : {}),
        })),
        { allowNone: true, withArgs: false, maxChoiceOptions: 100 },
      ).questions;
      expect(payload.questions).toEqual(actual);
      expect(payload.max_len).toBe(MAX_LEN);
      expect(payload.questions.tool.criteria).toHaveProperty("clock.sleep");
    }
    expect(TOOLS.map((tool) => tool.name)).toEqual(["exec", "clock.sleep"]);
  });

  it("sends the same synthetic Codex roster and state through the Responses adapter", async () => {
    for (const fixture of FIXTURES) {
      const jev = fakeJev({ tool: { choice: fixture.label, confidence: 0.9 }, needs_tool: { noul: 0.9 } });
      const upstream = fakeUpstream();
      const app = createApp({
        config: testConfig({ client: "codex", jevProvider: "laya" }),
        askJev: jev.askJev,
        fetch: upstream.fetchImpl,
      });
      const tools = TOOLS.map((tool) => ({
        type: tool.name === "exec" ? "custom" : "function",
        name: tool.name.split(".").at(-1),
        description: tool.description,
        ...(tool.name === "clock.sleep" ? { namespace: "clock" } : {}),
      })).concat([{ type: "function", name: "wait", description: "Waits on a yielded `exec` cell." }]);
      const input = [
        {
          type: "additional_tools",
          tools: [
            { type: "namespace", name: "functions", tools: tools.filter((tool) => tool.name !== "sleep") },
            {
              type: "namespace",
              name: "clock",
              description: "Tools for reading and waiting on time.",
              tools: [{ type: "function", name: "sleep", description: "Pause execution for a specified duration." }],
            },
          ],
        },
        { type: "message", role: "developer", content: "You are Codex." },
        { type: "message", role: "user", content: fixture.text },
      ];
      await app.request("/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-6-luna", input, tool_choice: "auto" }),
      });
      const asked = jev.requests[0]!;
      const fixtureTools = TOOLS.filter((tool) => fixture.wait || tool.name !== "wait");
      const expected = buildPayload(fixture, fixtureTools, "multilingual");
      expect(asked.state).toEqual(expected.state);
      const expectedQuestions = buildQuestions(
        fixtureTools.map((tool) => ({
          ...tool,
          kind: tool.name === "exec" ? ("custom" as const) : ("function" as const),
          ...(tool.namespace === "clock" ? { description: `[Tools for reading and waiting on time.] ${tool.description}` } : {}),
        })),
        { allowNone: true, withArgs: false, maxChoiceOptions: 100 },
      ).questions;
      expect(expected.questions).toEqual(expectedQuestions);
      expect(asked.questions).toEqual(expected.questions);
    }
  });

  it("normalizes confidence the same way as the gateway", () => {
    expect(confidenceOf({ confidence: 0.5, x_jev_confidence: 0.9 })).toBe(0.9);
    expect(confidenceOf({ probabilities: { a: 0.7, b: 0.3 } })).toBe(0.7);
    expect(confidenceOf({})).toBeUndefined();
  });

  it("runs the Codex diagnostic with paired rotations and synthetic fetch replies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "laya-checkpoints-"));
    const capture = join(directory, "requests.json");
    const outputFile = join(directory, "output.txt");
    const errorFile = join(directory, "error.txt");
    const preload = join(directory, "fetch.mjs");
    await writeFile(
      preload,
      `
      import { appendFile } from "node:fs/promises";
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(init.body);
        await appendFile(${JSON.stringify(capture)}, JSON.stringify(request) + "\\n");
        const keys = Object.keys(request.questions.tool.criteria);
        const choice = keys[0];
        const probabilities = Object.fromEntries(keys.map((key) => [key, key === choice ? 0.8 : 0.2 / (keys.length - 1)]));
        return Response.json({ answers: {
          tool: { type: "choice", choice, confidence: 0.5, x_jev_confidence: 0.9, probabilities },
          needs_tool: { type: "noul", noul: 0.9 },
        }, usage: { input_tokens: 10, output_tokens: 1 } });
      };
    `,
    );
    try {
      const output = await new Promise<string>((resolve, reject) => {
        void (async () => {
          const stdout = await open(outputFile, "w");
          let stderr: Awaited<ReturnType<typeof open>> | undefined;
          let closing: Promise<void> | undefined;
          const closeFiles = async () => {
            closing ??= Promise.all([stdout.close(), stderr?.close()]).then(() => undefined);
            await closing;
          };
          try {
            stderr = await open(errorFile, "w");
            const child = spawn(process.execPath, ["--import", preload, "scripts/laya-checkpoints.mjs", "--codex-roster"], {
              cwd: process.cwd(),
              env: process.env,
              stdio: ["ignore", stdout.fd, stderr.fd],
            });
            child.on("error", async (error) => {
              await closeFiles();
              reject(error);
            });
            child.on("close", async (code) => {
              await closeFiles();
              if (code !== 0) return reject(new Error(`${code}: ${await readFile(errorFile, "utf8")}`));
              resolve(await readFile(outputFile, "utf8"));
            });
          } catch (error) {
            await closeFiles();
            reject(error);
          }
        })().catch(reject);
      });
      const requests = (await readFile(capture, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(requests).toHaveLength(12);
      expect(requests.map((request) => request.model)).toEqual(Array(6).fill(["multilingual", "typed-decisions"]).flat());
      expect(requests.every((request) => request.max_len === MAX_LEN)).toBe(true);
      expect(requests.every((request) => !Object.hasOwn(request.questions.tool.criteria, "wait"))).toBe(true);
      const first = requests[0]!;
      const rotated = requests[2]!;
      expect(Object.keys(first.questions.tool.criteria)).not.toEqual(Object.keys(rotated.questions.tool.criteria));
      expect(first.state).toEqual(rotated.state);
      expect(Object.fromEntries(Object.entries(first.questions.tool.criteria).sort())).toEqual(
        Object.fromEntries(Object.entries(rotated.questions.tool.criteria).sort()),
      );
      expect(output).toContain("paired order rotations");
      expect(output).toContain("conf 0.90");
      expect(output).not.toContain("mean");
      expect(output.match(/^\[\d+\//gm)).toHaveLength(6);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
