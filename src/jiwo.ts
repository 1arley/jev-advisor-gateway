import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { NEEDS_TOOL_KEY, NO_TOOL, TOOL_KEY } from "./questions.js";
import { textOf, truncate } from "./state.js";
import type { Json, RouterInput, Turn } from "./types.js";

const MAX_QUESTIONS = 64;
const MAX_MESSAGE_CHARS = 1_500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Build Jiwo's bounded, text-only state without forwarding tool results or media. */
export function buildJiwoState(input: Pick<RouterInput, "system" | "turns">, maxChars: number): Json {
  const conversation: { role: "user" | "assistant"; content: string }[] = [];
  for (const turn of input.turns.toReversed()) {
    if (turn.role !== "user" && turn.role !== "assistant") continue;
    const text = textOf(turn.content);
    if (text) conversation.unshift({ role: turn.role, content: text.slice(0, MAX_MESSAGE_CHARS) });
  }
  let system = input.system.slice(0, MAX_MESSAGE_CHARS);
  const state = () => ({ ...(system ? { assistant_instructions: system } : {}), conversation });
  if (JSON.stringify({ conversation: [] }).length > maxChars) throw new Error("jiwo_state_limit");
  while (conversation.length && JSON.stringify(state()).length > maxChars) conversation.shift();
  while (system && JSON.stringify(state()).length > maxChars)
    system = system.slice(0, Math.max(0, system.length - (JSON.stringify(state()).length - maxChars)));
  while (conversation.length && JSON.stringify(state()).length > maxChars) {
    const latest = conversation.at(-1)!;
    const excess = JSON.stringify(state()).length - maxChars;
    if (latest.content.length <= excess) conversation.pop();
    else latest.content = latest.content.slice(0, latest.content.length - excess);
  }
  if (JSON.stringify(state()).length > maxChars) throw new Error("jiwo_state_limit");
  return state() as Json;
}

/** Remove tool-result and media turns from the already bounded common state. */
export function sanitizeJiwoState(state: unknown, maxChars: number): Json {
  if (!isRecord(state)) throw new Error("jiwo_invalid_state");
  const system = typeof state.assistant_instructions === "string" ? state.assistant_instructions : "";
  const turns = Array.isArray(state.conversation)
    ? state.conversation.filter(isRecord).map((turn) => ({
        role: typeof turn.role === "string" ? turn.role : "",
        content: turn.content ?? turn.text,
      }))
    : [];
  return buildJiwoState({ system, turns: turns as Turn[] }, maxChars);
}

/** Translate the common request into Jiwo's native choice-only subset. */
export function toJiwoRequest(request: SystemOneRequest<Questions>): SystemOneRequest<Questions> {
  const questions = Object.fromEntries(
    Object.entries(request.questions).flatMap(([key, question]) => (question.type === "choice" ? [[key, question]] : [])),
  ) as Questions;
  if (Object.keys(questions).length === 0 || Object.keys(questions).length > MAX_QUESTIONS) throw new Error("jiwo_question_limit");
  return { ...request, questions };
}

/** Reject malformed Jiwo output and fill non-choice questions conservatively. */
export function fromJiwoResult(
  value: unknown,
  request: SystemOneRequest<Questions>,
  choiceRequest: SystemOneRequest<Questions>,
): SystemOneResult<Questions> {
  if (!isRecord(value) || !isRecord(value.answers) || !isRecord(value.usage)) throw new Error("jiwo_invalid_response");
  const answers = value.answers;
  const choiceNames = Object.keys(choiceRequest.questions);
  if (Object.keys(answers).length !== choiceNames.length || !choiceNames.every((name) => Object.hasOwn(answers, name)))
    throw new Error("jiwo_partial_response");
  for (const name of choiceNames) {
    const question = choiceRequest.questions[name];
    const answer = answers[name];
    if (question?.type !== "choice" || !isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string")
      throw new Error("jiwo_invalid_choice");
    if (!Object.hasOwn(question.criteria, answer.choice) || !validProbability(answer.confidence)) throw new Error("jiwo_invalid_choice");
    if (
      !isRecord(answer.probabilities) ||
      Object.entries(answer.probabilities).some(
        ([key, probability]) => !Object.hasOwn(question.criteria, key) || !validProbability(probability),
      ) ||
      Math.abs(Object.values(answer.probabilities).reduce<number>((sum, probability) => sum + Number(probability), 0) - 1) >= 0.001
    )
      throw new Error("jiwo_invalid_probabilities");
  }
  const usage = value.usage;
  if (![usage.input_tokens, usage.output_tokens].every((token) => Number.isSafeInteger(token) && Number(token) >= 0))
    throw new Error("jiwo_invalid_usage");
  const normalized: Record<string, unknown> = { ...answers };
  const picked = isRecord(answers[TOOL_KEY]) && typeof answers[TOOL_KEY].choice === "string" ? answers[TOOL_KEY].choice : undefined;
  for (const [name, question] of Object.entries(request.questions)) {
    if (Object.hasOwn(normalized, name)) continue;
    if (question.type !== "noul") throw new Error("jiwo_missing_answer");
    normalized[name] = { type: "noul", noul: name === NEEDS_TOOL_KEY && picked !== undefined ? (picked === NO_TOOL ? 0 : 1) : 0.5 };
  }
  return {
    model: typeof value.model === "string" ? value.model : "jiwo",
    answers: normalized,
    usage,
  } as unknown as SystemOneResult<Questions>;
}
