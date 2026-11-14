# Agent Reach — setup for this repo

This folder is the Agent Reach skill (https://github.com/Panniantong/Agent-Reach, MIT).
The skill only works if the `agent-reach` CLI is installed on the machine running Claude Code.

## If `agent-reach version` fails, install it

```bash
# 1. uv (skip if `uv --version` works)
curl -LsSf https://astral.sh/uv/install.sh | sh          # macOS / Linux
# powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"   # Windows

# 2. Agent Reach (GitHub only — the PyPI package named agent-reach is a different project)
uv tool install https://github.com/Panniantong/Agent-Reach/releases/latest/download/agent-reach.zip
agent-reach setup
```

Update later with `agent-reach update`.

## Rules for this repo

- Read-only use: search, read pages, YouTube transcripts, Reddit, GitHub.
- Never log in to the Grime Busters business accounts with it. Cookie-based logins
  (X, Instagram, Facebook, XiaoHongShu) can get accounts rate-limited or banned —
  use a throwaway account if login is ever needed.
- Prefer Claude's built-in web search/fetch first; use Agent Reach for what those can't get.
