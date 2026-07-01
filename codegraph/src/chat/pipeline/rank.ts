/**
 * Rank and deduplicate graph nodes — app code > user code > HAL > CMSIS > vendor.
 */
import type { Node } from '../../types';

/** Lower tier = higher priority in results. */
export function codeTier(filePath: string): number {
  const p = filePath.replace(/\\/g, '/');
  if (/\/Core\/(Src|Inc)\//i.test(p)) return 0;
  if (/\/(Src|Inc|App|Application)\//i.test(p) && !/\/Drivers\//i.test(p)) return 1;
  if (/\/Drivers\/STM32.*HAL/i.test(p)) return 2;
  if (/\/Drivers\/CMSIS/i.test(p)) return 3;
  if (/\/Debug\//i.test(p)) return 9;
  return 4;
}

export function rankNodes(nodes: Node[]): Node[] {
  return [...nodes].sort((a, b) => {
    const tier = codeTier(a.filePath) - codeTier(b.filePath);
    if (tier !== 0) return tier;
    return a.startLine - b.startLine;
  });
}

/** Merge duplicate name+file matches; keep best-ranked per (name, filePath). */
export function dedupeNodes(nodes: Node[]): Node[] {
  const best = new Map<string, Node>();
  for (const n of rankNodes(nodes)) {
    const key = `${n.name}\0${n.filePath.replace(/\\/g, '/')}`;
    if (!best.has(key)) best.set(key, n);
  }
  return rankNodes([...best.values()]);
}

export function loc(n: Pick<Node, 'filePath' | 'startLine' | 'endLine'>): string {
  if (n.endLine && n.endLine !== n.startLine) {
    return `\`${n.filePath}:${n.startLine}-${n.endLine}\``;
  }
  return `\`${n.filePath}:${n.startLine}\``;
}

export function isSemanticKind(n: Node): boolean {
  return [
    'function', 'method', 'variable', 'constant', 'struct', 'enum',
    'type_alias', 'class', 'field', 'enum_member',
  ].includes(n.kind);
}
