# Phase 2 Audio Processing Integrations

Phase 2 adds the first real audio-processing provider lane while preserving the mock lane for local development and tests.

## Provider Mode

The backend defaults to deterministic mocks:

```bash
npm run server:mock
```

Use MVSEP for de-reverb and instrument-stem separation:

```bash
REMUSE_PROVIDER=mvsep MVSEP_API_TOKEN=<token> npm run server:mock
```

Optional MVSEP settings:

- `MVSEP_BASE_URL`: defaults to `https://mvsep.com`.
- `MVSEP_OUTPUT_FORMAT`: must be `1`, MVSEP WAV 16-bit output.
- `MVSEP_POLL_INTERVAL_MS`: defaults to `10000`.
- `MVSEP_MAX_POLL_ATTEMPTS`: defaults to `120`.

## Implemented Adapters

- `MvsepDereverbProvider`: queues MVSEP `sep_type=22` with `add_opt1=7`, `add_opt2=1`, polls until completion, downloads dry/reverb outputs, and persists them as Remuse artifacts.
- `MvsepInstrumentStemSeparationProvider`: queues MVSEP `sep_type=63`, polls until completion, downloads returned stems, normalizes provider labels, and persists local stem artifacts.
- `ProviderNativeInstrumentIdentificationProvider`: preserves provider-native stem labels for downstream MIDI naming and sample-library choice.

## Artifact Persistence

Provider outputs are downloaded into the local artifact store under:

```text
var/remuse/artifacts/<job-id>/dereverb/
var/remuse/artifacts/<job-id>/instrument-stems/
```

Each persisted artifact records:

- Provider name and provider job hash.
- Provider filename, label, and source URL.
- SHA-256, byte length, data bytes, and parsed WAV metadata.
- Source artifact IDs for lineage.

## Current Constraints

MVSEP WAV 16-bit output is the intended working format for this application, so no local 24-bit transcoding step is required.

MVSEP's de-reverb API must be live-tested to confirm whether it returns a separate reverb-only artifact. If it returns only dry/no-reverb audio, Remuse still needs a residual-rendering implementation for `reverbOnly`.
