/**
 * @deprecated Use `runPipeline` from `./pipeline` — kept for compatibility.
 */
import type CodeGraph from '../index';
import type { ChatMessage } from './llm';
import { runPipeline, stripIntentTag } from './pipeline';

export async function tryConciseAnswer(
  cg: CodeGraph,
  projectRoot: string,
  userMessage: string,
  history: ChatMessage[],
): Promise<string | null> {
  const result = await runPipeline(userMessage, history, {
    projectPath: projectRoot,
    cg,
    allowExploreFallback: false,
  });
  const text = stripIntentTag(result.answer).trim();
  return text || null;
}
