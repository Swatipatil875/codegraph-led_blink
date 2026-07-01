/**
 * Chat pipeline types — graph-first semantic assistant.
 */
import type { Node } from '../../types';

export type QueryIntent =
  | 'show_source'
  | 'execution_flow'
  | 'callers'
  | 'callees'
  | 'variables'
  | 'registers'
  | 'modification_point'
  | 'dependencies'
  | 'impact'
  | 'architecture'
  | 'bug_location'
  | 'symbol_lookup'
  | 'file_structure'
  | 'general';

export interface QueryContext {
  /** Raw user message */
  message: string;
  /** Message enriched with conversation anchors */
  enrichedMessage: string;
  /** Classified intent */
  intent: QueryIntent;
  /** Symbols/files anchored from history + current query */
  anchorSymbols: string[];
  anchorNodes: Node[];
}

export interface GraphAnswer {
  /** Non-empty when the graph could answer */
  text: string;
  /** graph = metadata only; graph+snippet = included ≤15 source lines */
  mode: 'graph' | 'graph+snippet';
  intent: QueryIntent;
}

export interface PipelineResult {
  answer: string;
  intent: QueryIntent;
  source: 'graph' | 'graph+snippet' | 'explore';
  toolCalls: number;
}

/** Max source lines retrieved when graph metadata is insufficient. */
export const MAX_SNIPPET_LINES = 15;
export const MIN_SNIPPET_LINES = 5;
