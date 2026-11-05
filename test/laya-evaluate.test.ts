import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Laya evaluation", () => {
  it("evaluates the supported policies in both orders without using an external service", async () => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const request = JSON.parse(body);
        const asksForWrongDirectAnswer = JSON.stringify(request).includes("Open the synthetic payment reconciliation CSV.");
        const answers = Object.fromEntries(
          Object.entries(request.questions).map(([key, question]: [string, any]) => {
            if (question.type === "noul") return [key, { type: "noul", noul: 0.9 }];
            const choice =
              asksForWrongDirectAnswer && Object.hasOwn(question.criteria, "direct_answer")
                ? "direct_answer"
                : Object.keys(question.criteria)[0]!;
            return [key, { type: "choice", choice, confidence: 0.9, answer_confidence: 0.9, probabilities: { [choice]: 0.9 } }];
          }),
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ answers, usage: { input_tokens: 1, output_tokens: 0 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No server address");
      const child = spawn(process.execPath, [
        "--import",
        "tsx",
        "scripts/laya-evaluate.mjs",
        "--url",
        `http://127.0.0.1:${address.port}/v1/systemone`,
        "--models",
        "english",
        "--policies",
        "legacy,native,noul_refined,binary_choice",
        "--limit",
        "20",
      ]);
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
      expect(code).toBe(0);
      const report = JSON.parse(output.trim().split("\n").at(-1)!);
      expect(report).toMatchObject({ split: "calibration", corpusScenarios: 32, evaluatedScenarios: 20, limited: true });
      expect(report.rows).toHaveLength(160);
      const overall = report.summaries.find((metric: { scope: string }) => metric.scope === "overall");
      expect(overall.scenarios).toBe(80);
      const correct = report.rows.filter(
        (row: { order: string; selected: string; expected: string }) => row.order === "original" && row.selected === row.expected,
      ).length;
      expect(overall.choiceAccuracy).toEqual({ numerator: correct, denominator: 80, value: correct / 80 });
      expect(overall.orderStability.denominator).toBe(80);
      expect(overall.calibration.samples).toBe(80);
      expect(overall.calibration.brier.value).toBeCloseTo((correct * 0.01 + (80 - correct) * 0.81) / 80);
      expect(overall.calibration.ece.value).toBeCloseTo(Math.abs(0.9 - correct / 80));
      const nativeMetrics = report.summaries.find(
        (metric: { scope: string; policy?: string; language?: string; bucket?: string }) =>
          metric.scope === "checkpoint_policy_language_band" &&
          metric.policy === "native" &&
          metric.language === "en" &&
          metric.bucket === "2",
      );
      expect(nativeMetrics.suggestedDirectAnswers.numerator).toBe(1);
      expect(nativeMetrics.falseDirectAnswers.numerator).toBe(0);
      expect(nativeMetrics.falseDirectAnswerChoices.numerator).toBe(1);
      expect(report.disagreements).toHaveLength(6);
      expect(new Set(report.rows.map((row: { order: string }) => row.order))).toEqual(new Set(["original", "reverse"]));
      expect(new Set(report.rows.map((row: { policy: string }) => row.policy))).toEqual(
        new Set(["legacy", "native", "noul_refined", "binary_choice"]),
      );
      const csv = spawn(process.execPath, [
        "--import",
        "tsx",
        "scripts/laya-evaluate.mjs",
        "--url",
        `http://127.0.0.1:${address.port}/v1/systemone`,
        "--models",
        "english",
        "--policies",
        "native",
        "--limit",
        "1",
        "--format",
        "csv",
      ]);
      let csvOutput = "";
      csv.stdout.on("data", (chunk) => {
        csvOutput += chunk;
      });
      expect(await new Promise<number | null>((resolve) => csv.on("close", resolve))).toBe(0);
      expect(csvOutput).toContain('"scenario"');
      expect(csvOutput).toContain('"metric"');
      expect(csvOutput).toContain('""numerator""');

      const directory = await mkdtemp(join(tmpdir(), "laya-evaluation-"));
      try {
        const profilePath = join(directory, "profile.json");
        await writeFile(
          profilePath,
          JSON.stringify({
            version: 1,
            source: "test fixture",
            checkpoint: "english",
            policy: "native",
            buckets: Object.fromEntries(["2", "3-5", "6-10", "11+"].map((bucket) => [bucket, { threshold: 1, samples: 20 }])),
          }),
        );
        const heldOut = spawn(process.execPath, [
          "--import",
          "tsx",
          "scripts/laya-evaluate.mjs",
          "--url",
          `http://127.0.0.1:${address.port}/v1/systemone`,
          "--split",
          "test",
          "--models",
          "english",
          "--policies",
          "native",
          "--apply-profile",
          profilePath,
        ]);
        let heldOutOutput = "";
        heldOut.stdout.on("data", (chunk) => {
          heldOutOutput += chunk;
        });
        expect(await new Promise<number | null>((resolve) => heldOut.on("close", resolve))).toBe(0);
        const heldOutReport = JSON.parse(heldOutOutput.trim());
        expect(heldOutReport.profileApplied).toEqual({ source: "test fixture", checkpoint: "english", policy: "native" });
        expect(heldOutReport.rows.every((row: { reason?: string }) => row.reason === "low_confidence")).toBe(true);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    } finally {
      server.close();
    }
  });
});
