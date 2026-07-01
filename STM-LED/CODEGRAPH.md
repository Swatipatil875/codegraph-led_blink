# CodeGraph on STM-LED — How It Works

This document explains how **CodeGraph** is set up on the STM-LED embedded project, what it indexes, and how the terminal assistant answers questions from that index.

---

## Overview

**STM-LED** is an STM32F0 LED binary-counter firmware (8 LEDs on the upper 8 bits of GPIOC). **CodeGraph** builds a local semantic knowledge graph of the codebase — functions, variables, structs, call edges, and file dependencies — stored in `.codegraph/` at the project root.

The **terminal assistant** (`codegraph chat`) queries that graph and returns **short, accurate answers** with `file:line` citations. It does not use hardcoded STM32 answers; every response is derived from the indexed repository.

```
┌─────────────┐     ask question      ┌──────────────────┐
│   You       │ ───────────────────►  │  codegraph chat  │
│  (terminal) │                       │  (local agent)   │
└─────────────┘                       └────────┬─────────┘
       ▲                                       │
       │ concise answer                        │ query graph
       │ (symbols, flows, locations)           ▼
       │                              ┌──────────────────┐
       └──────────────────────────────│  .codegraph/     │
                                        │  SQLite index    │
                                        └────────┬─────────┘
                                                 │ built from
                                                 ▼
                                        ┌──────────────────┐
                                        │  STM-LED sources │
                                        │  Core, HAL, CMSIS│
                                        └──────────────────┘
```

---

## What Gets Indexed

| Area | Path | Purpose |
|------|------|---------|
| Application code | `LED/Core/Src/`, `LED/Core/Inc/` | `main`, `ledControl`, GPIO setup, clock config |
| HAL driver | `LED/Drivers/STM32F0xx_HAL_Driver/` | `HAL_GPIO_Init`, `HAL_Delay`, RCC, etc. |
| CMSIS / device headers | `LED/Drivers/CMSIS/` | `GPIO_TypeDef`, registers (`BSRR`, `ODR`), STM32F030 defs |
| Linker / config | `LED/*.ld`, `LED/*.ioc` | Build metadata (XML indexed as reference) |

**Excluded** (via `codegraph.json`):

- `LED/Debug/**` — build outputs
- `**/*.d`, `**/*.su`, `**/*.o`, `**/*.list`, `**/*.map` — compiler artifacts

Typical index size for this repo:

- **~68 files**
- **~1,788 symbols (nodes)**
- **~2,735 relationships (edges)**

---

## How Indexing Works

1. **Initialize** — creates `.codegraph/` and SQLite database.
2. **Scan** — walks the project tree, respecting `.gitignore` and `codegraph.json` excludes.
3. **Parse** — tree-sitter extracts C symbols: functions, variables, structs, enums, calls.
4. **Resolve** — builds call edges (`main` → `ledControl` → `HAL_Delay`, etc.).
5. **Sync** — file watcher updates the graph when you edit code (auto-sync on by default).

```powershell
# First-time setup (already done if .codegraph/ exists)
node C:\Users\ADMIN\led_blinking\codegraph\dist\bin\codegraph.js init C:\Users\ADMIN\led_blinking\STM-LED

# Check index health
node C:\Users\ADMIN\led_blinking\codegraph\dist\bin\codegraph.js status C:\Users\ADMIN\led_blinking\STM-LED

# Refresh after manual edits
node C:\Users\ADMIN\led_blinking\codegraph\dist\bin\codegraph.js sync C:\Users\ADMIN\led_blinking\STM-LED
```

---

## How the Chat Assistant Works

### Graph-first pipeline (default)

Every query follows this path:

```
User Query
      │
      ▼
Intent Classifier
(symbol, flow, callers, variables, registers,
 dependencies, modification, architecture, …)
      │
      ▼
Graph Search (~90%)
(getNodesByName → getCallers/getCallees →
 findPath → findUsages → getImpactRadius → file deps)
      │
      ▼
Rank & Filter
(Core/app code > user code > HAL > CMSIS)
      │
      ▼
Retrieve 5–15 source lines (only if graph metadata insufficient)
      │
      ▼
Concise answer + file:line citations
      │
      ▼
Fallback: codegraph_explore (only when graph cannot answer)
```

**Intent types:** `symbol_lookup`, `execution_flow`, `callers`, `callees`, `variables`, `registers`, `modification_point`, `dependencies`, `impact`, `architecture`, `bug_location`, `file_structure`, `show_source`, `general`.

**Source policy:** Full functions/files are never dumped unless you explicitly ask (`show source for ledControl`) or use `--verbose-source`.

### Default: local mode (no LLM required)

When you ask a question, the assistant:

1. **Classifies** the question (variables, flow, callers, where-to-edit, symbol lookup).
2. **Queries the graph** directly — `getNodesByName`, `getCallers`, `getCallees`, `getNodesInFile`.
3. **Reads small line ranges** from disk when needed (e.g. variable declarations, `HAL_Delay` line).
4. **Prioritizes app code** (`Core/`) over vendor HAL/CMSIS noise.
5. **Returns a short answer** with `file:line` links — not full source dumps.

### Fallback: explore mode

