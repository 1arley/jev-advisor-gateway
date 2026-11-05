#!/usr/bin/env node
// Run with pnpm exec tsx; the endpoint must be local and contain only synthetic data.
import { decide } from "../src/decide.ts";
import { loadConfig } from "../src/config.ts";
import { createAskJev } from "../src/jev.ts";
import { readFile, writeFile } from "node:fs/promises";
import { CORPUS } from "./laya-evaluate-corpus.mjs";

import { validateCorpus } from "./laya-validate-corpus.mjs";

validateCorpus(CORPUS);

// Splits are fixed by scenario, so rotations cannot leak between calibration and evaluation.
const args = process.argv.slice(2);
const flag = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const url = flag("--url", "http://127.0.0.1:8000/v1/systemone");
const endpoint = new URL(url);
if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error("Only a loopback Laya endpoint is allowed");
const models = flag("--models", "english,multilingual,typed-decisions").split(",");
const policies = flag("--policies", "legacy,native,noul_refined,binary_choice").split(",");
const split = flag("--split", "calibration");
if (!["dev", "calibration", "test"].includes(split)) throw new Error("--split must be dev, calibration or test");
const format = flag("--format", "json");
if (!["json", "csv"].includes(format)) throw new Error("--format must be json or csv");
const output = flag("--output", undefined);
const limit = flag("--limit", undefined);
if (limit !== undefined && (!Number.isSafeInteger(Number(limit)) || Number(limit) < 1))
  throw new Error("--limit must be a positive integer");
const fitProfile = flag("--fit-profile", undefined);
const applyProfile = flag("--apply-profile", undefined);
const source = flag("--source", undefined);
const errorTarget = Number(flag("--error-target", "0.1"));
if (!Number.isFinite(errorTarget) || errorTarget < 0 || errorTarget > 1) throw new Error("--error-target must be between 0 and 1");
if (
  fitProfile &&
  (split !== "calibration" ||
    limit !== undefined ||
    models.length !== 1 ||
    policies.length !== 1 ||
    policies[0] === "legacy" ||
    !source?.trim())
) {
  throw new Error("--fit-profile requires the full calibration split, one non-legacy policy, one model, and --source");
}
if (
  applyProfile &&
  (split !== "test" || fitProfile || limit !== undefined || models.length !== 1 || policies.length !== 1 || policies[0] === "legacy")
) {
  throw new Error("--apply-profile requires the full test split, one non-legacy policy, one model, and no --fit-profile");
}
const calibration = applyProfile ? await readFile(applyProfile, "utf8") : undefined;
let calibrationProfile;
if (calibration) {
  calibrationProfile = JSON.parse(calibration);
  if (!calibrationProfile || typeof calibrationProfile !== "object" || Array.isArray(calibrationProfile))
    throw new Error("Calibration profile must be a JSON object");
  if (calibrationProfile.checkpoint !== models[0] || calibrationProfile.policy !== policies[0])
    throw new Error("Calibration profile checkpoint and policy must match --models and --policies");
  if (!Object.keys(calibrationProfile.buckets ?? {}).length) throw new Error("Calibration profile has no fitted option buckets");
}
const scenarios = CORPUS.filter((scenario) => scenario.split === split).slice(0, limit === undefined ? undefined : Number(limit));
const rows = [];
const summaries = [];
for (const model of models)
  for (const policy of policies)
    for (const scenario of scenarios) {
      const { language, text, expected, tools: scenarioRoster } = scenario;
      const toolCount = scenarioRoster.length;
      for (const order of ["original", "reverse"]) {
        const config = loadConfig({
          JEV_PROVIDER: "laya",
          JEV_URL: url,
          JEV_MODEL: model,
          JEV_LAYA_ROUTING_POLICY: policy,
          JEV_LAYA_CALIBRATION: calibration,
          JEV_LAYA_TIMEOUT_MS: "120000",
          JEV_DIRECT_CALLS: "false",
        });
        const start = performance.now();
        const result = await decide(
          {
            system: `You are a coding assistant. ${scenario.context}`,
            turns: scenario.turns,
            tools: order === "original" ? scenarioRoster : [...scenarioRoster].reverse(),
            toolChoice: "auto",
          },
          config,
          createAskJev(config),
        );
        const selected = result.jev?.choice;
        rows.push({
          model,
          policy,
          language,
          split,
          id: scenario.id,
          family: scenario.family,
          context: scenario.context,
          category: scenario.category,
          scenario: text,
          expected,
          rationale: scenario.rationale,
          toolCount,
          order,
          selected,
          mode: result.mode,
          reason: result.mode === "passthrough" ? result.reason : undefined,
          confidence: result.jev?.confidence,
          ms: Math.round(performance.now() - start),
        });
      }
    }
