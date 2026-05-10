# ReMuse
<img width="1492" height="752" alt="image" src="https://github.com/user-attachments/assets/8e950583-447e-4028-bdf9-02c3a996078b" />

## The Core Idea

Old recordings don’t just lose sound. They lose presence.

Distortion, hiss, compression, and damaged source material can make archival audio feel distant, even when the performance underneath is still alive. We built an agentic restoration pipeline that helps bring those recordings back into focus.

Our system takes degraded audio, analyzes what needs to be repaired, separates musical components, applies restoration steps, and reconstructs a cleaner master track. In our demo, a noisy, distorted orchestral recording transforms into a clean Vivaldi performance while the visuals move from grainy black-and-white footage into a restored cinematic scene.

The goal is not just cleaner audio. It is cultural preservation at scale: helping old performances, oral histories, family recordings, and archival media become listenable again without requiring hours of manual engineering.

## Partner Technology
We used Codex and AutoHDR's provided Fal API key

## Engineering

ReMuse is a local TypeScript application for turning an uploaded WAV file into a MIDI-driven stereo remix. It accepts WAV PCM 16-bit or 24-bit, 44.1 kHz input, separates stems through a provider adapter, asks the user to review every returned stem, converts accepted stems to MIDI, assembles an OpenDAW-style session plan, maps instruments to SoundFont sample libraries, and returns a WAV PCM 16-bit, 44.1 kHz stereo bounce.

<img width="1246" height="492" alt="image" src="https://github.com/user-attachments/assets/afab7212-7a04-474c-9794-76fd2c4097cc" />

<br>

The current production-test path is:

```text
landing page WAV upload
-> validate WAV format
-> de-reverb step skipped
-> stem separation from original uploaded WAV
-> provider label normalization
-> manual review of every stem
-> MIDI conversion
-> ReMuse/OpenDAW-style session assembly
-> sample-library mapping
-> preview or FluidSynth stereo WAV bounce
```

The repo also contains the original high-intensity multi-agent sprint configuration: one orchestration agent, parallel development and testing agents, dedicated review agents, and individual git worktrees for each agent.




## Current Capabilities

- Landing page at `/` with a demo video, WAV drag-and-drop upload, job progress, diagnostic track playback, and final bounce playback.
- Static demo assets served from `src/demo/output/` through `/output/<filename>`, including MP4 byte-range support for browser playback.
- File-backed job backend with `queued`, `running`, `awaiting-review`, `succeeded`, `failed`, and `cancelled` statuses.
- Manual Review page that opens when review begins, plays the full audio for every separated stem, lets the user assign an instrument or discard each stem, and resumes only after `Complete Review`.
- All-discard protection: if every stem is discarded, the browser asks for confirmation and the backend records the job as `cancelled`.
- Stem separation providers:
  - Mock provider for deterministic local tests.
  - MVSEP BS Roformer SW.
  - LALAL.AI multistem split.
- MIDI providers:
  - Mock MIDI provider.
  - Spotify Basic Pitch local CLI.
  - Provider-neutral HTTP adapter for future cloud MIDI services.
- OpenDAW/session providers:
  - Mock provider.
  - Local session provider that writes a reproducible `.opendaw.json` plan.
  - Preview renderer.
  - Optional FluidSynth renderer for a functioning SoundFont-backed WAV bounce.

## Layout

- `src/demo/demo.html` - landing page, upload UI, progress panel, diagnostic track playback, and demo video.
- `src/pipeline/` - shared TypeScript interfaces, naming helpers, and workflow runner.
- `src/server/` - job API, review UI, result routes, and demo asset serving.
- `src/jobs/` - file-backed job records and the pipeline job runner.
- `src/storage/` - file-backed artifact storage.
- `src/audio/` - WAV parsing, review audio, residual rendering, and preview bounce helpers.
- `src/providers/mock/` - deterministic providers for local tests.
- `src/providers/mvsep/` - MVSEP de-reverb adapter and active BS Roformer SW stem adapter.
- `src/providers/lalal/` - LALAL.AI upload, multistem split, polling, and download adapter.
- `src/providers/midi/` - Basic Pitch and HTTP MIDI conversion adapters.
- `src/providers/opendaw/` - local session assembly, sample-library mapping, preview render, and FluidSynth render support.
- `contracts/external-audio-services.openapi.yaml` - normalized external audio provider contract.
- `docs/` - architecture notes, decision log, demo runbook, and sprint docs.
- `config/audio-midi-sprint.yaml` - source of truth for the audio application agent roster.
- `config/hackathon-sprint.yaml` - original generic hackathon agent roster.
- `scripts/create_audio_app_worktrees.sh` - creates or reuses application agent worktrees.
- `scripts/create_worktrees.sh` - recreates the original scaffold worktrees.
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

Type-check and test:

```bash
npm run check
npm test
```

Run the mock pipeline without the HTTP server:

```bash
npm run demo:mock
```