If concise mode cannot answer, CodeGraph runs `codegraph_explore` (limited to 2 files) to retrieve relevant source and call paths.

### Optional: LLM mode

```powershell
node ... codegraph.js chat C:\Users\ADMIN\led_blinking\STM-LED --llm
```

Requires an OpenAI-compatible endpoint (`codegraph offload set-endpoint` or env vars). Not needed for normal use.

---

## Answer Types (Examples from Your Repo)

| Question type | What CodeGraph uses | Example output |
|---------------|---------------------|----------------|
| Variables | Nodes + line scan in `main.c` | `led`, `ledState`, `ledArray`, `count` at lines 24–27 |
| Execution flow | Call graph edges | `main()` → `ledControl()` → `HAL_Delay()` |
| Where to modify | Symbol + callers + body scan | Edit `ledControl` at `main.c:56`; delay at `HAL_Delay(500)` line 63 |
| Callers / callees | `getCallers` / `getCallees` | `main` calls `ledControl` |
| Symbol lookup | `searchNodes` / `getNodesByName` | `ledControl` (function) — `LED/Core/Src/main.c:56` |

All facts come from the index and on-disk lines — nothing is invented.

---

## Commands

### Start interactive chat

```powershell
node C:\Users\ADMIN\led_blinking\codegraph\dist\bin\codegraph.js chat C:\Users\ADMIN\led_blinking\STM-LED
```

Or:

```powershell
C:\Users\ADMIN\led_blinking\STM-LED\scripts\stm-led-chat.ps1
```

### One-shot query

```powershell
node C:\Users\ADMIN\led_blinking\codegraph\dist\bin\codegraph.js chat C:\Users\ADMIN\led_blinking\STM-LED --query "trace execution flow from main to ledControl"
```

### Build CodeGraph (after source changes to CodeGraph itself)

```powershell
cd C:\Users\ADMIN\led_blinking\codegraph
npm install
npx tsc
```

### Inside the chat REPL

| Command | Action |
|---------|--------|
| `/help` | Show commands |
| `/status` | Files, nodes, edges count |
| `/sync` | Re-sync index from disk |
| `/clear` | Clear conversation history |
| `/quit` | Exit |

### Flags

| Flag | Effect |
|------|--------|
| `--init` | Index project if not yet initialized |
| `--query "..."` | Single question, then exit |
| `--verbose-source` | Full source dumps instead of concise answers |
| `--llm` | Use external LLM + tool calling (optional) |
| `--quiet-tools` | Hide tool-call progress on stderr |

---

## Sample Queries

Copy these into the chat prompt:

```
what are the local variables
trace execution flow from main to ledControl
where should I change the blink delay
who calls ledControl
what does ledControl call
where is ledControl defined
how does main initialize GPIO
what register writes control the LEDs on GPIOC
list files in Core
```

**Expected concise answer** for flow:

```
Call flow from main() → ledControl()

main() — LED/Core/Src/main.c:33
  ↓
ledControl() — LED/Core/Src/main.c:56
  ↓
HAL_Delay() — LED/Drivers/STM32F0xx_HAL_Driver/Src/stm32f0xx_hal.c:358
```

---

## Project Layout (CodeGraph-related)

```
STM-LED/
├── codegraph.json          # Exclude rules for indexing
├── .codegraph/             # Local index (SQLite, auto-generated)
│   └── codegraph.db
├── CODEGRAPH.md            # This file
├── scripts/
│   └── stm-led-chat.ps1    # Launcher script
└── LED/
    ├── Core/Src/main.c     # Primary application logic
    ├── Core/Inc/
    └── Drivers/              # HAL + CMSIS (indexed for call/register context)
```

---

## Customization in CodeGraph (repo fork)

The following was added under `codegraph/src/chat/` for this project:

| Module | Role |
|--------|------|
| `pipeline/intent.ts` | Query intent classifier |
| `pipeline/graph-search.ts` | Symbol/call/dependency graph queries |
| `pipeline/rank.ts` | App > HAL > CMSIS ranking + dedup |
| `pipeline/source-snip.ts` | 5–15 line source reads when needed |
| `pipeline/answer.ts` | Intent-specific graph answer builders |
| `pipeline/index.ts` | Pipeline orchestrator + explore fallback |
| `local-agent.ts` | CLI integration |
| `repl.ts` | Terminal REPL with conversation context |

CLI entry: `codegraph chat [path]` in `codegraph/src/bin/codegraph.ts`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `CodeGraph not initialized` | Run `codegraph init STM-LED` or `chat ... --init` |
| Long code dumps | Default is concise; avoid `--verbose-source` |
| `fetch failed` | You used `--llm` or Ollama env vars without a running server — use default chat (no LLM) |
| Stale answers after edits | `/sync` in chat or `codegraph sync STM-LED` |
| `tsc` not found | Run `npm install` in `codegraph/`, then `npx tsc` |

---

## Summary

CodeGraph **analyzes** your STM-LED firmware once (and keeps it updated on file changes). The chat assistant **queries** that analysis — call graphs, symbols, file locations — and returns **short, repo-specific answers**. No cloud, no hardcoded firmware logic, no full-file dumps unless you ask for verbose source mode.