const band = (count) => (count <= 2 ? "2" : count <= 5 ? "3-5" : count <= 10 ? "6-10" : "11+");
const ratio = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
const originalRows = rows.filter((row) => row.order === "original");
const metricGroups = [{ scope: "overall", rows: originalRows }];
for (const dimension of ["model", "policy", "language"]) {
  for (const value of new Set(originalRows.map((row) => row[dimension]))) {
    metricGroups.push({
      scope: dimension === "model" ? "checkpoint" : dimension,
      [dimension === "model" ? "checkpoint" : dimension]: value,
      rows: originalRows.filter((row) => row[dimension] === value),
    });
  }
}
for (const bucket of ["2", "3-5", "6-10", "11+"]) {
  const sample = originalRows.filter((row) => band(row.toolCount + 1) === bucket);
  if (sample.length) metricGroups.push({ scope: "tool_count_band", bucket, rows: sample });
}
for (const model of models)
  for (const policy of policies)
    for (const language of ["en", "pt"])
      for (const bucket of ["2", "3-5", "6-10", "11+"]) {
        const sample = originalRows.filter(
          (row) => row.model === model && row.policy === policy && row.language === language && band(row.toolCount + 1) === bucket,
        );
        if (sample.length)
          metricGroups.push({ scope: "checkpoint_policy_language_band", checkpoint: model, policy, language, bucket, rows: sample });
      }
for (const { rows: sample, ...dimensions } of metricGroups) {
  const applied = sample.filter((row) => row.mode !== "passthrough");
  const correctApplied = applied.filter((row) => row.selected === row.expected).length;
  const scored = sample.filter((row) => Number.isFinite(row.confidence) && row.selected !== undefined);
  const scoreSufficient = scored.length >= 20;
  const brierError = scoreSufficient
    ? scored.reduce((sum, row) => sum + (row.confidence - Number(row.selected === row.expected)) ** 2, 0)
    : undefined;
  const eceBins = scoreSufficient
    ? Array.from({ length: 10 }, (_, index) => {
        const bin = scored.filter((row) => Math.min(9, Math.floor(row.confidence * 10)) === index);
        return bin.length
          ? {
              bin: index,
              count: bin.length,
              meanConfidence: bin.reduce((sum, row) => sum + row.confidence, 0) / bin.length,
              accuracy: ratio(bin.filter((row) => row.selected === row.expected).length, bin.length),
            }
          : undefined;
      }).filter(Boolean)
    : undefined;
  const eceNumerator = eceBins?.reduce((sum, bin) => sum + bin.count * Math.abs(bin.meanConfidence - bin.accuracy.value), 0);
  const passthrough = sample.filter((row) => row.mode === "passthrough");
  const confidenceAbstentions = passthrough.filter((row) => row.reason === "low_confidence" || row.reason === "jev_answers_disagree");
  const suggestions = passthrough.filter((row) => row.reason === "no_tool_needed");
  const passthroughFailures = passthrough.filter(
    (row) => !["no_tool_needed", "low_confidence", "jev_answers_disagree"].includes(row.reason),
  );
  const passthroughReasons = Object.fromEntries(
    [...new Set(passthrough.map((row) => row.reason))].map((reason) => [
      reason,
      ratio(passthrough.filter((row) => row.reason === reason).length, sample.length),
    ]),
  );
  const paired = sample.filter(
    (row) =>
      row.selected !== undefined &&
      rows.some(
        (other) =>
          other.model === row.model &&
          other.policy === row.policy &&
          other.id === row.id &&
          other.order === "reverse" &&
          other.selected !== undefined,
      ),
  );
  const stable = paired.filter(
    (row) =>
      rows.find((other) => other.model === row.model && other.policy === row.policy && other.id === row.id && other.order === "reverse")
        ?.selected === row.selected,
  ).length;
  const latency = rows
    .filter((row) => sample.some((item) => item.model === row.model && item.policy === row.policy && item.id === row.id))
    .map((row) => row.ms)
    .sort((a, b) => a - b);
  summaries.push({
    ...dimensions,
    scenarios: sample.length,
    choiceAccuracy: ratio(sample.filter((row) => row.selected === row.expected).length, sample.length),
    appliedPrecision: ratio(correctApplied, applied.length),
    coverage: ratio(applied.length, sample.length),
    abstention: ratio(confidenceAbstentions.length, sample.length),
    passthroughFailures: ratio(passthroughFailures.length, sample.length),
    passthroughReasons,
    falseSelections: ratio(applied.length - correctApplied, applied.length),
    suggestedDirectAnswers: ratio(suggestions.length, sample.length),
    suggestedDirectAnswerPrecision: ratio(suggestions.filter((row) => row.expected === "no_tool_needed").length, suggestions.length),
    falseDirectAnswers: ratio(sample.filter((row) => row.mode === "none" && row.expected !== "no_tool_needed").length, sample.length),
    falseDirectAnswerChoices: ratio(
      sample.filter((row) => row.selected === "no_tool_needed" && row.expected !== "no_tool_needed").length,
      sample.length,
    ),
    correctRejected: ratio(
      sample.filter((row) => row.mode === "passthrough" && row.reason !== "no_tool_needed" && row.selected === row.expected).length,
      sample.length,
    ),
    orderStability: ratio(stable, paired.length),
    calibration: {
      samples: scored.length,
      required: 20,
      brier: scoreSufficient ? { numerator: brierError, denominator: scored.length, value: brierError / scored.length } : null,
      ece: scoreSufficient
        ? { numerator: eceNumerator, denominator: scored.length, value: eceNumerator / scored.length, bins: eceBins }
        : null,
    },
    latency: {
      samples: latency.length,
      p50Ms: latency[Math.floor((latency.length - 1) * 0.5)],
      p95Ms: latency[Math.ceil((latency.length - 1) * 0.95)],
    },
  });
}
const disagreements = [];
for (const model of models)
  for (let i = 0; i < policies.length; i++)
    for (let j = i + 1; j < policies.length; j++) {
      const left = rows.filter(
        (row) => row.model === model && row.policy === policies[i] && row.order === "original" && row.selected !== undefined,
      );
      const pairs = left.flatMap((row) => {
        const right = rows.find(
          (other) =>
            other.model === model &&
            other.policy === policies[j] &&
            other.id === row.id &&
            other.order === "original" &&
            other.selected !== undefined,
        );
        return right ? [row.selected !== right.selected] : [];
      });
      disagreements.push({
        checkpoint: model,
        policies: [policies[i], policies[j]],
        disagreements: ratio(pairs.filter(Boolean).length, pairs.length),
      });
    }
