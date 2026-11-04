export interface ToolFixture {
  name: string;
  description: string;
  namespace?: string;
}

export interface RoutingFixture {
  name: string;
  label: string;
  text: string;
  wait: boolean;
  execOutput?: string;
  instructions?: string;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface NeedsToolQuestion {
  type: "noul";
  instructions: string;
}

export const MAX_LEN: number;
export const TOOLS: ToolFixture[];
export const FIXTURES: RoutingFixture[];
export function buildPayload(
  fixture: RoutingFixture,
  tools: ToolFixture[],
  model: string,
  maxLen?: number,
): {
  state: Record<string, unknown>;
  questions: { tool: ChoiceQuestion; needs_tool: NeedsToolQuestion };
  model: string;
  max_len: number;
};
export function confidenceOf(answer: Record<string, unknown>): number | undefined;
