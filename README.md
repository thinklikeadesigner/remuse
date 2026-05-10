# Remuse

Remuse is an audio-to-MIDI/OpenDAW application scaffold. The target workflow accepts WAV PCM 16-bit or 24-bit, 44.1 kHz audio, separates reverb and instrument stems through external providers, accepts provider-native instrument labels, pauses for human review of non-specific stems, converts labeled stems to MIDI, builds an OpenDAW session, assigns sample libraries, and returns a stereo WAV PCM 16-bit, 44.1 kHz bounce.

The repo also contains high-intensity multi-agent sprint configuration. It is built around one orchestration agent, parallel development and testing agents, dedicated review agents, and a separate Git worktree for every agent.

## Layout

- `src/pipeline/` - shared TypeScript interfaces, naming helpers, and workflow runner.
- `src/server/` - mock-backed job API for WAV uploads, job state, and pipeline results.
- `src/jobs/` - file-backed job records and the pipeline job runner.
- `src/storage/` - file-backed artifact storage.
- `src/providers/mock/` - deterministic mock providers for the full audio-to-MIDI/OpenDAW flow.
- `src/providers/midi/` - Basic Pitch and provider-neutral HTTP MIDI conversion adapters.
- `src/providers/opendaw/` - file-backed OpenDAW session assembly, sample-library mapping, and preview bounce adapter.
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

Run the mock job backend:

```bash
npm run server:mock
```

Run with local Spotify Basic Pitch MIDI conversion:

```bash
npm run demo:basic-pitch
```

For full job-server testing, combine Basic Pitch with file-backed upstream stems, currently MVSEP:

```bash
REMUSE_PROVIDER=mvsep MVSEP_API_TOKEN=<token> REMUSE_MIDI_PROVIDER=basic-pitch npm run server:mock
```

The job server uses `REMUSE_OPENDAW_PROVIDER=local-session` by default. This writes a reproducible `.opendaw.json` session artifact, maps every MIDI track to a sample-library assignment, and renders a valid stereo WAV PCM 16-bit, 44.1 kHz preview bounce. Set `REMUSE_OPENDAW_PROVIDER=mock` to return to the older in-memory mock OpenDAW path.

Use FluidSynth as the functioning MIDI render backend by installing `fluidsynth`, downloading a General MIDI `.sf2` SoundFont, and starting the server with:

```bash
REMUSE_OPENDAW_RENDERER=fluidsynth \
REMUSE_FLUIDSYNTH_SOUNDFONT=/absolute/path/to/soundfont.sf2 \
npm run server:mock
```

Optionally set `REMUSE_FLUIDSYNTH_COMMAND=/path/to/fluidsynth` if the binary is not on `PATH`.

Run the headless browser OpenDAW proof harness:

```bash
npm run opendaw:browser-spike -- --browser-executable "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

The harness creates a real OpenDAW project, creates soundfont-backed MIDI tracks, imports MIDI notes, applies sample-library presets, serializes the native OpenDAW project, and writes a 16-bit/44.1 kHz stereo WAV proof bounce under `var/opendaw-browser-spike/<timestamp>/session/`.

The backend stores local runtime artifacts under `var/remuse/` by default. Submit a WAV PCM 16-bit or 24-bit, 44.1 kHz file with `POST /v1/jobs`, then poll `GET /v1/jobs/<job-id>` and fetch the completed result with `GET /v1/jobs/<job-id>/result`. The `GET /review/<job-id>` page shows live job progress while the pipeline is active. The local server opens that page in the OS default browser as soon as a job is submitted, so you can watch progress from the beginning and then play review clips, label useful stems, or discard unusable/duplicate stems if manual review is needed. Set `REMUSE_AUTO_OPEN_REVIEW=0` to disable auto-open, or set `REMUSE_PUBLIC_BASE_URL` if the browser should use a non-default host/port.

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
- [Phase 1 core pipeline skeleton](docs/architecture/phase-1-core-pipeline.md)
- [Provider selection](docs/architecture/provider-selection.md)
- [Phase 2 audio processing integrations](docs/architecture/phase-2-audio-processing-integrations.md)
- [Phase 3 instrument label normalization](docs/architecture/phase-3-instrument-label-normalization.md)
- [Phase 4 MIDI conversion](docs/architecture/phase-4-midi-conversion.md)
- [Phase 5 OpenDAW session assembly](docs/architecture/phase-5-opendaw-session-assembly.md)

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
