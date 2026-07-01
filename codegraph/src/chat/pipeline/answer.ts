/**
 * Answer builders — graph metadata first, minimal snippets only when needed.
 */
import type CodeGraph from '../../index';
import type { Node } from '../../types';
import type { GraphAnswer, QueryContext, QueryIntent } from './types';
import { loc, rankNodes, codeTier } from './rank';
import {
  buildCallChain,
  callPathBetween,
  calleesOf,
  callersOf,
  functionsInFile,
  impactOf,
  nodeNamed,
  parseFromTo,
  registerRelatedNodes,
  searchSymbols,
  usagesOf,
  variablesInFile,
} from './graph-search';
import {
  findAppEntryFile,
  primaryAnchor,
} from './context';
import {
  formatNodeHeader,
  formatSnippet,
  snippetForNode,
  snippetMatchingLine,
} from './source-snip';

function ok(intent: QueryIntent, text: string, mode: 'graph' | 'graph+snippet' = 'graph'): GraphAnswer {
  return { text, mode, intent };
}

function chainText(nodes: Node[]): string {
  return nodes.map((n) => `${n.name}()`).join(' → ');
}

function listNodes(title: string, nodes: Node[], max = 8): string {
  if (!nodes.length) return '';
  const lines = [`**${title}**\n`];
  for (const n of nodes.slice(0, max)) lines.push(formatNodeHeader(n));
  if (nodes.length > max) lines.push(`- …and ${nodes.length - max} more`);
  return lines.join('\n');
}

export function buildGraphAnswer(
  cg: CodeGraph,
  projectRoot: string,
  ctx: QueryContext,
): GraphAnswer | null {
  const { intent, message, anchorNodes } = ctx;
  const anchor = primaryAnchor(anchorNodes, cg);

  switch (intent) {
    case 'show_source':
      return buildShowSource(cg, projectRoot, anchor, message);
    case 'execution_flow':
      return buildExecutionFlow(cg, anchor, message);
    case 'callers':
      return buildCallers(cg, anchor);
    case 'callees':
      return buildCallees(cg, anchor);
    case 'variables':
      return buildVariables(cg, projectRoot, anchor, message);
    case 'registers':
      return buildRegisters(cg, projectRoot, anchor, message);
    case 'modification_point':
      return buildModificationPoint(cg, projectRoot, anchor, message);
    case 'bug_location':
      return buildBugLocation(cg, anchor);
    case 'impact':
      return buildImpact(cg, anchor);
    case 'dependencies':
      return buildDependencies(cg, anchor);
    case 'architecture':
      return buildArchitecture(cg, anchor);
    case 'file_structure':
      return buildFileStructure(cg, message);
    case 'symbol_lookup':
      return buildSymbolLookup(cg, anchor, message);
    case 'general':
    default:
      return buildGeneral(cg, message);
  }
}

function buildShowSource(
  cg: CodeGraph,
  projectRoot: string,
  anchor: Node | null,
  message: string,
): GraphAnswer | null {
  const nodes = anchor ? [anchor] : searchSymbols(cg, message, 1);
  const node = nodes[0];
  if (!node) return null;
  const snip = snippetForNode(projectRoot, node);
  if (!snip) return ok('show_source', formatNodeHeader(node), 'graph');
  return ok(
    'show_source',
    `${formatNodeHeader(node)}\n\n${formatSnippet(snip, `${node.name} source`)}`,
    'graph+snippet',
  );
}

function buildExecutionFlow(cg: CodeGraph, anchor: Node | null, message: string): GraphAnswer | null {
  const { from, to } = parseFromTo(message);
  let start = from ? nodeNamed(cg, from) : anchor;
  const end = to ? nodeNamed(cg, to) : null;

  if (!start) {
    start = rankNodes(cg.getNodesByName('main').filter((n) => n.kind === 'function'))[0] ?? null;
  }
  if (!start || start.kind !== 'function') return null;

  let chain: Node[];
  if (end) {
    const path = callPathBetween(cg, start, end);
    chain = path ?? buildCallChain(cg, start, 8, end);
  } else {
    chain = buildCallChain(cg, start, 6);
  }

  const lines = [
    `**Execution flow:** ${chainText(chain)}`,
    '',
    ...chain.map((n) => formatNodeHeader(n)),
  ];
  return ok('execution_flow', lines.join('\n'));
}

function buildCallers(cg: CodeGraph, anchor: Node | null): GraphAnswer | null {
  if (!anchor) return null;
  const callers = callersOf(cg, anchor, 2);
  if (!callers.length) {
    return ok('callers', `**No callers** indexed for \`${anchor.name}\` at ${loc(anchor)}.`);
  }
  return ok('callers', listNodes(`Callers of \`${anchor.name}\` (${loc(anchor)})`, callers));
}

