# Phase 1 Core Pipeline Skeleton

Phase 1 adds a job-based backend around the existing provider-adapter pipeline. The backend accepts canonical WAV uploads, persists input artifacts and job state to local disk, then runs the workflow through deterministic mock providers.

## Runtime Shape

- `POST /v1/jobs` accepts a raw WAV upload using `audio/wav`, `audio/x-wav`, or `application/octet-stream`.
- The upload is validated as PCM WAV at 44.1 kHz with 24-bit depth before a job record is created.
- Artifacts are stored under `var/remuse/artifacts/<job-id>/` by default.
- Job state is stored as JSON under `var/remuse/jobs/<job-id>.json` by default.
- The job runner updates status from `queued` to `running`, appends pipeline step events, and then marks the job `succeeded` or `failed`.
- The current runner uses mock providers for de-reverb, instrument stem separation, instrument identification, MIDI conversion, OpenDAW session creation/import, and final bounce.

## Local API

Start the backend:

```bash
npm run server:mock
```

Override runtime settings:

```bash
PORT=3100 REMUSE_DATA_DIR=/tmp/remuse npm run server:mock
```

Submit a job:

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "content-type: audio/wav" \
  -H "x-filename: source.wav" \
  --data-binary @source.wav
```

Check status:

```bash
curl http://localhost:3000/v1/jobs/<job-id>
```

Fetch the mock result:

```bash
curl http://localhost:3000/v1/jobs/<job-id>/result
```

## Handoff To Real Providers

The backend calls `runPipeline` with `PipelineProviders`, so replacing mocks is a provider construction concern rather than an API rewrite. A production adapter should preserve the same artifact IDs, filenames, audio format metadata, and step event semantics used by the mock runner.
