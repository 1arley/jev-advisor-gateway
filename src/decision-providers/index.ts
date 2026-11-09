import type { Config } from "../config.js";
import { canonicalDecisionProvider } from "./canonical.js";
import { jiwoDecisionProvider } from "./jiwo.js";
import { layaDecisionProvider } from "./laya.js";
import type { DecisionProvider } from "./types.js";

export type { DecisionAssessment, DecisionProvider, DecisionTrace } from "./types.js";

/** Dispatch provider-specific decision semantics through one stable seam. */
export function decisionProvider(config: Config): DecisionProvider {
  if (config.jevProvider === "laya") return layaDecisionProvider(config);
  if (config.jevProvider === "jiwo") return jiwoDecisionProvider(config);
  return canonicalDecisionProvider(config);
}
