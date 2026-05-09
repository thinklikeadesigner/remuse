# Remuse

Remuse is an audio-to-MIDI/OpenDAW application scaffold. The target workflow accepts a 16-bit, 44.1 kHz AIFF file, separates reverb and instrument stems through external providers, identifies instruments, converts stems to MIDI, builds an OpenDAW session, assigns sample libraries, and returns a stereo AIFF bounce.

The repo also contains high-intensity multi-agent sprint configuration. It is built around one orchestration agent, parallel development and testing agents, dedicated review agents, and a separate Git worktree for every agent.

## Layout

- `src/pipeline/` - shared TypeScript interfaces, naming helpers, and workflow runner.
- `src/providers/mock/` - deterministic mock providers for the full audio-to-MIDI/OpenDAW flow.
- `src/demo/runMockPipeline.ts` - smoke demo for the mock pipeline.
- `tests/unit/` - initial unit test scaffold.
- `config/audio-midi-sprint.yaml` - source of truth for the audio application agent roster.
- `contracts/external-audio-services.openapi.yaml` - normalized HTTP contract for external audio processing providers.
- `config/hackathon-sprint.yaml` - source of truth for agents, worktrees, branches, ownership, cadence, and merge policy.
- `docs/architecture/audio-midi-pipeline.md` - application architecture overview.
- `docs/architecture/opendaw-integration-spike.md` - Phase 0 OpenDAW SDK/API findings.
- `docs/architecture/phase-0-provider-contracts.md` - provider contract decisions and acceptance criteria.
- `docs/agents/audio-midi-agent-map.md` - branch and worktree map for the application agents.
- `docs/sprint-operating-model.md` - operating rules for the sprint.
- `scripts/create_audio_app_worktrees.sh` - creates or reuses all domain-specific application agent worktrees.
- `scripts/create_worktrees.sh` - recreates all agent worktrees from the config's branch plan.
- `scripts/status.sh` - prints the current worktree and branch inventory.

Agent worktrees live beside this repo at:

```text
../hackathon-agent-worktrees/<agent-id>
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the mock pipeline:

```bash
npm run demo:mock
```

Type-check and test:

```bash
npm run check
npm test
```

## Integration Spike

Phase 0 artifacts:

- [OpenDAW integration spike](docs/architecture/opendaw-integration-spike.md)
- [External provider contracts](docs/architecture/phase-0-provider-contracts.md)
- [OpenAPI contract](contracts/external-audio-services.openapi.yaml)

## Audio Application Agents

| Lane | Agent | Branch | Worktree |
| --- | --- | --- | --- |
| Orchestration | `master-orchestrator` | `agent/master-orchestrator` | `../hackathon-agent-worktrees/master-orchestrator` |
| Development | `workflow-engine-dev` | `agent/workflow-engine-dev` | `../hackathon-agent-worktrees/workflow-engine-dev` |
| Development | `api-backend-dev` | `agent/api-backend-dev` | `../hackathon-agent-worktrees/api-backend-dev` |
| Development | `audio-provider-dev` | `agent/audio-provider-dev` | `../hackathon-agent-worktrees/audio-provider-dev` |
| Development | `ai-instrument-dev` | `agent/ai-instrument-dev` | `../hackathon-agent-worktrees/ai-instrument-dev` |
| Development | `opendaw-integration-dev` | `agent/opendaw-integration-dev` | `../hackathon-agent-worktrees/opendaw-integration-dev` |
| Development | `frontend-dev` | `agent/frontend-dev` | `../hackathon-agent-worktrees/frontend-dev` |
| Testing | `unit-test-agent` | `agent/unit-test-agent` | `../hackathon-agent-worktrees/unit-test-agent` |
| Testing | `integration-test-agent` | `agent/integration-test-agent` | `../hackathon-agent-worktrees/integration-test-agent` |
| Testing | `audio-fixture-test-agent` | `agent/audio-fixture-test-agent` | `../hackathon-agent-worktrees/audio-fixture-test-agent` |
| Documentation | `docs-agent` | `agent/docs-agent` | `../hackathon-agent-worktrees/docs-agent` |
| Review | `architecture-review` | `agent/architecture-review` | `../hackathon-agent-worktrees/architecture-review` |
| Review | `security-privacy-review` | `agent/security-privacy-review` | `../hackathon-agent-worktrees/security-privacy-review` |
| Review | `code-review` | `agent/code-review` | `../hackathon-agent-worktrees/code-review` |
| Review | `release-readiness-review` | `agent/release-readiness-review` | `../hackathon-agent-worktrees/release-readiness-review` |

Create or refresh the audio app agent worktrees:

```bash
./scripts/create_audio_app_worktrees.sh
```

## Original Hackathon Agents

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
