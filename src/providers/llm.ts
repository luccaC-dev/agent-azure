import { ToolSpec } from '../tools/tools';

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string, exactly as the model produced it. Validation happens in the tool runner. */
  arguments: string;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage: Usage;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<LlmResponse>;
}
