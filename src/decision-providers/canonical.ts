import type { Config } from "../config.js";
import { MAX_TOOLS } from "../questions.js";
import { assessCanonicalChoice } from "./shared.js";
import type { DecisionProvider } from "./types.js";

/** Providers that expose the canonical System One answer contract without translation. */
export function canonicalDecisionProvider(config: Config): DecisionProvider {
  return {
    maxTools: MAX_TOOLS,
    directCalls: true,
    forceNone: true,
    prepareQuestions() {},
    assess(result) {
      return assessCanonicalChoice(result, config.minConfidence);
    },
  };
}