function buildCallees(cg: CodeGraph, anchor: Node | null): GraphAnswer | null {
  if (!anchor) return null;
  const callees = calleesOf(cg, anchor, 2);
  if (!callees.length) {
    return ok('callees', `**No callees** indexed for \`${anchor.name}\` at ${loc(anchor)}.`);
  }
  return ok('callees', listNodes(`\`${anchor.name}\` calls`, callees));
}

function buildVariables(
  cg: CodeGraph,
  projectRoot: string,
  anchor: Node | null,
  message: string,
): GraphAnswer | null {
  const filePath = anchor?.filePath ?? findAppEntryFile(cg);
  if (!filePath) return null;

  const vars = variablesInFile(cg, filePath);
  const lines = [`**Variables in \`${filePath.replace(/\\/g, '/')}\`**`, ''];

  if (vars.length) {
    lines.push('*From graph index:*');
    for (const v of vars.slice(0, 12)) lines.push(formatNodeHeader(v));
  }

  if (/\blocal\b/i.test(message) && anchor?.kind === 'function') {
    const snip = snippetForNode(projectRoot, anchor);
    if (snip) {
      lines.push('', `*Context in \`${anchor.name}()\`:*`, formatSnippet(snip, anchor.name));
    }
  }

  return vars.length || lines.length > 2 ? ok('variables', lines.join('\n'), vars.length ? 'graph' : 'graph+snippet') : null;
}

function buildRegisters(
  cg: CodeGraph,
  projectRoot: string,
  anchor: Node | null,
  message: string,
): GraphAnswer | null {
  const related = registerRelatedNodes(cg, message);
  const usageAnchor = anchor ?? related[0];
  if (!related.length && !usageAnchor) return null;

  const lines = ['**Register / peripheral references (from graph):**', ''];
  for (const n of related.slice(0, 8)) lines.push(formatNodeHeader(n));

  if (usageAnchor?.kind === 'function') {
    const regLine = snippetMatchingLine(
      projectRoot,
      usageAnchor,
      /->\s*(BSRR|ODR|IDR|MODER|RCC|GPIO)|HAL_GPIO/i,
    );
    if (regLine) {
      lines.push('', formatSnippet(regLine, 'Register access'));
      return ok('registers', lines.join('\n'), 'graph+snippet');
    }
  }

  return ok('registers', lines.join('\n'));
}

function buildModificationPoint(
  cg: CodeGraph,
  projectRoot: string,
  anchor: Node | null,
  message: string,
): GraphAnswer | null {
  let sym = anchor;

  if (/\bdelay|blink|speed|timer/i.test(message)) {
    sym =
      nodeNamed(cg, 'ledControl') ??
      nodeNamed(cg, 'HAL_Delay') ??
      searchSymbols(cg, 'Delay ledControl', 5).find((n) => n.kind === 'function') ??
      sym;
  } else if (!sym || sym.name === 'main') {
    const hits = searchSymbols(cg, message, 6).filter((n) => n.kind === 'function');
    sym = hits.find((n) => codeTier(n.filePath) <= 1) ?? hits[0] ?? sym;
  }

  if (!sym) return null;

  const callers = callersOf(cg, sym, 1);
  const lines = [
    `**Modify here:** \`${sym.name}\` at ${loc(sym)}`,
    callers.length
      ? `- Called from: ${callers.map((c) => `\`${c.name}\` (${loc(c)})`).join(', ')}`
      : '',
    `- Impact: ${impactOf(cg, sym, 1).length} related symbol(s) in graph`,
  ].filter(Boolean);

  if (sym.kind === 'function' && /\bdelay|blink|speed|timer/i.test(message)) {
    const snip = snippetMatchingLine(projectRoot, sym, /Delay\s*\(|delay|sleep|wait/i);
    if (snip) {
      lines.push('', formatSnippet(snip, 'Parameter to change'));
      return ok('modification_point', lines.join('\n'), 'graph+snippet');
    }
  }

  return ok('modification_point', lines.join('\n'));
}

function buildBugLocation(cg: CodeGraph, anchor: Node | null): GraphAnswer | null {
  if (!anchor) return null;
  const callers = callersOf(cg, anchor, 1);
  const usages = usagesOf(cg, anchor).slice(0, 6);
  const lines = [
    `**Investigate \`${anchor.name}\`** at ${loc(anchor)}`,
    `- Callers: ${callers.length ? callers.map((c) => `\`${c.name}\``).join(', ') : 'none indexed'}`,
  ];
  if (usages.length) {
    lines.push('', '*References in graph:*');
    for (const u of usages) lines.push(formatNodeHeader(u));
  }
  return ok('bug_location', lines.join('\n'));
}

function buildImpact(cg: CodeGraph, anchor: Node | null): GraphAnswer | null {
  if (!anchor) return null;
  const affected = impactOf(cg, anchor, 2).filter((n) => n.id !== anchor.id);
  if (!affected.length) {
    return ok('impact', `**No downstream impact** indexed for \`${anchor.name}\` at ${loc(anchor)}.`);
  }
  return ok('impact', listNodes(`Impact radius of \`${anchor.name}\``, affected, 10));
}

