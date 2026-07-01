/**
 * Conversation context — anchors follow-up questions to prior symbols/files.
 */
import type CodeGraph from '../../index';
import type { Node } from '../../types';
import { extractCodeTokens } from '../../directory';
import type { ChatMessage } from '../llm';
import { dedupeNodes, rankNodes } from './rank';

export function extractSymbolsFromText(text: string): string[] {
  const out = new Set<string>();
  for (const t of extractCodeTokens(text)) out.add(t);
  for (const m of text.matchAll(/`([A-Za-z_][\w$]*)`/g)) out.add(m[1]!);
  for (const m of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{2,})\b/g)) out.add(m[1]!);
  return [...out];
}

export function extractFilesFromText(text: string): string[] {
  const files: string[] = [];
  for (const m of text.matchAll(/\*\*([^:*]+\.(?:c|h|cpp|hpp|ts|js|py|rs))(?::\d+)?\*\*/gi)) {
    files.push(m[1]!.replace(/\\/g, '/'));
  }
  for (const m of text.matchAll(/\b([A-Za-z0-9_./\\-]+\.(?:c|h|cpp|hpp))\b/gi)) {
    files.push(m[1]!.replace(/\\/g, '/'));
  }
  return files;
}

/**
 * Resolve anchor nodes from current message + recent conversation.
 */
export function resolveAnchorNodes(
  cg: CodeGraph,
  message: string,
  history: ChatMessage[],
): Node[] {
  const names = new Set<string>(extractSymbolsFromText(message));

  const recent = history.slice(-6);
  for (const m of recent) {
    for (const s of extractSymbolsFromText(m.content ?? '')) names.add(s);
  }

  const nodes: Node[] = [];
  for (const name of names) {
    for (const n of cg.getNodesByName(name)) nodes.push(n);
  }

  // Prefer symbols from files mentioned in recent history
  const recentFiles = new Set<string>();
  for (const m of recent) {
    for (const f of extractFilesFromText(m.content ?? '')) recentFiles.add(f);
  }
  if (recentFiles.size) {
    const inFile = nodes.filter((n) => recentFiles.has(n.filePath.replace(/\\/g, '/')));
    if (inFile.length) return dedupeNodes(rankNodes(inFile));
  }

  return dedupeNodes(rankNodes(nodes));
}

export function buildEnrichedMessage(message: string, history: ChatMessage[]): string {
  if (history.length === 0) return message;
  const recent = history.slice(-4);
  const contextLines = recent.map((m) => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    const body = (m.content ?? '').replace(/^<!-- intent:\w+ -->\n?/, '').slice(0, 600);
    return `${role}: ${body}`;
  });
  return `${contextLines.join('\n')}\n\nFollow-up: ${message}`;
}

export function primaryAnchor(nodes: Node[], cg: CodeGraph): Node | null {
  if (nodes.length) return nodes[0]!;
  const mains = rankNodes(cg.getNodesByName('main').filter((n) => n.kind === 'function'));
  return mains[0] ?? null;
}

export function findAppEntryFile(cg: CodeGraph): string | null {
  const f = cg.getFiles().find((file) => /Core[/\\]Src[/\\]main\.c$/i.test(file.path));
  return f?.path.replace(/\\/g, '/') ?? null;
}