let profile;
let reportFit;
if (fitProfile) {
  const policy = policies[0];
  const model = models[0];
  const bucketFor = (count) => (count === 1 ? "2" : count <= 4 ? "3-5" : count <= 9 ? "6-10" : "11+");
  const fitted = {};
  const insufficientBuckets = {};
  for (const key of ["2", "3-5", "6-10", "11+"]) {
    const samples = rows.filter((row) => row.order === "original" && Number.isFinite(row.confidence) && bucketFor(row.toolCount) === key);
    if (samples.length < 20) {
      insufficientBuckets[key] = { samples: samples.length, required: 20 };
      continue;
    }
    const thresholds = [...new Set(samples.map((row) => row.confidence))].sort((a, b) => a - b);
    const threshold = thresholds.find((value) => {
      const accepted = samples.filter((row) => row.confidence >= value);
      const errors = accepted.filter((row) => row.selected !== row.expected).length;
      return (errors + 1) / (accepted.length + 1) <= errorTarget;
    });
    if (threshold !== undefined) fitted[key] = { threshold, samples: samples.length };
  }
  profile = { version: 1, source, checkpoint: model, policy, buckets: fitted };
  await writeFile(fitProfile, `${JSON.stringify(profile, null, 2)}\n`);
  reportFit = { includedBuckets: Object.keys(fitted), insufficientBuckets };
}
const report = {
  split,
  corpusScenarios: CORPUS.filter((scenario) => scenario.split === split).length,
  evaluatedScenarios: scenarios.length,
  limited: limit !== undefined,
  ...(calibrationProfile
    ? {
        profileApplied: { source: calibrationProfile.source, checkpoint: calibrationProfile.checkpoint, policy: calibrationProfile.policy },
      }
    : {}),
  summaries,
  disagreements,
  ...(reportFit ? { profileFit: reportFit, profile } : {}),
  rows,
};
const csv = (items) => {
  const fields = [...new Set(items.flatMap((item) => Object.keys(item)))];
  return [
    fields.join(","),
    ...items.map((item) =>
      fields
        .map((field) => {
          const value = item[field];
          const serialized = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
          return `"${serialized.replaceAll('"', '""')}"`;
        })
        .join(","),
    ),
  ].join("\n");
};
const rendered =
  format === "json"
    ? JSON.stringify(report)
    : csv([
        ...summaries.map((summary) => ({ recordType: "metric", ...summary })),
        ...disagreements.map((item) => ({ recordType: "disagreement", ...item })),
        ...rows.map((row) => ({ recordType: "scenario", ...row })),
      ]);
if (output) await writeFile(output, `${rendered}\n`);
else console.log(rendered);
