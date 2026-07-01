/**
 * CodeGraph-powered chat agent: an LLM loop that answers ONLY from
 * CodeGraph tool results — no hardcoded project knowledge.
 */
import type CodeGraph from '../index';
import { ToolHandler, type ToolDefinition } from '../mcp/tools';
import { chatCompletion, type ChatMessage, type OpenAITool } from './llm';

/** All query tools exposed to the chat agent (not gated to explore-only). */
export const CHAT_TOOL_NAMES = [
  'explore',
  'search',
  'node',
  'callers',
  'callees',
  'impact',
  'files',
  'status',
] as const;

const MAX_TOOL_ROUNDS = 10;

function buildSystemPrompt(projectPath: string): string {
  return `You are an intelligent embedded-code assistant backed exclusively by CodeGraph — a semantic index of the user's codebase.

STRICT RULES:
1. Answer ONLY from CodeGraph tool results. Never invent code, registers, peripherals, or behavior not shown in tool output.
2. Call tools BEFORE making factual claims. Prefer \`codegraph_explore\` for architecture, flow, and "how does X work" questions; use \`codegraph_search\`, \`codegraph_node\`, \`codegraph_callers\`, \`codegraph_callees\`, and \`codegraph_impact\` for targeted follow-ups.
3. Cite every location as \`path/to/file.c:line\` (or a line range) exactly as shown in tool output.
4. For execution-flow questions, trace the call chain step by step with arrows (A → B → C) and file:line citations.
5. For "where should I change" questions, name the exact file, function/symbol, and why — based on callers, callees, or impact from the graph.
6. If tool output is incomplete, say "Coverage: partial" and name the symbols or files to explore next — do NOT guess the missing code.
7. Treat conversation history as context for follow-ups, but re-query CodeGraph when new symbols, files, or flows are involved.

The indexed project root is: ${projectPath}
Do not pass projectPath in tool calls unless querying a different indexed project.

Be precise and dense. Use Markdown for structure when helpful.`;
}

function toOpenAITools(defs: ToolDefinition[]): OpenAITool[] {
  return defs.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        ...t.inputSchema,
        // projectPath is bound to the open project — omit from schema noise
        properties: Object.fromEntries(
          Object.entries(t.inputSchema.properties).filter(([k]) => k !== 'projectPath'),
        ),
        required: (t.inputSchema.required ?? []).filter((k) => k !== 'projectPath'),
      },
    },
  }));
}

export interface AgentOptions {
  projectPath: string;
  cg: CodeGraph;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, preview: string) => void;
}

export interface AgentTurnResult {
  answer: string;
  toolCalls: number;
}

/**
 * Run one user turn: LLM ↔ CodeGraph tool loop until a final answer.
 * `history` should NOT include the latest user message (this function appends it).
 */
export async function runAgentTurn(
  userMessage: string,
  history: ChatMessage[],
  opts: AgentOptions,
): Promise<AgentTurnResult> {
  // Enable the full tool surface for chat (MCP defaults to explore-only).
  process.env.CODEGRAPH_MCP_TOOLS = CHAT_TOOL_NAMES.join(',');

  const handler = new ToolHandler(opts.cg);
  const visibleTools = handler.getTools().filter((t) =>
    CHAT_TOOL_NAMES.some((short) => t.name === `codegraph_${short}`),
  );
  const openaiTools = toOpenAITools(visibleTools);

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(opts.projectPath) },
    ...history,
    { role: 'user', content: userMessage },
  ];

  let toolCalls = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { message } = await chatCompletion({ messages, tools: openaiTools });

    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      for (const call of message.tool_calls) {
        toolCalls++;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }

        opts.onToolCall?.(call.function.name, args);

        const result = await handler.execute(call.function.name, args);
        const text = result.content.map((c) => c.text ?? '').join('\n') || '(empty result)';
        const preview = text.length > 120 ? text.slice(0, 120) + '…' : text;
        opts.onToolResult?.(call.function.name, preview);

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: text,
        });
      }
      continue;
    }

    const answer = (message.content ?? '').trim();
    if (!answer) {
      throw new Error('LLM returned an empty answer without calling tools.');
    }
    return { answer, toolCalls };
  }

  throw new Error(`Agent exceeded ${MAX_TOOL_ROUNDS} tool rounds. Try a more specific question.`);
}

/** Strip projectPath from exported tool list for documentation. */
export function listChatToolNames(): readonly string[] {
  return CHAT_TOOL_NAMES;
}
