import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import type { Config } from "../config.js";
import { layaThreshold } from "../laya-calibration.js";
import { NEEDS_TOOL_KEY, NO_TOOL, TOOL_KEY } from "../questions.js";
import type { RouterTool } from "../types.js";
import { hasAbstention, isRecord } from "./shared.js";
import type { DecisionAssessment, DecisionProvider, DecisionTrace } from "./types.js";

function prepareNativeQuestions(questions: Questions, tools: RouterTool[], allowNone: boolean, policy: Config["layaRoutingPolicy"]): void {
  const toolQuestion = questions[TOOL_KEY];
  if (toolQuestion?.type !== "choice") return;
  const descriptions = toolQuestion.criteria;
  questions[TOOL_KEY] = {
    type: "choice",
    instructions: "Which tool should be called to handle the user request?",
    criteria: {
      ...Object.fromEntries(tools.map((tool, index) => [`tool_${index}`, `${tool.name}: ${descriptions[tool.name] ?? tool.name}`])),
      ...(allowNone ? { direct_answer: "Answer the user request directly without calling any tools." } : {}),
    },
  };
  if (policy === "noul_refined") {
    questions[NEEDS_TOOL_KEY] = {
      type: "noul",
      instructions: "What should the assistant do next?",
      criteria: {
        true: "An available tool is needed for the next action.",
        false: "The assistant can respond or proceed without a tool call now.",
      },
      labels: { true: "A", false: "B" },
    } as Questions[string];
  } else if (policy === "binary_choice") {
    questions[NEEDS_TOOL_KEY] = {
      type: "choice",
      instructions: "What should the assistant do next?",
      criteria: {
        A: "An available tool is needed for the next action.",
        B: "The assistant can respond or proceed without a tool call now.",
      },
    };
  } else delete questions[NEEDS_TOOL_KEY];
}

function nativeSelection(choice: string, tools: RouterTool[]): string | undefined {
  if (choice === "direct_answer") return NO_TOOL;
  return tools[Number(choice.slice(5))]?.name;
}

export function layaDecisionProvider(config: Config): DecisionProvider {
  const native = config.layaRoutingPolicy !== "legacy";
  return {
    // Laya accepts at most 100 choices, including the optional no-tool label.
    maxTools: 99,
    maxChoiceOptions: 64,
    directCalls: !native,
    forceNone: !native,
    prepareQuestions(questions, tools, allowNone) {
      if (native) prepareNativeQuestions(questions, tools, allowNone, config.layaRoutingPolicy);
    },
    assess(result: SystemOneResult<Questions>, tools: RouterTool[], allowNone: boolean): DecisionAssessment {
      const picked = result.answers[TOOL_KEY];
      const needs = result.answers[NEEDS_TOOL_KEY];
      if (native && hasAbstention(picked)) return { reason: "low_confidence" };
      if (native && hasAbstention(needs)) return { reason: "low_confidence" };
      if (picked?.type !== "choice" || (!native && needs?.type !== "noul")) return { reason: "jev_unexpected_answer" };

      const selected = native ? nativeSelection(picked.choice, tools) : picked.choice;
      if (!selected) return { reason: "jev_unknown_tool" };
      const routing = (result as unknown as Record<string, unknown>).routing;
      const reportedCheckpoint = isRecord(routing) && typeof routing.model === "string" ? routing.model : config.jevModel;
      const trace: DecisionTrace = {
        policy: config.layaRoutingPolicy,
        confidenceMetric: native
          ? "answer_confidence"
          : isRecord(picked) && typeof picked.x_jev_confidence === "number"
            ? "x_jev_confidence"
            : "confidence_or_probability",
        requestedCheckpoint: config.jevModel,
        effectiveCheckpoint:
          isRecord(routing) && typeof routing.model === "string" && ["english", "multilingual", "typed-decisions"].includes(routing.model)
            ? routing.model
            : undefined,
        optionCount: tools.length + Number(allowNone),
        truncated: isRecord(result.usage) && typeof result.usage.truncated === "boolean" ? result.usage.truncated : undefined,
        truncatedQuestions:
          isRecord(result.usage) && Array.isArray(result.usage.truncated_questions) ? result.usage.truncated_questions.length : undefined,
      };
      const assessment = {
        choice: selected,
        confidence: picked.confidence,
        needsTool: needs?.type === "noul" ? needs.noul : undefined,
        probabilities: picked.probabilities,
        trace,
      };
      const threshold = native
        ? layaThreshold(
            config.layaCalibration,
            reportedCheckpoint,
            config.layaRoutingPolicy,
            tools.length + Number(allowNone),
            config.layaMinConfidence,
          )
        : config.minConfidence;
      if (picked.confidence < threshold) return { ...assessment, rejection: "low_confidence" };

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
      if (!native && needs?.type === "noul" && (wantsTool ? needs.noul < 0.3 : needs.noul > 0.7))
        return { ...assessment, rejection: "jev_answers_disagree" };
      return assessment;
    },
  };
}
