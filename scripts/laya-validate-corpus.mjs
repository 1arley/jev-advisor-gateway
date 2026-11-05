#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { CORPUS } from "./laya-evaluate-corpus.mjs";

export const optionBand = (toolCount) => (toolCount === 1 ? "2" : toolCount <= 4 ? "3-5" : toolCount <= 9 ? "6-10" : "11+");

/** Validate synthetic corpus structure before any endpoint can receive a scenario. */
export function validateCorpus(corpus) {
  const errors = [];
  const ids = new Set();
  const texts = new Set();
  const intents = new Set();
  const familySplits = new Map();
  if (!Array.isArray(corpus) || corpus.length < 96) throw new Error("Corpus requires at least 96 scenarios");
  for (const row of corpus) {
    const fail = (message) => errors.push(`${row.id ?? "unknown"}: ${message}`);
    for (const key of ["id", "family", "intent", "text", "context", "rationale"]) {
      if (typeof row[key] !== "string" || !row[key].trim()) fail(`missing ${key}`);
    }
    for (const [key, seen] of [
      ["id", ids],
      ["text", texts],
      ["intent", intents],
    ]) {
      const value = String(row[key])
        .normalize("NFKC")
        .toLocaleLowerCase("und")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      if (seen.has(value)) fail(`duplicate ${key}`);
      seen.add(value);
    }
    if (!["dev", "calibration", "test"].includes(row.split)) fail("invalid split");
    if (!["en", "pt"].includes(row.language)) fail("invalid language");
    if (familySplits.has(row.family) && familySplits.get(row.family) !== row.split) fail("family crosses splits");
    familySplits.set(row.family, row.split);
    if (!Array.isArray(row.turns) || !row.turns.length || row.turns.at(-1)?.role !== "user" || row.turns.at(-1)?.text !== row.text)
      fail("turns must end in the user request");
    const roster = Array.isArray(row.tools) ? row.tools : [];
    if (row.optionCount !== roster.length + 1) fail("invalid option count");
    if (!roster.length || roster.some((tool) => !tool.name?.trim() || !tool.description?.trim() || tool.kind !== "function"))
      fail("invalid roster");
    if (new Set(roster.map((tool) => tool.name)).size !== roster.length) fail("duplicate tool");
    if (row.expected !== "no_tool_needed" && !roster.some((tool) => tool.name === row.expected)) fail("expected tool absent");
    if (row.category !== (row.expected === "no_tool_needed" ? "direct_reply" : "tool_request")) fail("invalid category");
  }
  for (const split of ["dev", "calibration", "test"]) {
    const rows = corpus.filter((row) => row.split === split);
    if (rows.length < 32) errors.push(`${split}: requires at least 32 scenarios`);
    for (const language of ["en", "pt"]) if (!rows.some((row) => row.language === language)) errors.push(`${split}: missing ${language}`);
    for (const band of ["2", "3-5", "6-10", "11+"]) {
      if (!rows.some((row) => optionBand(row.tools?.length ?? 0) === band)) errors.push(`${split}: missing option band ${band}`);
    }
    if (!rows.some((row) => row.expected === "no_tool_needed")) errors.push(`${split}: missing direct replies`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    scenarios: corpus.length,
    families: familySplits.size,
    splits: Object.fromEntries(["dev", "calibration", "test"].map((split) => [split, corpus.filter((row) => row.split === split).length])),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(validateCorpus(CORPUS)));