function buildDependencies(cg: CodeGraph, anchor: Node | null): GraphAnswer | null {
  const filePath = anchor?.filePath ?? findAppEntryFile(cg);
  if (!filePath) return null;

  const deps = cg.getFileDependencies(filePath);
  const dependents = cg.getFileDependents(filePath);
  const lines = [
    `**Dependencies for \`${filePath.replace(/\\/g, '/')}\`**`,
    deps.length ? `- Imports/includes: ${deps.slice(0, 10).map((d) => `\`${d}\``).join(', ')}` : '- No file dependencies indexed',
    dependents.length ? `- Used by: ${dependents.slice(0, 8).map((d) => `\`${d}\``).join(', ')}` : '',
  ].filter(Boolean);

  if (anchor) {
    const callees = calleesOf(cg, anchor, 1).slice(0, 6);
    if (callees.length) {
      lines.push('', '*Call dependencies:*');
      for (const c of callees) lines.push(formatNodeHeader(c));
    }
  }
  return ok('dependencies', lines.join('\n'));
}

function buildArchitecture(cg: CodeGraph, anchor: Node | null): GraphAnswer | null {
  const entry = anchor ?? rankNodes(cg.getNodesByName('main').filter((n) => n.kind === 'function'))[0];
  const appFile = findAppEntryFile(cg);
  const lines = ['**Architecture overview (from graph):**', ''];

  if (appFile) {
    const funcs = functionsInFile(cg, appFile);
    lines.push(`*Application entry file:* \`${appFile}\``);
    for (const f of funcs.slice(0, 8)) lines.push(formatNodeHeader(f));
  }

  if (entry) {
    const chain = buildCallChain(cg, entry, 5);
    lines.push('', `*Primary runtime chain:* ${chainText(chain)}`);
  }

  const appFiles = cg.getFiles()
    .filter((f) => /Core[/\\]/i.test(f.path))
    .slice(0, 12)
    .map((f) => `\`${f.path.replace(/\\/g, '/')}\``);
  if (appFiles.length) {
    lines.push('', `*Core files (${appFiles.length} shown):* ${appFiles.join(', ')}`);
  }

  return lines.length > 2 ? ok('architecture', lines.join('\n')) : null;
}

function buildFileStructure(cg: CodeGraph, message: string): GraphAnswer | null {
  const pathMatch = message.match(/\b(?:under|in)\s+([\w./\\-]+)/i);
  const prefix = pathMatch?.[1]?.replace(/\\/g, '/') ?? '';
  let files = cg.getFiles().map((f) => f.path.replace(/\\/g, '/'));
  if (prefix) files = files.filter((f) => f.startsWith(prefix) || f.includes(prefix));
  files = files.filter((f) => !/\/Debug\//i.test(f)).slice(0, 20);
  if (!files.length) return null;

  return ok(
    'file_structure',
    `**Indexed files${prefix ? ` under \`${prefix}\`` : ''}:**\n${files.map((f) => `- \`${f}\``).join('\n')}`,
  );
}

function buildSymbolLookup(cg: CodeGraph, anchor: Node | null, message: string): GraphAnswer | null {
  const sym = anchor ?? searchSymbols(cg, message, 1)[0];
  if (!sym) return null;

  const lines = [formatNodeHeader(sym)];
  if (sym.kind === 'function' || sym.kind === 'method') {
    const callees = calleesOf(cg, sym, 1).slice(0, 5);
    if (callees.length) lines.push(`- Calls: ${callees.map((c) => `\`${c.name}\``).join(', ')}`);
    const callers = callersOf(cg, sym, 1).slice(0, 3);
    if (callers.length) lines.push(`- Called by: ${callers.map((c) => `\`${c.name}\``).join(', ')}`);
  }
  return ok('symbol_lookup', lines.join('\n'));
}

function buildGeneral(cg: CodeGraph, message: string): GraphAnswer | null {
  const hits = searchSymbols(cg, message, 6);
  if (!hits.length) return null;
  return ok('general', listNodes('Relevant symbols', hits));
}
