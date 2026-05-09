#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_ROOT="$(cd "$ROOT/.." && pwd)/hackathon-agent-worktrees"

mkdir -p "$WORKTREE_ROOT"

agents=(
  "sprint-orchestrator:agent/sprint-orchestrator"
  "frontend-dev:agent/frontend-dev"
  "backend-api-dev:agent/backend-api-dev"
  "ai-workflows-dev:agent/ai-workflows-dev"
  "platform-infra-dev:agent/platform-infra-dev"
  "qa-automation:agent/qa-automation"
  "e2e-performance-test:agent/e2e-performance-test"
  "security-regression-test:agent/security-regression-test"
  "architecture-review:agent/architecture-review"
  "code-review:agent/code-review"
  "release-readiness-review:agent/release-readiness-review"
)

for spec in "${agents[@]}"; do
  agent_id="${spec%%:*}"
  branch="${spec#*:}"
  path="$WORKTREE_ROOT/$agent_id"

  if git -C "$ROOT" worktree list --porcelain | grep -Fxq "worktree $path"; then
    echo "exists: $agent_id -> $path"
    continue
  fi

  if [[ -e "$path" && -n "$(ls -A "$path" 2>/dev/null)" ]]; then
    echo "skip: $path already exists and is not empty"
    continue
  fi

  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$ROOT" worktree add "$path" "$branch"
  else
    git -C "$ROOT" worktree add -b "$branch" "$path" main
  fi

  echo "created: $agent_id -> $path ($branch)"
done

git -C "$ROOT" worktree list
