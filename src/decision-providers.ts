import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import type { Config } from "./config.js";
import { layaThreshold } from "./laya-calibration.js";
import { MAX_TOOLS, NEEDS_TOOL_KEY, NO_TOOL, TOOL_KEY } from "./questions.js";
import type { RouterTool } from "./types.js";

export type DecisionAssessment =
  | { reason: string }
  | {
      choice: string;
      confidence: number;
      needsTool?: number;
      probabilities: Record<string, number>;
      trace: {
        policy?: string;
        confidenceMetric?: string;
        requestedCheckpoint?: string;
        effectiveCheckpoint?: string;
        optionCount?: number;
        truncated?: boolean;
        truncatedQuestions?: number;
      };
      rejection?: string;
    };

interface DecisionProvider {
  maxTools: number;
  maxChoiceOptions?: number;
  directCalls: boolean;
  forceNone: boolean;
  prepareQuestions(questions: Questions, tools: RouterTool[], allowNone: boolean): void;
  assess(result: SystemOneResult<Questions>, tools: RouterTool[], allowNone: boolean): DecisionAssessment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Provider policies end at a normalized assessment; the router owns the resulting action. */
export function decisionProvider(config: Config): DecisionProvider {
  const native = config.jevProvider === "laya" && config.layaRoutingPolicy !== "legacy";
  const jiwo = config.jevProvider === "jiwo";
  const bounded = config.jevProvider === "laya" || jiwo;
  return {
    // Local providers accept at most 100 choices, including the optional no-tool label.
    maxTools: bounded ? 99 : MAX_TOOLS,
    maxChoiceOptions: bounded ? 64 : undefined,
    directCalls: !native && !jiwo,
    forceNone: !native,
    prepareQuestions(questions, tools, allowNone) {
      if (!native) return;
      const descriptions = (questions[TOOL_KEY] as Extract<Questions[string], { type: "choice" }>).criteria;
      questions[TOOL_KEY] = {
        type: "choice",
        instructions: "Which tool should be called to handle the user request?",
        criteria: {
          ...Object.fromEntries(tools.map((tool, index) => [`tool_${index}`, `${tool.name}: ${descriptions[tool.name] ?? tool.name}`])),
          ...(allowNone ? { direct_answer: "Answer the user request directly without calling any tools." } : {}),
        },
      };
      if (config.layaRoutingPolicy === "noul_refined") {
        questions[NEEDS_TOOL_KEY] = {
          type: "noul",
          instructions: "What should the assistant do next?",
          criteria: {
            true: "An available tool is needed for the next action.",
            false: "The assistant can respond or proceed without a tool call now.",
          },
          labels: { true: "A", false: "B" },
        } as Questions[string];
      } else if (config.layaRoutingPolicy === "binary_choice") {
        questions[NEEDS_TOOL_KEY] = {
          type: "choice",
          instructions: "What should the assistant do next?",
          criteria: {
            A: "An available tool is needed for the next action.",
            B: "The assistant can respond or proceed without a tool call now.",
          },
        };
      } else delete questions[NEEDS_TOOL_KEY];
    },
    assess(result, tools, allowNone) {
      const rawPicked = result.answers[TOOL_KEY];
      if (
        native &&
        isRecord(rawPicked) &&
        (rawPicked.low_confidence === true ||
          rawPicked.abstained === true ||
          rawPicked.abstention === "abstained" ||
          rawPicked.abstention === "unevaluated")
      ) {
        return { reason: "low_confidence" };
      }
      const picked = rawPicked;
      const needs = result.answers[NEEDS_TOOL_KEY];
      if (
        native &&
        isRecord(needs) &&
        (needs.low_confidence === true ||
          needs.abstained === true ||
          needs.abstention === "abstained" ||
          needs.abstention === "unevaluated")
      )
        return { reason: "low_confidence" };
      if (picked?.type !== "choice" || (!native && needs?.type !== "noul")) {
        return { reason: "jev_unexpected_answer" };
      }
      const selected = native ? (picked.choice === "direct_answer" ? NO_TOOL : tools[Number(picked.choice.slice(5))]?.name) : picked.choice;
      if (!selected) return { reason: "jev_unknown_tool" };
      const assessment = {
        choice: selected,
        confidence: picked.confidence,
        needsTool: needs?.type === "noul" ? needs.noul : undefined,
        probabilities: picked.probabilities,
        trace: {
          ...(config.jevProvider === "laya"
            ? {
                policy: config.layaRoutingPolicy,
                confidenceMetric: native
                  ? "answer_confidence"
                  : isRecord(picked) && typeof picked.x_jev_confidence === "number"
                    ? "x_jev_confidence"
                    : "confidence_or_probability",
                requestedCheckpoint: config.jevModel,
                effectiveCheckpoint: (() => {
                  const raw = result as unknown as Record<string, unknown>;
                  const routing = isRecord(raw.routing) ? raw.routing : undefined;
                  return routing &&
                    typeof routing.model === "string" &&
                    ["english", "multilingual", "typed-decisions"].includes(routing.model)
                    ? routing.model
                    : undefined;
                })(),
                optionCount: tools.length + Number(allowNone),
                truncated: isRecord(result.usage) && typeof result.usage.truncated === "boolean" ? result.usage.truncated : undefined,
                truncatedQuestions:
                  isRecord(result.usage) && Array.isArray(result.usage.truncated_questions)
                    ? result.usage.truncated_questions.length
                    : undefined,
              }
            : {}),
        },
      };
      const routing = (result as unknown as Record<string, unknown>).routing;
      const reportedCheckpoint = isRecord(routing) && typeof routing.model === "string" ? routing.model : config.jevModel;
      const threshold = layaThreshold(
        config.layaCalibration,
        reportedCheckpoint,
        config.layaRoutingPolicy,
        tools.length + Number(allowNone),
        config.layaMinConfidence,
      );
      if (picked.confidence < (native ? threshold : jiwo ? config.jiwoMinConfidence : config.minConfidence))
        return { ...assessment, rejection: "low_confidence" };
      // The verification question must be confident and agree with the selected action.
      const wantsTool = selected !== NO_TOOL;
      if (native && config.layaRoutingPolicy === "noul_refined") {
        if (needs?.type !== "noul" || Math.max(needs.noul, 1 - needs.noul) < config.layaMinConfidence)
          return { ...assessment, rejection: "low_confidence" };
        if (needs.noul >= 0.5 !== wantsTool) return { ...assessment, rejection: "jev_answers_disagree" };
      }
      if (native && config.layaRoutingPolicy === "binary_choice") {
        if (needs?.type !== "choice" || needs.confidence < config.layaMinConfidence) return { ...assessment, rejection: "low_confidence" };
        if ((needs.choice === "A") !== wantsTool) return { ...assessment, rejection: "jev_answers_disagree" };
      }
      if (!native && needs?.type === "noul" && (wantsTool ? needs.noul < 0.3 : needs.noul > 0.7)) {
        return { ...assessment, rejection: "jev_answers_disagree" };
      }
      return assessment;
    },
  };
}
