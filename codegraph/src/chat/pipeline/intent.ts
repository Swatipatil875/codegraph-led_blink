/**
 * Intent classifier — every query is categorized before graph search.
 */
import type { ChatMessage } from '../llm';
import type { QueryIntent } from './types';

const INTENT_RULES: Array<{ intent: QueryIntent; patterns: RegExp[] }> = [
  {
    intent: 'show_source',
    patterns: [
      /\b(show|print|display|dump|read)\s+(the\s+)?(full\s+)?(source|code|file|body|implementation)\b/i,
      /\bfull\s+(source|code|function|file)\b/i,
      /\bsource\s+code\s+for\b/i,
    ],
  },
  {
    intent: 'execution_flow',
    patterns: [
      /\b(execution\s+flow|call\s+chain|call\s+path|trace|path\s+from|flow\s+from|how\s+does\s+.+\s+(reach|get\s+to|call|work))\b/i,
      /\bfrom\s+\w+\s+to\s+\w+/i,
    ],
  },
  {
    intent: 'callers',
    patterns: [/\b(callers?|called\s+by|who\s+calls|what\s+calls)\b/i],
  },
  {
    intent: 'callees',
    patterns: [/\b(callees?|calls\s+what|what\s+does\s+.+\s+call|downstream\s+calls?)\b/i],
  },
  {
    intent: 'variables',
    patterns: [/\b(local|global|static)?\s*variables?\b/i, /\bmacro(s)?\b/i],
  },
  {
    intent: 'registers',
    patterns: [
      /\b(register|peripheral|BSRR|ODR|IDR|GPIO|GPIOC|RCC|MCU|hardware)\b/i,
      /\b(memory\s+mapped|MMIO|bit\s+band)\b/i,
    ],
  },
  {
    intent: 'modification_point',
    patterns: [
      /\b(where\s+(should|do|to|can)\s+i\s+(change|modify|edit|update|fix))\b/i,
      /\b(change|modify|edit|update)\s+(the\s+)?(delay|blink|speed|led|gpio|clock)\b/i,
    ],
  },
  {
    intent: 'bug_location',
    patterns: [
      /\b(bug|crash|fault|error|issue|problem|wrong|broken|fails?|debug)\b/i,
      /\b(where\s+is\s+the\s+(bug|issue|problem))\b/i,
    ],
  },
  {
    intent: 'impact',
    patterns: [/\b(impact|blast\s+radius|affected|what\s+breaks|dependents?)\b/i],
  },
  {
    intent: 'dependencies',
    patterns: [
      /\b(dependenc(y|ies)|depends\s+on|imports?|includes?|requires?)\b/i,
      /\bwhat\s+files?\s+does\s+.+\s+(use|import|depend)\b/i,
    ],
  },
  {
    intent: 'architecture',
    patterns: [
      /\b(architecture|overview|structure|components?|modules?|layers?|design)\b/i,
      /\bhow\s+is\s+.+\s+organized\b/i,
    ],
  },
  {
    intent: 'file_structure',
    patterns: [
      /\b(file\s+(tree|structure|layout)|list\s+files|project\s+layout|directory)\b/i,
      /\bfiles?\s+(in|under)\s+/i,
    ],
  },
  {
    intent: 'symbol_lookup',
    patterns: [
      /\b(where\s+is|find|lookup|locate|what\s+is|define[ds]?|declaration\s+of)\b/i,
    ],
  },
];

/** Follow-up patterns that inherit intent from context when message is short. */
const FOLLOWUP_PATTERNS: RegExp[] = [
  /^(and\s+)?(its?|their|those|these|that|the)\s/i,
  /^(what\s+about|how\s+about|also|more\s+on)\b/i,
  /^(show|list|trace)\s+(its?|their|those|the)\b/i,
];

function lastUserIntent(history: ChatMessage[]): QueryIntent | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== 'assistant') continue;
    const tag = m.content?.match(/<!-- intent:(\w+) -->/);
    if (tag?.[1]) return tag[1] as QueryIntent;
  }
  return null;
}

function isFollowUp(message: string): boolean {
  const t = message.trim();
  if (t.length > 120) return false;
  return FOLLOWUP_PATTERNS.some((p) => p.test(t));
}

/**
 * Classify user query intent. Uses conversation history for short follow-ups.
 */
export function classifyIntent(message: string, history: ChatMessage[]): QueryIntent {
  const text = message.trim();
  for (const { intent, patterns } of INTENT_RULES) {
    if (patterns.some((p) => p.test(text))) return intent;
  }
  if (isFollowUp(text) && history.length > 0) {
    const prev = lastUserIntent(history);
    if (prev && prev !== 'general' && prev !== 'show_source') return prev;
  }
  // Bare symbol name → symbol lookup
  if (/^[A-Za-z_]\w*$/.test(text) && text.length >= 2) return 'symbol_lookup';
  return 'general';
}

/** Embed intent in assistant message for follow-up resolution (stripped from display). */
export function tagAnswerWithIntent(answer: string, intent: QueryIntent): string {
  return `<!-- intent:${intent} -->\n${answer}`;
}

export function stripIntentTag(text: string): string {
  return text.replace(/^<!-- intent:\w+ -->\n?/, '');
}
