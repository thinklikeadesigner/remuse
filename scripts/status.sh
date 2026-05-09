#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Repository: $ROOT"
echo
git -C "$ROOT" status --short --branch
echo
git -C "$ROOT" worktree list
