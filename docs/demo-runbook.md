# Demo Runbook

## Setup

```bash
npm install
npm run check
npm test
```

## Demo Path

Run the deterministic mock pipeline without the HTTP layer:

```bash
npm run demo:mock
```

Run the Phase 1 mock job backend:

```bash
npm run server:mock
```

Run the Phase 2 MVSEP-backed job backend:

```bash
REMUSE_PROVIDER=mvsep MVSEP_API_TOKEN=<token> npm run server:mock
```

Run with the Phase 4 Basic Pitch MIDI provider:

```bash
npm run demo:basic-pitch
```

This creates a local WAV stem fixture, runs the ReMuse Basic Pitch provider, and prints the resulting `.mid` artifact path.

Combine MVSEP audio processing with local Basic Pitch MIDI conversion:

```bash
REMUSE_PROVIDER=mvsep \
MVSEP_API_TOKEN=<token> \
REMUSE_MIDI_PROVIDER=basic-pitch \
npm run server:mock
```

Run with the generic Phase 4 HTTP MIDI conversion adapter:

```bash
REMUSE_MIDI_PROVIDER=http \
MIDI_CONVERSION_BASE_URL=https://midi-provider.example \
MIDI_CONVERSION_API_TOKEN=<token> \
npm run server:mock
```

Combine MVSEP audio processing with HTTP MIDI conversion:

```bash
REMUSE_PROVIDER=mvsep \
MVSEP_API_TOKEN=<token> \
REMUSE_MIDI_PROVIDER=http \
MIDI_CONVERSION_BASE_URL=https://midi-provider.example \
MIDI_CONVERSION_API_TOKEN=<token> \
npm run server:mock
```

Submit a WAV PCM 16-bit or 24-bit, 44.1 kHz file:

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "content-type: audio/wav" \
  -H "x-filename: source.wav" \
  --data-binary @source.wav
```

Poll the returned `statusUrl` until `status` is `succeeded`, then fetch the returned `resultUrl`.

The returned `reviewUrl` also works as a lightweight browser status page while a job is queued or running. The local server opens that page through the OS default browser as soon as the job is submitted unless `REMUSE_AUTO_OPEN_REVIEW=0` is set. Use `REMUSE_PUBLIC_BASE_URL=http://localhost:<port>` when running behind a different host or port.

## Fallback Plan

If the HTTP server cannot bind a local port in the demo environment, run `npm run demo:mock` and show the integration test path in `tests/integration/jobServer.test.ts`, which exercises the same job API without opening a socket.

## Known Limitations

- Mock providers remain the default local path.
- MVSEP can be enabled for de-reverb and stem separation, and Basic Pitch can be enabled for local MIDI conversion.
- Basic Pitch requires local file-backed stems; use `npm run demo:basic-pitch` for a MIDI-only smoke test or combine `REMUSE_MIDI_PROVIDER=basic-pitch` with `REMUSE_PROVIDER=mvsep` in the job server.
- Basic Pitch is best for tonal pitched stems; drum and percussion MIDI should be treated as approximate until a drum-specific MIDI provider is added.
- A remote MIDI provider needs provider-readable artifact URLs or a provider-specific upload flow; current local runtime artifacts are stored as `file://` URLs.
- Runtime artifacts are local files under `var/remuse/` by default.
- Final bounce output is represented as an artifact record until real OpenDAW export is connected.
