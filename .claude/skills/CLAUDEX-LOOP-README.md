# Vendored: claudex-loop

These four skill folders — `claudex-loop/`, `claudex-route/`, `codex-build/`,
`codex-review/` — are a verbatim copy of the `skills/` directory of

  https://github.com/chaseai-yt/claudex-loop
  pinned at commit 8cf5e2c1771c5151d90c12642391d0ba8fa71b0e (2026-09-06)

MIT licensed; the upstream licence is kept alongside them as
`CLAUDEX-LOOP-LICENSE`. Copied here rather than installed through
`/plugin marketplace add` because a project skill has to live in the
repository to be available to a Claude Code session working on it — which is
also how `ui-ux-pro-max/` next door got here.

## What it is

A workflow for hardening a plan with a *second* model before building it:
one provider plans, the other reviews the plan, one builds, and the one that
did not build inspects the result. "Whoever built it never grades it."

## What it needs, which this repo does not currently have

`claudex-loop`, `codex-build` and `codex-review` all shell out to a **Codex
CLI** as the second provider. There is no `codex` binary in the Claude Code
remote environment this repo is worked on from, so those three cannot
complete a round there — they will fail at the handoff rather than silently
falling back to a single model, which is the correct behaviour but is still a
failure. They work from a local machine that has both CLIs installed and
authenticated.

`claudex-route` is the exception: it is self-contained, and only *recommends*
a model and a scoped handoff. That one is useful anywhere.

## Updating

Re-copy `skills/` from the upstream repository at a newer commit and update
the pinned SHA above. There is no dependency manifest to bump — these are
plain instruction files plus one Python runner, vendored deliberately.
