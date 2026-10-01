# Claude Code instructions

## Pull-request workflow

- Never push directly to `main` or a release branch. Work on the pull request's
  branch only and never merge a pull request.
- A comment that begins with `@claude` from a repository owner, member, or
  collaborator is an instruction to address the stated review feedback.
- Read the pull request description, existing review comments, and the files
  involved before changing code. Treat each unresolved actionable review item
  as required unless it conflicts with the pull request's purpose or a safety
  constraint; explain any conflict in the PR before making a different change.
- Preserve unrelated work. Do not reformat, refactor, or update dependencies
  unless the review request requires it.

## Codex review gate

- Every change goes through Codex review before it reaches `main`. The gate is
  `.github/workflows/codex-auto-review.yml`, it runs on every pull request to
  `main` including drafts, and it posts findings as an `@claude` comment.
- Never report the gate as having reviewed anything without reading the `review`
  job's own result. A **skipped** review is not an approval, and for a long
  time it rendered as a green "Codex review gate" that had read nothing: both
  of the job's conditions excluded Claude's own pull requests, and the gate
  script turned the resulting skip into a pass. #58 changed security rules and
  merged that way. The script now fails on a skip, but the habit is the real
  protection — check the job, not the tick.
- A pull request is not ready to merge until Codex has actually reported, and
  its findings are addressed or explicitly answered. Say plainly when the gate
  has not run.
- There is no auto-merge. Merging is the maintainer's decision; a Codex
  approval is an input to it, not a substitute for it.
- Reviewing before pushing, from the local `claudex-loop` runner, needs the
  `codex` CLI on `PATH`. It is absent in the cloud container, so there the PR
  gate is the only Codex review available — say so rather than implying a
  pre-push review happened.

## Verification and response

- Run the smallest relevant checks after each fix. For application code, use the
  repository commands when applicable: `npm run typecheck`, `npm run lint`,
  `npm run test:meta`, `npm run test:rules`, `npm run test:api`, and/or
  `npm run build`.
- Do not claim a fix or a passing check unless it was actually run. State any
  check you could not run, why, and what would be needed to run it.
- Commit only the requested correction(s), with a clear message. Reply on the
  pull request with a concise list of changed files, resolved feedback, and
  verification results.

## Safety

- Never reveal secrets, write credential values to tracked files, weaken
  authorization or security rules merely to make a test pass, or change CI and
  deployment safeguards without explicit maintainer approval.
- Follow `AGENTS.md` as the shared repository contract.
