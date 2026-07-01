/**
 * Local chat agent — graph-first semantic pipeline with explore fallback.
 */
import type { ChatMessage } from './llm';
import { runPipeline, stripIntentTag } from './pipeline';

export interface LocalAgentOptions {
  projectPath: string;
  cg: import('../index').default;
  /** Graph-first concise answers (default true). False enables larger explore fallback. */
  concise?: boolean;
  trySynthesize?: boolean;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
}

export interface LocalTurnResult {
  answer: string;
  /** Full answer with intent tag — store in conversation history for follow-ups. */
  historyAnswer: string;
  toolCalls: number;
  tool: string;
  intent?: string;
}

export async function runLocalTurn(
  userMessage: string,
  history: ChatMessage[],
  opts: LocalAgentOptions,
): Promise<LocalTurnResult> {
  const verbose = opts.concise === false;

  const result = await runPipeline(userMessage, history, {
    projectPath: opts.projectPath,
    cg: opts.cg,
    trySynthesize: opts.trySynthesize,
    allowExploreFallback: true,
    onToolCall: opts.onToolCall,
  });

  // Verbose mode: if graph answered but user wanted source, note how to get more
  let answer = stripIntentTag(result.answer);
  if (verbose && result.source !== 'explore' && result.source === 'graph') {
    answer += '\n\n*(Use `--verbose-source` or ask "show source for \<symbol\>" for code snippets.)*';
  }

  return {
    answer,
    historyAnswer: result.answer,
    toolCalls: result.toolCalls,
    tool: result.source === 'explore' ? 'explore' : 'graph',
    intent: result.intent,
  };
}
