/**
 * Graph search — primary retrieval layer (symbols, edges, paths, dependencies).
 */
import type CodeGraph from '../../index';
import type { Node } from '../../types';
import { dedupeNodes, rankNodes, isSemanticKind } from './rank';
import { extractSymbolsFromText } from './context';

export function searchSymbols(cg: CodeGraph, query: string, limit = 12): Node[] {
  const hits: Node[] = [];
  const seen = new Set<string>();

  for (const name of extractSymbolsFromText(query)) {
    for (const n of cg.getNodesByName(name)) {
      if (!seen.has(n.id) && isSemanticKind(n)) {
        seen.add(n.id);
        hits.push(n);
      }
    }
  }

  if (hits.length < limit) {
    for (const r of cg.searchNodes(query, { limit: limit * 2 })) {
      if (!seen.has(r.node.id) && isSemanticKind(r.node)) {
        seen.add(r.node.id);
        hits.push(r.node);
      }
    }
  }

  return dedupeNodes(rankNodes(hits)).slice(0, limit);
}

export function callersOf(cg: CodeGraph, node: Node, depth = 2): Node[] {
  return dedupeNodes(rankNodes(cg.getCallers(node.id, depth).map((x) => x.node)));
}

export function calleesOf(cg: CodeGraph, node: Node, depth = 2): Node[] {
  return dedupeNodes(rankNodes(cg.getCallees(node.id, depth).map((x) => x.node)));
}

export function usagesOf(cg: CodeGraph, node: Node): Node[] {
  return dedupeNodes(rankNodes(cg.findUsages(node.id).map((x) => x.node)));
}

export function impactOf(cg: CodeGraph, node: Node, depth = 2): Node[] {
  const sg = cg.getImpactRadius(node.id, depth);
  return dedupeNodes(rankNodes([...sg.nodes.values()].filter(isSemanticKind)));
}

export function callPathBetween(cg: CodeGraph, from: Node, to: Node): Node[] | null {
  const path = cg.findPath(from.id, to.id, ['calls']);
  if (!path?.length) return null;
  return path.map((p) => p.node);
}

/** BFS callee chain preferring ranked nodes at each hop. */
export function buildCallChain(cg: CodeGraph, start: Node, maxHops = 6, target?: Node): Node[] {
  const chain: Node[] = [start];
  let current = start;

  for (let hop = 0; hop < maxHops; hop++) {
    if (target && current.id === target.id) break;
    const next = calleesOf(cg, current, 1).filter((n) => n.kind === 'function' || n.kind === 'method');
    if (!next.length) break;
    const pick = target
      ? next.find((n) => n.id === target.id) ?? next[0]!
      : next[0]!;
    if (chain.some((c) => c.id === pick.id)) break;
    chain.push(pick);
    current = pick;
    if (target && pick.id === target.id) break;
  }

  if (target && !chain.some((n) => n.id === target.id)) {
    chain.push(target);
  }
  return chain;
}

export function registerRelatedNodes(cg: CodeGraph, query: string): Node[] {
  const terms = extractSymbolsFromText(query);
  const registerHints = ['BSRR', 'ODR', 'IDR', 'MODER', 'GPIO', 'GPIOC', 'RCC', 'GPIO_TypeDef'];
  for (const h of registerHints) {
    if (new RegExp(h, 'i').test(query)) terms.push(h);
  }

  const hits: Node[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    for (const n of cg.getNodesByName(t)) {
      if (!seen.has(n.id)) { seen.add(n.id); hits.push(n); }
    }
    for (const r of cg.searchNodes(t, { limit: 8 })) {
      if (!seen.has(r.node.id)) { seen.add(r.node.id); hits.push(r.node); }
    }
  }
  return dedupeNodes(rankNodes(hits)).slice(0, 10);
}

export function variablesInFile(cg: CodeGraph, filePath: string): Node[] {
  return dedupeNodes(
    rankNodes(cg.getNodesInFile(filePath).filter((n) => n.kind === 'variable' || n.kind === 'constant')),
  );
}

export function functionsInFile(cg: CodeGraph, filePath: string): Node[] {
  return dedupeNodes(
    rankNodes(cg.getNodesInFile(filePath).filter((n) => n.kind === 'function' || n.kind === 'method')),
  );
}

export function parseFromTo(query: string): { from?: string; to?: string } {
  const m = query.match(/\bfrom\s+(\w+)\s+to\s+(\w+)/i);
  if (!m) return {};
  return { from: m[1], to: m[2] };
}

export function nodeNamed(cg: CodeGraph, name: string): Node | null {
  const hits = rankNodes(cg.getNodesByName(name).filter(isSemanticKind));
  return hits[0] ?? null;
}
