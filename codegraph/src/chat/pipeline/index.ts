/**
 * Graph-first chat pipeline orchestrator.
 *
 * User Query → Intent Classifier → Graph Search → Rank & Filter →
 * Minimal source (if needed) → Concise answer → explore fallback (last resort)
 */
import type CodeGraph from '../../index';
import type { ChatMessage } from '../llm';
import { ToolHandler } from '../../mcp/tools';
import { CHAT_TOOL_NAMES } from '../agent';
import { synthesizeOffload, isOffloadEnabled } from '../../reasoning/reasoner';
import { classifyIntent, tagAnswerWithIntent } from './intent';
import {
  buildEnrichedMessage,
  resolveAnchorNodes,
  extractSymbolsFromText,
} from './context';
import { buildGraphAnswer } from './answer';
import type { PipelineResult, QueryContext } from './types';

export interface PipelineOptions {
  projectPath: string;
  cg: CodeGraph;
  trySynthesize?: boolean;
  allowExploreFallback?: boolean;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
}

function buildContext(
  cg: CodeGraph,
  message: string,
  history: ChatMessage[],
): QueryContext {
  const enrichedMessage = buildEnrichedMessage(message, history);
  const intent = classifyIntent(message, history);
  const anchorNodes = resolveAnchorNodes(cg, enrichedMessage, history);
  return {
    message,
    enrichedMessage,
    intent,
    anchorSymbols: extractSymbolsFromText(enrichedMessage),
    anchorNodes,
  };
}

/** Last-resort explore — capped, never the primary path. */
async function exploreFallback(
  handler: ToolHandler,
  query: string,
  onToolCall?: PipelineOptions['onToolCall'],
): Promise<string> {
  onToolCall?.('codegraph_explore', { query, maxFiles: 1 });
  const result = await handler.execute('codegraph_explore', { query, maxFiles: 1 });
  const text = result.content.map((c) => c.text ?? '').join('\n');
  if (!text.trim()) return 'No graph-based answer found. Try naming a specific symbol or function.';

  // Trim explore output — graph pipeline should not dump full files
  const MAX = 2500;
  if (text.length <= MAX) return text;
  return (
    text.slice(0, MAX) +
    '\n\n…(truncated — graph could not fully answer; name a specific symbol for a concise reply, or use `--verbose-source`)'
  );
}

/**
 * Run the graph-first pipeline for one user turn.
 */
export async function runPipeline(
  userMessage: string,
  history: ChatMessage[],
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const ctx = buildContext(opts.cg, userMessage, history);
  const graphAnswer = buildGraphAnswer(opts.cg, opts.projectPath, ctx);

  if (graphAnswer?.text.trim()) {
    let answer = tagAnswerWithIntent(graphAnswer.text.trim(), graphAnswer.intent);

    if (opts.trySynthesize && isOffloadEnabled()) {
      try {
        const synthesized = await synthesizeOffload({ query: userMessage, context: graphAnswer.text });
        if (synthesized) answer = tagAnswerWithIntent(synthesized, graphAnswer.intent);
      } catch { /* keep graph answer */ }
    }

    return {
      answer,
      intent: graphAnswer.intent,
      source: graphAnswer.mode,
      toolCalls: 0,
    };
  }

  if (opts.allowExploreFallback === false) {
    return {
      answer: tagAnswerWithIntent(
        'Could not answer from the graph alone. Name a function, variable, or file path.',
        ctx.intent,
      ),
      intent: ctx.intent,
      source: 'graph',
      toolCalls: 0,
    };
  }

  process.env.CODEGRAPH_MCP_TOOLS = CHAT_TOOL_NAMES.join(',');
  const handler = new ToolHandler(opts.cg);
  const exploreText = await exploreFallback(handler, ctx.enrichedMessage, opts.onToolCall);

  return {
    answer: tagAnswerWithIntent(exploreText, ctx.intent),
    intent: ctx.intent,
    source: 'explore',
    toolCalls: 1,
  };
}

export { classifyIntent, stripIntentTag } from './intent';
export type { QueryIntent, PipelineResult } from './types';
