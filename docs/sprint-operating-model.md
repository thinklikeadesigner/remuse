# Sprint Operating Model

This sprint is optimized for speed without letting the integration lane turn into guesswork.

## Cadence

- Every 30 minutes, each active agent posts status: shipped, blocked, next, risk.
- Every 90 minutes, the orchestrator forms an integration batch.
- Three hours before the sprint ends, the release-readiness reviewer starts demo freeze.

## Worktree Rules

- Each agent works only in its assigned worktree and branch.
- Agents pull or rebase from `main` at each integration checkpoint.
- Agents do not rewrite another agent's branch.
- Shared files require an explicit handoff note to `sprint-orchestrator`.

## Handoff Note

Every merge candidate needs:

- Summary of what changed.
- Paths touched.
- Commands run and results.
- Known risks or shortcuts.
- Screenshots or recordings for user-facing UI changes.
- Follow-up issues that should not block the demo.

## Review Rules

- `code-review` reviews correctness, missing tests, and merge risk.
- `architecture-review` reviews shared contracts and cross-lane design risk.
- `release-readiness-review` reviews demo viability, runbook accuracy, and rollback path.
- Reviewers should file findings by severity: P0, P1, P2, or P3.

## Merge Rules

- `main` receives only orchestrator-approved integration batches.
- Squash merges are preferred during the hackathon to keep history readable.
- After demo freeze starts, only P0/P1 fixes, runbook updates, and deployment rollback fixes can merge.

## Done Means

A feature is done when it works in the demo path, has enough test coverage for the risk it carries, has a handoff note, and has no open P0/P1 findings.
