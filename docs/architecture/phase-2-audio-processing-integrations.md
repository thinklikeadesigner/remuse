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

- `MvsepDereverbProvider`: queues MVSEP `sep_type=22` with `add_opt1=0` for `Reverb removal by FoxJoy (MDX23C)` and `add_opt2=1` to use the full mix as-is, polls until completion, downloads the dry/no-reverb output, and persists it as a Remuse artifact.
- Local residual renderer: when MVSEP does not return a native reverb-only artifact, Remuse renders `reverbOnly` locally as `original - dryOnly` and persists the result as WAV PCM 16-bit, 44.1 kHz.
- `MvsepInstrumentStemSeparationProvider`: queues MVSEP `sep_type=63` for `BS Roformer SW (vocals, bass, drums, guitar, piano, other)`, sends no algorithm-specific `add_opt` fields, polls until completion, downloads returned stems, normalizes provider labels, and persists local stem artifacts. ReMuse expects the standard output set and rejects responses with more than seven stem artifacts because that usually indicates the wrong algorithm or non-standard output options.
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

Live MVSEP testing confirmed that the selected de-reverb model can return only dry/no-reverb audio. Remuse now handles that case by rendering `reverbOnly` locally as a residual artifact.
