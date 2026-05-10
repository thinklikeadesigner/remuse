# Phase 2 Audio Processing Integrations

Phase 2 adds the first real audio-processing provider lane while preserving the mock lane for local development and tests.

## Provider Mode

The backend defaults to deterministic mocks:

```bash
npm run server:mock
```

Use MVSEP for instrument-stem separation:

```bash
REMUSE_PROVIDER=mvsep MVSEP_API_TOKEN=<token> npm run server:mock
```

Use LALAL.AI as the stem-separation provider:

```bash
REMUSE_STEM_PROVIDER=lalal LALAL_LICENSE_KEY=<license-key> npm run server:mock
```

Optional MVSEP settings:

- `MVSEP_BASE_URL`: defaults to `https://mvsep.com`.
- `MVSEP_OUTPUT_FORMAT`: must be `1`, MVSEP WAV 16-bit output.
- `MVSEP_POLL_INTERVAL_MS`: defaults to `10000`.
- `MVSEP_MAX_POLL_ATTEMPTS`: defaults to `120`.

Optional LALAL.AI settings:

- `LALAL_BASE_URL`: defaults to `https://www.lalal.ai/api/v1`.
- `LALAL_STEM_LIST`: defaults to `vocals,drum,piano,bass,electric_guitar,acoustic_guitar`.
- `LALAL_SPLITTER`: defaults to `auto`. Leave this unset for the default multistem set because LALAL.AI currently rejects `andromeda` when `piano` is included.
- `LALAL_EXTRACTION_LEVEL`: defaults to `deep_extraction`.
- `LALAL_ENCODER_FORMAT`: must be `wav`.
- `LALAL_POLL_INTERVAL_MS`: defaults to `5000`, safely below the documented `/check/` rate limit.
- `LALAL_MAX_POLL_ATTEMPTS`: defaults to `120`.
- `LALAL_DELETE_AFTER_DOWNLOAD`: defaults to `false`; set `1` to delete LALAL.AI source files after successful local download.

## Implemented Adapters

- `MvsepDereverbProvider`: queues MVSEP `sep_type=22` with `add_opt1=0` for `Reverb removal by FoxJoy (MDX23C)` and `add_opt2=1` to use the full mix as-is, polls until completion, downloads the dry/no-reverb output, and persists it as a ReMuse artifact. This adapter is implemented but currently bypassed by the main workflow.
- Local residual renderer: when MVSEP does not return a native reverb-only artifact, Remuse renders `reverbOnly` locally as `original - dryOnly` and persists the result as WAV PCM 16-bit, 44.1 kHz.
- `MvsepInstrumentStemSeparationProvider`: queues MVSEP `sep_type=63` for `BS Roformer SW (vocals, bass, drums, guitar, piano, other)`, sends no algorithm-specific `add_opt` fields, polls until completion, downloads returned stems, normalizes provider labels, and persists local stem artifacts. ReMuse expects the standard output set and rejects responses with more than seven stem artifacts because that usually indicates the wrong algorithm or non-standard output options.
- `LalalInstrumentStemSeparationProvider`: uploads the original source to LALAL.AI, queues `/api/v1/split/multistem/`, polls `/api/v1/check/`, downloads each returned WAV track, normalizes provider labels, and persists local stem artifacts. ReMuse expects the documented six selected stems plus the `no_multistem` remainder track, so responses with more than seven files are rejected.
- `ProviderNativeInstrumentIdentificationProvider`: preserves provider-native stem labels for downstream defaults. Manual Review still surfaces every stem before MIDI conversion.

## Artifact Persistence

Provider outputs are downloaded into the local artifact store under:

```text
var/remuse/artifacts/<job-id>/instrument-stems/
```

`dereverb/` artifacts are created only if the de-reverb step is re-enabled.

Each persisted artifact records:

- Provider name and provider job hash.
- Provider filename, label, and source URL.
- SHA-256, byte length, data bytes, and parsed WAV metadata.
- Source artifact IDs for lineage.

## Current Constraints

MVSEP WAV 16-bit output is the intended working format for this application, so no local 24-bit transcoding step is required.

Live MVSEP testing confirmed that the selected de-reverb model can return only dry/no-reverb audio. If the de-reverb step is re-enabled, ReMuse handles that case by rendering `reverbOnly` locally as a residual artifact.
