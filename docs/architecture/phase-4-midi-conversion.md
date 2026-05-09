# Phase 4 MIDI Conversion

Date: 2026-05-09

## Goal

Convert each labeled instrument stem to MIDI through a real provider adapter, then persist returned MIDI files as first-class Remuse artifacts with normalized instrument labels preserved in filenames and metadata.

## Implementation

The default local path still uses `MockMidiConversionProvider` so demos and tests remain deterministic. Spotify Basic Pitch is the first selected real MIDI provider, implemented at `src/providers/midi/basicPitchMidiConversionProvider.ts`.

Basic Pitch is a local Python/CLI provider, not a hosted API. This is a good fit for the current ReMuse artifact model because MVSEP stem artifacts are already downloaded to local `file://` paths before MIDI conversion.

Enable it with:

```bash
npm run demo:basic-pitch
```

The demo creates a local piano WAV stem, runs Basic Pitch through ReMuse, persists the MIDI artifact, and prints the local MIDI path.

Optional settings:

- `BASIC_PITCH_COMMAND`: path or command name for the Basic Pitch CLI. Defaults to `basic-pitch`.
- `BASIC_PITCH_MODEL_SERIALIZATION`: one of `tf`, `coreml`, `tflite`, or `onnx`. The alias `tensorflow` is accepted and mapped to `tf`.

When combined with MVSEP:

```bash
REMUSE_PROVIDER=mvsep \
MVSEP_API_TOKEN=<token> \
REMUSE_MIDI_PROVIDER=basic-pitch \
npm run server:mock
```

Basic Pitch requires local file-backed stem artifacts. It should be used with `REMUSE_PROVIDER=mvsep` in the job server, or with `npm run demo:basic-pitch` for a local MIDI-only smoke test. The pure mock upstream uses `mock://` artifacts and is intentionally rejected with `REMUSE_MIDI_PROVIDER=basic-pitch`.

The previous provider-neutral HTTP adapter remains available at `src/providers/midi/httpMidiConversionProvider.ts` for future cloud MIDI services.

## Basic Pitch Flow

For each labeled stem, ReMuse:

1. Resolves the local stem `file://` artifact path.
2. Creates an isolated Basic Pitch output directory.
3. Runs `basic-pitch --save-midi <output-directory> <stem-path>`.
4. Finds the generated `.mid` file.
5. Persists the MIDI bytes under the job's `midi` artifact stage using ReMuse's normalized MIDI filename.

ReMuse supplies job-local `TMPDIR` and `NUMBA_CACHE_DIR` values when spawning Basic Pitch. This avoids macOS temp-directory and Numba cache failures seen when invoking the CLI from sandboxed or non-interactive processes.

Basic Pitch works best on one instrument at a time, which matches ReMuse's stem-separated workflow. It is optimized for tonal pitched material, so drum and percussion stems are still converted but receive a warning metadata field.

Persisted Basic Pitch metadata includes:

- `provider`: `basic-pitch`.
- `providerCommand`: command used to invoke Basic Pitch.
- `providerOutputFilename`: generated Basic Pitch MIDI filename.
- `normalizedInstrument`: the ReMuse instrument label accepted from MVSEP or manual review.
- `sourceStem`: original stem filename.
- `basicPitchDownmixesToMono`: `true`.
- `basicPitchModelSampleRateHz`: `22050`.
- `basicPitchPitchBends`: `true`.

## HTTP Adapter

The HTTP adapter follows the normalized contract in `contracts/external-audio-services.openapi.yaml` for future cloud providers:

1. Build a `MidiConversionJobRequest` from ordered labeled stems.
2. Submit `POST /v1/midi-conversion/jobs` with `Authorization: Bearer <token>` and an `Idempotency-Key`.
3. Poll the returned `statusUrl` until `status=succeeded`, `failed`, or `canceled`.
4. Download each returned MIDI file.
5. Persist each file under the job's `midi` artifact stage.

## Configuration

Enable the HTTP MIDI adapter with:

```bash
REMUSE_MIDI_PROVIDER=http \
MIDI_CONVERSION_BASE_URL=https://midi-provider.example \
MIDI_CONVERSION_API_TOKEN=<token> \
npm run server:mock
```

Optional settings:

- `MIDI_CONVERSION_POLL_INTERVAL_MS`: defaults to `10000`.
- `MIDI_CONVERSION_MAX_POLL_ATTEMPTS`: defaults to `120`.
- `MIDI_CONVERSION_QUANTIZATION`: one of `none`, `nearest-1-960`, `nearest-1-480`, or `nearest-1-240`.
- `MIDI_CONVERSION_CALLBACK_URL`: optional callback URL passed through to the provider contract.

The MIDI provider can be combined with MVSEP audio processing:

```bash
REMUSE_PROVIDER=mvsep \
MVSEP_API_TOKEN=<token> \
REMUSE_MIDI_PROVIDER=http \
MIDI_CONVERSION_BASE_URL=https://midi-provider.example \
MIDI_CONVERSION_API_TOKEN=<token> \
npm run server:mock
```

## Label Preservation

ReMuse computes MIDI filenames with `makeMidiFilename(jobId, label, stemIndex)`, for example `job-7_03_guitar.mid`.

For each persisted MIDI artifact, metadata includes:

- `provider`: `http-midi-conversion`.
- `providerJobId`: external provider job ID.
- `providerArtifactId`, `providerFilename`, and `providerUrl`: external artifact references.
- `providerInstrument` and `providerInstrumentConfidence`: label returned by the MIDI provider.
- `normalizedInstrument`: the ReMuse instrument label accepted from MVSEP or manual review.
- `sourceStem`: original stem filename.
- `midiFormat` and `ticksPerQuarter`.

The artifact's `instrument` property is the normalized ReMuse label used for downstream OpenDAW sample-library selection.

## Current Boundary

Basic Pitch requires local file artifacts and therefore works with the current ReMuse artifact store. The normalized external HTTP contract expects provider-readable artifact URLs. ReMuse currently stores local runtime artifacts as `file://` URLs, which are suitable for local mocks, Basic Pitch, and contract tests but not readable by a remote cloud provider. A production external HTTP MIDI provider needs either signed HTTPS artifact URLs or a provider-specific upload flow before true remote end-to-end MIDI conversion.

## Tests

Coverage added in this phase:

- MIDI artifact persistence in `FileArtifactStore`.
- Basic Pitch command invocation, MIDI discovery, persistence, filename preservation, metadata preservation, and drum/percussion warning behavior.
- HTTP MIDI adapter request construction, polling, download, persistence, filename preservation, and metadata preservation.
- Provider factory wiring for `REMUSE_MIDI_PROVIDER=basic-pitch` and `REMUSE_MIDI_PROVIDER=http`.
