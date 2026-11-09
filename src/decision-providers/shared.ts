import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { NEEDS_TOOL_KEY, NO_TOOL, TOOL_KEY } from "../questions.js";
import type { DecisionAssessment } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Laya reports abstention beside the answer, including on otherwise high-confidence choices. */
export function hasAbstention(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.low_confidence === true || value.abstained === true || value.abstention === "abstained" || value.abstention === "unevaluated")
  );
}

/** Shared interpretation for providers whose wire answer already uses the canonical choice labels. */
export function assessCanonicalChoice(result: SystemOneResult<Questions>, threshold: number): DecisionAssessment {
  const picked = result.answers[TOOL_KEY];
  const needs = result.answers[NEEDS_TOOL_KEY];
  if (picked?.type !== "choice" || needs?.type !== "noul") return { reason: "jev_unexpected_answer" };

  const assessment = {
    choice: picked.choice,
    confidence: picked.confidence,
    needsTool: needs.noul,
    probabilities: picked.probabilities,
    trace: {},
  };
  if (picked.confidence < threshold) return { ...assessment, rejection: "low_confidence" };
  const wantsTool = picked.choice !== NO_TOOL;
  if (wantsTool ? needs.noul < 0.3 : needs.noul > 0.7) return { ...assessment, rejection: "jev_answers_disagree" };
  return assessment;
}
