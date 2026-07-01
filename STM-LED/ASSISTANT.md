# STM-LED CodeGraph Assistant — Quick Start

Full documentation: **[CODEGRAPH.md](./CODEGRAPH.md)**

## Run the assistant (no LLM needed)

```powershell
node C:\Users\ADMIN\led_blinking\codegraph\dist\bin\codegraph.js chat C:\Users\ADMIN\led_blinking\STM-LED
```

Or:

```powershell
.\scripts\stm-led-chat.ps1
```

## One-line test

```powershell
node C:\Users\ADMIN\led_blinking\codegraph\dist\bin\codegraph.js chat C:\Users\ADMIN\led_blinking\STM-LED --query "trace execution flow from main to ledControl"
```

## Sample queries

- `what are the local variables`
- `trace execution flow from main to ledControl`
- `where should I change the blink delay`
- `who calls ledControl`
- `how does main initialize GPIO`

## REPL commands

| Command | Action |
|---------|--------|
| `/help` | Show commands |
| `/status` | Index stats |
| `/sync` | Refresh index |
| `/clear` | Clear history |
| `/quit` | Exit |

Answers are **short and accurate**, built from the CodeGraph index of this repo — see [CODEGRAPH.md](./CODEGRAPH.md) for how it works.
