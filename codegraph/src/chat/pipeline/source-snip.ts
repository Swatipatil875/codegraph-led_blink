/**
 * Minimal source retrieval — only when graph metadata is insufficient.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Node } from '../../types';
import { MAX_SNIPPET_LINES, MIN_SNIPPET_LINES } from './types';
import { loc } from './rank';

export interface SourceSnippet {
  filePath: string;
  startLine: number;
  endLine: number;
  lines: string[];
}

function readFileLines(projectRoot: string, filePath: string): string[] {
  try {
    return fs.readFileSync(path.join(projectRoot, filePath), 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

/**
 * Read at most `maxLines` (clamped 5–15) centered on `centerLine` (1-based).
 */
export function readSnippet(
  projectRoot: string,
  filePath: string,
  centerLine: number,
  maxLines: number = MAX_SNIPPET_LINES,
): SourceSnippet | null {
  const all = readFileLines(projectRoot, filePath);
  if (!all.length) return null;

  const cap = Math.min(MAX_SNIPPET_LINES, Math.max(MIN_SNIPPET_LINES, maxLines));
  const half = Math.floor(cap / 2);
  const start = Math.max(1, centerLine - half);
  const end = Math.min(all.length, start + cap - 1);
  const adjustedStart = Math.max(1, end - cap + 1);

  const slice = all.slice(adjustedStart - 1, end);
  return { filePath, startLine: adjustedStart, endLine: end, lines: slice };
}

/** Snippet around a graph node's definition (capped at node span or 15 lines). */
export function snippetForNode(projectRoot: string, node: Node): SourceSnippet | null {
  const span = node.endLine - node.startLine + 1;
  const center = node.startLine + Math.floor(span / 2);
  const maxLines = Math.min(MAX_SNIPPET_LINES, Math.max(MIN_SNIPPET_LINES, Math.min(span, MAX_SNIPPET_LINES)));
  return readSnippet(projectRoot, node.filePath, center, maxLines);
}

/** Find first line matching pattern inside a node body; return small snippet. */
export function snippetMatchingLine(
  projectRoot: string,
  node: Node,
  pattern: RegExp,
): SourceSnippet | null {
  const all = readFileLines(projectRoot, node.filePath);
  for (let i = node.startLine; i <= Math.min(node.endLine, all.length); i++) {
    const line = all[i - 1] ?? '';
    if (pattern.test(line)) {
      return readSnippet(projectRoot, node.filePath, i, MIN_SNIPPET_LINES);
    }
  }
  return null;
}

export function formatSnippet(snippet: SourceSnippet, label?: string): string {
  const header = label
    ? `*${label}* (\`${snippet.filePath}:${snippet.startLine}-${snippet.endLine}\`):`
    : `*Snippet* (\`${snippet.filePath}:${snippet.startLine}-${snippet.endLine}\`):`;
  const body = snippet.lines
    .map((ln, i) => `${snippet.startLine + i}\t${ln}`)
    .join('\n');
  return `${header}\n\`\`\`c\n${body}\n\`\`\``;
}

export function formatNodeHeader(node: Node): string {
  const sig = node.signature ? ` — \`${node.signature.trim()}\`` : '';
  return `- **${node.name}** (${node.kind}) at ${loc(node)}${sig}`;
}
