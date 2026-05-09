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

Submit a WAV PCM 16-bit or 24-bit, 44.1 kHz file:

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "content-type: audio/wav" \
  -H "x-filename: source.wav" \
  --data-binary @source.wav
```

Poll the returned `statusUrl` until `status` is `succeeded`, then fetch the returned `resultUrl`.

## Fallback Plan

If the HTTP server cannot bind a local port in the demo environment, run `npm run demo:mock` and show the integration test path in `tests/integration/jobServer.test.ts`, which exercises the same job API without opening a socket.

## Known Limitations

- De-reverb, stem separation, label normalization, MIDI conversion, and OpenDAW are still deterministic mock providers.
- Runtime artifacts are local files under `var/remuse/` by default.
- Final bounce output is represented as an artifact record until real OpenDAW export is connected.