Run the local job server:

```bash
npm run server:mock
```

Open the landing page at:

```text
http://localhost:3000/
```

Runtime artifacts are stored under `var/remuse/` by default. Override this with `REMUSE_DATA_DIR`.

## Server Configuration

Useful server environment variables:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server port. |
| `REMUSE_DATA_DIR` | `var/remuse` | Job records and artifacts root. |
| `REMUSE_PUBLIC_BASE_URL` | `http://localhost:<PORT>` | Browser URL used for auto-open review tabs. |
| `REMUSE_AUTO_OPEN_REVIEW` | enabled | Set `0` to stop opening the Manual Review tab automatically. |

The server opens `/review/<job-id>` only when the job reaches Manual Review. It no longer opens a progress tab immediately on upload.

## Provider Modes

Mock mode is the default and requires no secrets:

```bash
npm run server:mock
```

Use MVSEP for stem separation:

```bash
REMUSE_PROVIDER=mvsep \
MVSEP_API_TOKEN=<token> \
npm run server:mock
```

Use LALAL.AI for stem separation:

```bash
REMUSE_STEM_PROVIDER=lalal \
LALAL_LICENSE_KEY=<license-key> \
npm run server:mock
```

Use Basic Pitch for MIDI conversion with file-backed stems:

```bash
REMUSE_PROVIDER=mvsep \
MVSEP_API_TOKEN=<token> \
REMUSE_MIDI_PROVIDER=basic-pitch \
npm run server:mock
```

or:

```bash
REMUSE_STEM_PROVIDER=lalal \
LALAL_LICENSE_KEY=<license-key> \
REMUSE_MIDI_PROVIDER=basic-pitch \
npm run server:mock
```

Run the Basic Pitch smoke test:

```bash
npm run demo:basic-pitch
```

Use FluidSynth for the final bounce:

```bash
REMUSE_OPENDAW_RENDERER=fluidsynth \
REMUSE_FLUIDSYNTH_SOUNDFONT=/absolute/path/to/general-midi.sf2 \
npm run server:mock
```

Optional FluidSynth settings:

- `REMUSE_FLUIDSYNTH_COMMAND`: path/name of the `fluidsynth` executable.
- `REMUSE_FLUIDSYNTH_TIMEOUT_MS`: render timeout, default five minutes.
- `REMUSE_FLUIDSYNTH_TRACK_DIAGNOSTICS`: set `1` to render one WAV diagnostic bounce per MIDI track.

## HTTP API

Submit a WAV file:

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "content-type: audio/wav" \
  -H "x-filename: source.wav" \
  --data-binary @source.wav
```

Poll job status:

```bash
curl http://localhost:3000/v1/jobs/<job-id>
```

Open job progress or Manual Review:

```text
http://localhost:3000/review/<job-id>
```

Fetch result JSON after success:

```bash
curl http://localhost:3000/v1/jobs/<job-id>/result
```

Fetch final bounce after success:

```bash
curl http://localhost:3000/v1/jobs/<job-id>/bounce --output remuse-bounce.wav
```

## Manual Review

Every separated stem is surfaced to the user before MIDI conversion. The provider label is used as the default when it maps cleanly into ReMuse's instrument taxonomy; generic `vocals` defaults to `Lead Vocals`. The user can change any assignment before completing review.

Manual choices:

- Lead Vocals
- Backing Vocals
- Drums
- Bass
- Guitar
- Piano
- Brass
- Woodwinds
- Strings
- Percussion
- Organ
- Synthesizer

The Manual Review page streams the full stem audio for each review card. The `Complete Review` button stays disabled until every stem has an instrument assignment or has been discarded. Accepted stems are physically renamed in the artifact store with the selected instrument, and discarded stems are removed from the active MIDI workflow. If all stems are discarded, ReMuse records the job as `cancelled`.

## Architecture Docs

- [Audio-to-MIDI pipeline](docs/architecture/audio-midi-pipeline.md)
- [Phase 0 provider contracts](docs/architecture/phase-0-provider-contracts.md)
- [OpenDAW integration spike](docs/architecture/opendaw-integration-spike.md)
- [Phase 1 core pipeline](docs/architecture/phase-1-core-pipeline.md)
- [Provider selection](docs/architecture/provider-selection.md)
- [Phase 2 audio processing integrations](docs/architecture/phase-2-audio-processing-integrations.md)
- [Phase 3 instrument label normalization](docs/architecture/phase-3-instrument-label-normalization.md)
- [Phase 4 MIDI conversion](docs/architecture/phase-4-midi-conversion.md)
- [Phase 5 OpenDAW session assembly](docs/architecture/phase-5-opendaw-session-assembly.md)
- [Demo runbook](docs/demo-runbook.md)
- [Decision log](docs/decision-log.md)

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

Show current worktree state:

```bash
./scripts/status.sh
```

List worktrees directly:

```bash
git worktree list
```
