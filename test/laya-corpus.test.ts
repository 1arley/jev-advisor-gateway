import { describe, expect, it } from "vitest";
// @ts-expect-error The offline corpus is a plain JavaScript data module.
import { CORPUS } from "../scripts/laya-evaluate-corpus.mjs";
// @ts-expect-error The validator also runs directly with Node.
import { validateCorpus } from "../scripts/laya-validate-corpus.mjs";

describe("Laya corpus", () => {
  it("has 96 synthetic scenarios across isolated families and complete splits", () => {
    expect(validateCorpus(CORPUS)).toEqual({ scenarios: 96, families: 12, splits: { dev: 32, calibration: 32, test: 32 } });
  });

  it.each([
    [
      "duplicate id",
      (rows: any[]) => {
        rows[1].id = rows[0].id;
      },
    ],
    [
      "duplicate text",
      (rows: any[]) => {
        rows[1].text = rows[0].text;
      },
    ],
    [
      "duplicate intent",
      (rows: any[]) => {
        rows[1].intent = rows[0].intent;
      },
    ],
    [
      "family crosses splits",
      (rows: any[]) => {
        rows[32].family = rows[0].family;
      },
    ],
    [
      "expected tool absent",
      (rows: any[]) => {
        rows[0].expected = "missing_tool";
      },
    ],
    [
      "invalid roster",
      (rows: any[]) => {
        rows[0].tools[0].description = "";
      },
    ],
    [
      "duplicate tool",
      (rows: any[]) => {
        rows[1].tools.push(rows[1].tools[0]);
      },
    ],
    [
      "missing context",
      (rows: any[]) => {
        rows[0].context = "";
      },
    ],
    [
      "missing rationale",
      (rows: any[]) => {
        rows[0].rationale = "";
      },
    ],
    [
      "turns must end",
      (rows: any[]) => {
        rows[0].turns = [];
      },
    ],
    [
      "missing option band",
      (rows: any[]) => {
        for (const row of rows) row.tools = [row.tools[0]];
      },
    ],
  ])("rejects %s", (message, mutate) => {
    const rows = structuredClone(CORPUS);
    mutate(rows);
    expect(() => validateCorpus(rows)).toThrow(message);
  });

  it("rejects a corpus below the minimum size", () => {
    expect(() => validateCorpus(CORPUS.slice(1))).toThrow("at least 96");
  });
});

it("does not encode the expected tool in its position or option band", () => {
  const byTool = new Map<string, Set<number>>();
  const positions = new Set<number>();
  for (const scenario of CORPUS) {
    if (scenario.expected === "no_tool_needed") continue;
    const bands = byTool.get(scenario.expected) ?? new Set<number>();
    bands.add(scenario.tools.length);
    byTool.set(scenario.expected, bands);
    positions.add(scenario.tools.findIndex((tool: { name: string }) => tool.name === scenario.expected));
  }
  expect([...byTool.values()].every((bands) => bands.size === 4)).toBe(true);
  expect(positions.size).toBeGreaterThan(1);
});
