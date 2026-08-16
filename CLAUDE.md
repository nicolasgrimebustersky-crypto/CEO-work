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
