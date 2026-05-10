# Demo Runbook

## Setup

```bash
npm install
npm run check
npm test
```

## Fast Local Demo

Start the local job server with deterministic mock providers:

```bash
npm run server:mock
```

Open:

```text
http://localhost:3000/
```

The landing page includes the collaborator-provided demo video from `src/demo/output/final_original_camera_nobeat_orch_clip_2.mp4`. The server serves files under `src/demo/output/` through `/output/<filename>` and supports MP4 byte ranges so browser playback and seeking work.

Drag a WAV PCM 16-bit or 24-bit, 44.1 kHz file onto the upload box. The page submits `POST /v1/jobs`, polls job status, shows progress, and plays the final bounce after success.

## Production-Style Local Test

MVSEP stem separation with Basic Pitch MIDI conversion:

```bash
REMUSE_PROVIDER=mvsep \
MVSEP_API_TOKEN=<token> \
REMUSE_MIDI_PROVIDER=basic-pitch \
npm run server:mock
```

LALAL.AI stem separation with Basic Pitch MIDI conversion:

```bash
REMUSE_STEM_PROVIDER=lalal \
LALAL_LICENSE_KEY=<license-key> \
REMUSE_MIDI_PROVIDER=basic-pitch \
npm run server:mock
```

Add FluidSynth for the final SoundFont-backed render:

```bash
REMUSE_OPENDAW_RENDERER=fluidsynth \
REMUSE_FLUIDSYNTH_SOUNDFONT=/absolute/path/to/general-midi.sf2 \
npm run server:mock
```

Enable per-track diagnostic WAV renders:

```bash
REMUSE_OPENDAW_RENDERER=fluidsynth \
REMUSE_FLUIDSYNTH_SOUNDFONT=/absolute/path/to/general-midi.sf2 \
REMUSE_FLUIDSYNTH_TRACK_DIAGNOSTICS=1 \
npm run server:mock
```

`REMUSE_FLUIDSYNTH_COMMAND` can point to a non-default `fluidsynth` binary if it is not on `PATH`.

## Provider Options

MVSEP:

- `REMUSE_PROVIDER=mvsep` sets both the legacy provider mode and the default stem provider to MVSEP.
- `REMUSE_STEM_PROVIDER=mvsep` can be used directly when `REMUSE_PROVIDER=mock`.
- `MVSEP_API_TOKEN` is required.
- `MVSEP_OUTPUT_FORMAT` must be `1`, MVSEP WAV 16-bit output.
- `MVSEP_POLL_INTERVAL_MS` defaults to `10000`.
- `MVSEP_MAX_POLL_ATTEMPTS` defaults to `120`.

LALAL.AI:

- `REMUSE_STEM_PROVIDER=lalal` enables LALAL.AI multistem separation.
- `LALAL_LICENSE_KEY` is required.
- `LALAL_STEM_LIST` defaults to `vocals,drum,piano,bass,electric_guitar,acoustic_guitar`.
- `LALAL_SPLITTER` defaults to `auto`. Leave it unset for the default stem list because LALAL.AI rejects `andromeda` when `piano` is included.
- `LALAL_EXTRACTION_LEVEL` defaults to `deep_extraction`.
- `LALAL_ENCODER_FORMAT` must be `wav`.
- `LALAL_DELETE_AFTER_DOWNLOAD=1` deletes LALAL.AI source files after local download.

MIDI:

- `REMUSE_MIDI_PROVIDER=mock` is the default.
- `REMUSE_MIDI_PROVIDER=basic-pitch` runs the local Basic Pitch CLI and requires file-backed stems from MVSEP or LALAL.AI.
- `REMUSE_MIDI_PROVIDER=http` enables the normalized HTTP MIDI provider.

Run the Basic Pitch smoke test without a server:

```bash
npm run demo:basic-pitch
```

Generic HTTP MIDI adapter:

```bash
REMUSE_MIDI_PROVIDER=http \
MIDI_CONVERSION_BASE_URL=https://midi-provider.example \
MIDI_CONVERSION_API_TOKEN=<token> \
npm run server:mock
```

## Manual Review Demo Path

ReMuse now surfaces every separated stem for review, not just ambiguous stems.

When the pipeline reaches Manual Review, the server opens `/review/<job-id>` in the OS default browser unless `REMUSE_AUTO_OPEN_REVIEW=0` is set. The page:

- Plays the full audio for each stem.
- Defaults clean provider labels where possible.
- Defaults generic `vocals` to `Lead Vocals`.
- Lets the user change any instrument assignment.
- Lets the user discard duplicate or useless stems.
- Enables `Complete Review` only when every stem is assigned or discarded.
- Asks for confirmation if every stem has been discarded.

Accepted stems are physically renamed in the artifact store to reflect the selected instrument before MIDI conversion. If all stems are discarded, the job status becomes `cancelled`.

## Terminal API Path

Submit a WAV file:

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "content-type: audio/wav" \
  -H "x-filename: source.wav" \
  --data-binary @source.wav
```

Poll the returned `statusUrl`:

```bash
curl http://localhost:3000/v1/jobs/<job-id>
```

Open Manual Review or progress:

```text
http://localhost:3000/review/<job-id>
```

Fetch the final bounce:

```bash
curl http://localhost:3000/v1/jobs/<job-id>/bounce --output remuse-bounce.wav
```

## Fallback Plan

If the HTTP server cannot bind a local port in the demo environment, run `npm run demo:mock` and show the integration test path in `tests/integration/jobServer.test.ts`, which exercises the same pipeline without opening a socket.

## Known Limitations

- De-reverb is currently bypassed in the main workflow; the MVSEP de-reverb adapter remains available for a future reactivation.
- Basic Pitch is strongest on tonal pitched stems. Drum and percussion MIDI remain approximate.
- The local OpenDAW provider persists a reproducible session plan. Actual audio rendering is either deterministic preview synthesis or FluidSynth over a single configured General MIDI `.sf2`.
- A remote MIDI provider needs provider-readable artifact URLs or a provider-specific upload flow. Current runtime artifacts are local `file://` URLs.
- Runtime artifacts are local files under `var/remuse/` by default.
