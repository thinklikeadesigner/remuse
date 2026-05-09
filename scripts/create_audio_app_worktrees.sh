#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_ROOT="$(cd "$ROOT/.." && pwd)/hackathon-agent-worktrees"

mkdir -p "$WORKTREE_ROOT"

agents=(
  "master-orchestrator"
  "workflow-engine-dev"
  "api-backend-dev"
  "audio-provider-dev"
  "ai-instrument-dev"
  "opendaw-integration-dev"
  "frontend-dev"
  "unit-test-agent"
  "integration-test-agent"
  "audio-fixture-test-agent"
  "docs-agent"
  "architecture-review"
  "security-privacy-review"
  "code-review"
  "release-readiness-review"
)

for agent_id in "${agents[@]}"; do
  branch="agent/$agent_id"
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
