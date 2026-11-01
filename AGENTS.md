# Shared AI review contract

This repository uses pull requests as the only path to protected branches.

## Review standard

- Compare every code change with the pull request description and the original
  task. Flag missed requirements, incorrect behavior, security or privacy
  regressions, untested changes, and unnecessary scope.
- Reviews must be specific: identify the file and behavior, explain the impact,
  and state the expected correction. Review feedback for Claude goes in an
  `@claude` comment from a repository owner, member or collaborator.
- Do not approve a pull request merely because it builds. Relevant tests,
  linting, type checks, security-rule tests, and build verification must be
  considered for the change.

## Claude response contract

- Claude must address each actionable `@claude` review comment or explain the
  conflict before committing. It must not merge pull requests or push directly
  to protected branches.
- Claude must make focused commits and report exactly what it changed and which
  checks it ran. Failed or skipped checks must be disclosed.

## Required human configuration

- Protect `main` in GitHub: require pull requests and passing CI; disable direct
  pushes and force pushes. There is no automated AI review gate (the Codex
  gate was removed on 2026-10-21) and no auto-merge.
- Configure the Claude GitHub Action with the `ANTHROPIC_API_KEY` repository
  secret and install the Claude GitHub App with access only to this repository.
- Claude-authored pull requests are not reviewed automatically. The owner
  reads and merges them; CI is the automated bar.
