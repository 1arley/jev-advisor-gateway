import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import type { RouterTool } from "../types.js";

export interface DecisionTrace {
  policy?: string;
  confidenceMetric?: string;
  requestedCheckpoint?: string;
  effectiveCheckpoint?: string;
  optionCount?: number;
  truncated?: boolean;
  truncatedQuestions?: number;
}

export type DecisionAssessment =
  | { reason: string }
  | {
      choice: string;
      confidence: number;
      needsTool?: number;
      probabilities: Record<string, number>;
      trace: DecisionTrace;
      rejection?: string;
    };

export interface DecisionProvider {
  maxTools: number;
  maxChoiceOptions?: number;
  directCalls: boolean;
  forceNone: boolean;
  prepareQuestions(questions: Questions, tools: RouterTool[], allowNone: boolean): void;
  assess(result: SystemOneResult<Questions>, tools: RouterTool[], allowNone: boolean): DecisionAssessment;
}
