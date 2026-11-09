import type { Config } from "../config.js";
import { assessCanonicalChoice } from "./shared.js";
import type { DecisionProvider } from "./types.js";

/** Jiwo speaks canonical choice answers but rejects direct argument generation and large rosters. */
export function jiwoDecisionProvider(config: Config): DecisionProvider {
  return {
    maxTools: 99,
    maxChoiceOptions: 64,
    directCalls: false,
    forceNone: true,
    prepareQuestions() {},
    assess(result) {
      return assessCanonicalChoice(result, config.jiwoMinConfidence);
    },
  };
}
