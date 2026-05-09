# Hackathon Sprint Orchestration

This repository contains a high-intensity multi-agent development sprint configuration. It is built around one orchestration agent, parallel development and testing agents, dedicated review agents, and a separate Git worktree for every agent.

## Layout

- `config/hackathon-sprint.yaml` - source of truth for agents, worktrees, branches, ownership, cadence, and merge policy.
- `docs/sprint-operating-model.md` - operating rules for the sprint.
- `scripts/create_worktrees.sh` - recreates all agent worktrees from the config's branch plan.
- `scripts/status.sh` - prints the current worktree and branch inventory.

Agent worktrees live beside this repo at:

```text
../hackathon-agent-worktrees/<agent-id>
```

## Agents

| Lane | Agent | Branch | Worktree |
| --- | --- | --- | --- |
| Orchestration | `sprint-orchestrator` | `agent/sprint-orchestrator` | `../hackathon-agent-worktrees/sprint-orchestrator` |
| Development | `frontend-dev` | `agent/frontend-dev` | `../hackathon-agent-worktrees/frontend-dev` |
| Development | `backend-api-dev` | `agent/backend-api-dev` | `../hackathon-agent-worktrees/backend-api-dev` |
| Development | `ai-workflows-dev` | `agent/ai-workflows-dev` | `../hackathon-agent-worktrees/ai-workflows-dev` |
| Development | `platform-infra-dev` | `agent/platform-infra-dev` | `../hackathon-agent-worktrees/platform-infra-dev` |
| Testing | `qa-automation` | `agent/qa-automation` | `../hackathon-agent-worktrees/qa-automation` |
| Testing | `e2e-performance-test` | `agent/e2e-performance-test` | `../hackathon-agent-worktrees/e2e-performance-test` |
| Testing | `security-regression-test` | `agent/security-regression-test` | `../hackathon-agent-worktrees/security-regression-test` |
| Review | `architecture-review` | `agent/architecture-review` | `../hackathon-agent-worktrees/architecture-review` |
| Review | `code-review` | `agent/code-review` | `../hackathon-agent-worktrees/code-review` |
| Review | `release-readiness-review` | `agent/release-readiness-review` | `../hackathon-agent-worktrees/release-readiness-review` |

## Quick Commands

Create or refresh the agent worktrees:

```bash
./scripts/create_worktrees.sh
```

Show current worktree state:

```bash
./scripts/status.sh
```

List worktrees directly:

```bash
git worktree list
```

## Merge Rhythm

Agents work on their own `agent/<id>` branches. The `sprint-orchestrator` coordinates handoffs and opens integration batches into `main`. Review agents inspect those batches before anything is merged into `main` or the final `release/demo` branch.
