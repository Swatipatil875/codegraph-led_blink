/**
 * OpenAI-compatible chat client for the terminal assistant.
 * Reuses the same endpoint configuration as CodeGraph offload
 * (`codegraph offload` / CODEGRAPH_OFFLOAD_* env vars).
 */
import { resolveOffload } from '../reasoning/config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionResult {
  message: ChatMessage;
  finishReason?: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: OpenAITool[];
  maxTokens?: number;
  temperature?: number;
}

function chatUrl(): string | undefined {
  const cfg = resolveOffload();
  if (!cfg.url) return undefined;
  return cfg.url.replace(/\/+$/, '') + '/chat/completions';
}

/** True when an LLM endpoint is configured for the chat assistant. */
export function isChatLlmConfigured(): boolean {
  return resolveOffload().enabled;
}

/** Human-readable setup hint when no LLM is configured. */
export function chatLlmSetupHint(): string {
  return [
    'No LLM endpoint configured. The chat assistant needs an OpenAI-compatible API.',
    '',
    'Option A — CodeGraph AI (managed):',
    '  codegraph offload login',
    '',
    'Option B — Bring your own endpoint (Ollama, OpenAI, Cerebras, etc.):',
    '  codegraph offload set-endpoint --url https://api.example.com/v1 --model your-model --key-env YOUR_API_KEY_ENV',
    '  set YOUR_API_KEY_ENV=sk-...   (PowerShell: $env:YOUR_API_KEY_ENV="sk-...")',
    '',
    'Option C — Environment variables:',
    '  CODEGRAPH_OFFLOAD_URL=https://api.example.com/v1',
    '  CODEGRAPH_OFFLOAD_MODEL=your-model',
    '  CODEGRAPH_OFFLOAD_KEY=your-api-key',
  ].join('\n');
}

/**
 * Call the configured OpenAI-compatible chat/completions endpoint.
 * Supports tool calling when `tools` is provided.
 */
export async function chatCompletion(opts: ChatOptions): Promise<ChatCompletionResult> {
  const cfg = resolveOffload();
  const url = chatUrl();
  if (!url) {
    throw new Error('No LLM endpoint configured. Run `codegraph offload set-endpoint` or set CODEGRAPH_OFFLOAD_URL.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? cfg.maxTokens,
      temperature: opts.temperature ?? 0.2,
      reasoning_effort: cfg.effort,
    };
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = 'auto';
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 400);
      throw new Error(`LLM request failed (${res.status}): ${detail || res.statusText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: ChatMessage;
        finish_reason?: string;
      }>;
    };

    const choice = data.choices?.[0];
    if (!choice?.message) {
      throw new Error('LLM returned an empty response.');
    }

    return {
      message: choice.message,
      finishReason: choice.finish_reason,
    };
  } finally {
    clearTimeout(timer);
  }
}
