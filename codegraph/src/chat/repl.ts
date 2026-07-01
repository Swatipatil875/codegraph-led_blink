/**
 * Terminal REPL for the CodeGraph chat assistant.
 */
import * as readline from 'readline';
import type CodeGraph from '../index';
import { isInitialized } from '../directory';
import { runAgentTurn } from './agent';
import { runLocalTurn } from './local-agent';
import { isChatLlmConfigured, chatLlmSetupHint, type ChatMessage } from './llm';
import { ToolHandler } from '../mcp/tools';

export type ChatMode = 'local' | 'llm';

export interface ReplOptions {
  projectPath: string;
  cg: CodeGraph;
  /** local = CodeGraph only (default); llm = tool-calling agent via external LLM */
  mode?: ChatMode;
  /** Short graph-derived answers (default true). */
  concise?: boolean;
  /** Show tool-call progress on stderr (default true). */
  verbose?: boolean;
}

const SLASH_COMMANDS = new Map<string, string>([
  ['help', 'Show commands'],
  ['quit', 'Exit the assistant'],
  ['exit', 'Exit the assistant'],
  ['clear', 'Clear conversation history'],
  ['sync', 'Sync index with filesystem changes'],
  ['status', 'Show CodeGraph index stats'],
  ['tools', 'List available CodeGraph tools'],
]);

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`;
}

function cyan(s: string): string {
  return `\x1b[36m${s}\x1b[0m`;
}

function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}

function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[0m`;
}

function printBanner(projectPath: string, fileCount: number, mode: ChatMode): void {
  console.log('');
  console.log(`${cyan('CodeGraph Assistant')} ${dim('— repository-specific code intelligence')}`);
  console.log(`${dim('Project:')} ${projectPath}`);
  console.log(`${dim('Indexed files:')} ${fileCount}`);
  console.log(`${dim('Mode:')} ${mode === 'local' ? 'graph-first semantic assistant' : 'LLM + CodeGraph tools'}`);
  console.log(`${dim('Type')} ${cyan('/help')} ${dim('for commands,')} ${cyan('/quit')} ${dim('to exit.')}`);
  console.log('');
}

function printHelp(mode: ChatMode): void {
  console.log('\nCommands:');
  for (const [cmd, desc] of SLASH_COMMANDS) {
    console.log(`  ${cyan('/' + cmd.padEnd(8))}${desc}`);
  }
  console.log('');
  console.log('Ask anything about the indexed codebase — execution flow, symbols,');
  console.log('call graphs, where to modify code, peripherals, macros, etc.');
  console.log('Answers come only from CodeGraph queries, not hardcoded knowledge.');
  if (mode === 'local') {
    console.log(`\n${dim('Running in local mode — no external LLM required.')}`);
    console.log(`${dim('For LLM-enhanced answers: codegraph chat --llm (requires offload endpoint)')}\n`);
  } else {
    console.log('');
  }
}

async function handleSlashCommand(
  cmd: string,
  opts: ReplOptions,
  history: ChatMessage[],
  mode: ChatMode,
): Promise<'continue' | 'exit'> {
  switch (cmd) {
    case 'help':
      printHelp(mode);
      return 'continue';
    case 'quit':
    case 'exit':
      console.log('Goodbye.');
      return 'exit';
    case 'clear':
      history.length = 0;
      console.log(green('Conversation cleared.'));
      return 'continue';
    case 'sync': {
      process.stdout.write(`${dim('Syncing index…')}\n`);
      await opts.cg.sync();
      console.log(green('Index synced.'));
      return 'continue';
    }
    case 'status': {
      process.env.CODEGRAPH_MCP_TOOLS = 'status';
      const handler = new ToolHandler(opts.cg);
      const result = await handler.execute('codegraph_status', {});
      console.log(result.content[0]?.text ?? '(no status)');
      return 'continue';
    }
    case 'tools': {
      const { listChatToolNames } = await import('./agent');
      console.log('\nCodeGraph tools available to the assistant:');
      for (const t of listChatToolNames()) {
        console.log(`  • codegraph_${t}`);
      }
      console.log('');
      return 'continue';
    }
    default:
      console.log(yellow(`Unknown command: /${cmd}. Type /help.`));
      return 'continue';
  }
}

async function runTurn(
  trimmed: string,
  history: ChatMessage[],
  opts: ReplOptions,
  mode: ChatMode,
  verbose: boolean,
): Promise<{ answer: string; historyAnswer: string; toolCalls: number }> {
  const onToolCall = verbose
    ? (name: string, args: Record<string, unknown>) => {
        const short = name.replace(/^codegraph_/, '');
        const argPreview = JSON.stringify(args).slice(0, 80);
        process.stderr.write(`${dim(`  ↳ ${short}(${argPreview}${argPreview.length >= 80 ? '…' : ''})`)}\n`);
      }
    : undefined;

  if (mode === 'llm') {
    const { answer, toolCalls } = await runAgentTurn(trimmed, history, {
      projectPath: opts.projectPath,
      cg: opts.cg,
      onToolCall,
      onToolResult: verbose
        ? (name) => process.stderr.write(`${dim(`  ✓ ${name.replace(/^codegraph_/, '')}`)}\n`)
        : undefined,
    });
    return { answer, historyAnswer: answer, toolCalls };
  }

  const { answer, historyAnswer, toolCalls } = await runLocalTurn(trimmed, history, {
      projectPath: opts.projectPath,
      cg: opts.cg,
      concise: opts.concise,
      trySynthesize: isChatLlmConfigured(),
      onToolCall,
    });
  return { answer, historyAnswer, toolCalls };
}

/**
 * Start the interactive chat loop. Resolves when the user exits.
 */
export async function runRepl(opts: ReplOptions): Promise<void> {
  const mode: ChatMode = opts.mode ?? 'local';

  if (mode === 'llm' && !isChatLlmConfigured()) {
    console.error(chatLlmSetupHint());
    process.exit(1);
  }

  if (!isInitialized(opts.projectPath)) {
    console.error(`CodeGraph is not initialized in ${opts.projectPath}. Run: codegraph init "${opts.projectPath}"`);
    process.exit(1);
  }

  const files = opts.cg.getFiles();
  printBanner(opts.projectPath, files.length, mode);

  const history: ChatMessage[] = [];
  const verbose = opts.verbose !== false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdout.isTTY ?? false,
    prompt: cyan('you> '),
  });

  const ask = (): void => {
    rl.prompt();
  };

  rl.on('line', (line) => {
    void (async () => {
      const trimmed = line.trim();
      if (!trimmed) {
        ask();
        return;
      }

      if (trimmed.startsWith('/')) {
        const cmd = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
        const action = await handleSlashCommand(cmd, opts, history, mode);
        if (action === 'exit') {
          rl.close();
          return;
        }
        ask();
        return;
      }

      rl.pause();
      try {
        const { answer, historyAnswer, toolCalls } = await runTurn(trimmed, history, opts, mode, verbose);

        history.push({ role: 'user', content: trimmed });
        history.push({ role: 'assistant', content: historyAnswer.slice(0, 4000) });
        while (history.length > 20) history.shift();

        console.log('');
        console.log(answer);
        if (verbose && toolCalls > 0) {
          process.stderr.write(`${dim(`(${toolCalls} graph ${toolCalls === 1 ? 'query' : 'queries'})`)}\n`);
        } else if (verbose && toolCalls === 0) {
          process.stderr.write(`${dim('(graph)')}\n`);
        }
        console.log('');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (mode === 'llm' && /fetch failed|ECONNREFUSED|abort/i.test(msg)) {
          console.error(`\n${yellow('LLM unavailable')} — retrying in local mode…\n`);
          try {
            const { answer, historyAnswer, toolCalls } = await runTurn(trimmed, history, { ...opts, mode: 'local' }, 'local', verbose);
            history.push({ role: 'user', content: trimmed });
            history.push({ role: 'assistant', content: historyAnswer.slice(0, 4000) });
            console.log(answer);
            if (verbose && toolCalls > 0) {
              process.stderr.write(`${dim(`(${toolCalls} CodeGraph ${toolCalls === 1 ? 'query' : 'queries'})`)}\n`);
            }
            console.log('');
          } catch (inner) {
            console.error(`\n${yellow('Error:')} ${inner instanceof Error ? inner.message : String(inner)}\n`);
          }
        } else {
          console.error(`\n${yellow('Error:')} ${msg}\n`);
        }
      } finally {
        rl.resume();
        ask();
      }
    })();
  });

  rl.on('close', () => {
    process.stdout.write('\n');
  });

  ask();

  await new Promise<void>((resolve) => {
    rl.on('close', resolve);
  });
}

/** Non-interactive single-shot query (for scripting / CI smoke tests). */
export async function runOnceQuery(
  query: string,
  opts: ReplOptions,
): Promise<string> {
  const mode: ChatMode = opts.mode ?? 'local';
  if (mode === 'llm' && !isChatLlmConfigured()) {
    throw new Error(chatLlmSetupHint());
  }
  try {
    const { answer } = await runTurn(query, [], opts, mode, false);
    return answer;
  } catch (err) {
    if (mode === 'llm' && /fetch failed|ECONNREFUSED|abort/i.test(String(err))) {
      const { answer } = await runTurn(query, [], { ...opts, mode: 'local' }, 'local', false);
      return answer;
    }
    throw err;
  }
}
