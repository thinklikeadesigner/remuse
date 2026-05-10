# Audio-to-MIDI ReMuse Pipeline Architecture

ReMuse converts WAV PCM 16-bit or 24-bit, 44.1 kHz input into a new WAV PCM 16-bit, 44.1 kHz stereo bounce generated from reviewed stem-to-MIDI tracks.

## Current Workflow

```text
input WAV PCM 16-bit or 24-bit / 44.1 kHz
-> validate format
-> skip de-reverb
-> send original input to stem separation
-> normalize provider stem labels
-> manual review of every returned stem
-> convert accepted stems to MIDI
-> create a ReMuse/OpenDAW-style session artifact
-> map instruments to SoundFont sample libraries
-> render a stereo WAV PCM 16-bit / 44.1 kHz bounce
```

The de-reverb adapter still exists, but the main workflow bypasses it while stem-separation quality is being evaluated on the original user upload.

## Runtime Surfaces

- Landing page: `GET /`.
- Demo assets: `GET /output/<filename>`, with MP4 byte-range support.
- Job upload: `POST /v1/jobs`.
- Job status: `GET /v1/jobs/<job-id>`.
- Review/status page: `GET /review/<job-id>`.
- Review audio: `GET /v1/jobs/<job-id>/review-requests/<review-id>/clip`.
- Result JSON: `GET /v1/jobs/<job-id>/result`.
- Final bounce: `GET /v1/jobs/<job-id>/bounce`.
- Diagnostic track bounces: `GET /v1/jobs/<job-id>/diagnostic-track-bounces`.

## Core Boundaries

- `src/pipeline/types.ts` contains shared artifact, provider, job, review, MIDI, and session contracts.
- `src/pipeline/workflow.ts` runs the sequential workflow and raises the Manual Review pause.
- `src/pipeline/naming.ts` normalizes provider labels, manual review options, MIDI filenames, and sample-library keys.
- `src/server/http.ts` exposes the job API, review UI, result routes, and demo asset route.
- `src/jobs/**` persists job state and runs or resumes the pipeline.
- `src/storage/**` persists validated input, stem, MIDI, session, review, diagnostic, and bounce artifacts.
- `src/audio/**` handles WAV parsing, review audio generation, residual rendering, and deterministic preview bounce synthesis.
- `src/providers/mock/**` implements deterministic local providers.
- `src/providers/mvsep/**` implements MVSEP de-reverb and active MVSEP BS Roformer SW stem separation.
- `src/providers/lalal/**` implements LALAL.AI multistem separation.
- `src/providers/midi/**` implements Basic Pitch and HTTP MIDI conversion.
- `src/providers/opendaw/**` implements local session assembly, sample-library mapping, preview rendering, and FluidSynth rendering.

## Provider Interfaces

- `DereverbProvider`: input WAV to dry-only and optional reverb-only tracks when de-reverb is active.
- `InstrumentStemSeparationProvider`: source WAV to individual instrument stems. Currently the source is the original uploaded input.
- `InstrumentIdentificationProvider`: provider-native labels and filenames to normalized labels. It no longer runs a separate AI classifier.
- `MidiConversionProvider`: reviewed labeled stems to MIDI files with instrument names preserved.
- `OpenDawProvider`: session creation, MIDI import, sample-library assignment, and stereo bounce.

## Manual Review Boundary

Manual Review is now a required gate for every separated stem. ReMuse creates review requests for all returned stems, streams the full stem audio in the browser, and waits for the user to assign or discard every stem. The pipeline resumes only after `Complete Review`.

Accepted stems are physically renamed in the artifact store with the manually selected instrument. Discarded stems remain on disk for traceability but are removed from the active MIDI workflow. If the user discards every stem, the job becomes `cancelled`.

## Rendering Boundary

`LocalOpenDawSessionProvider` is the active provider. It writes a reproducible `.opendaw.json` session plan and then renders through either:

- `preview`: deterministic local synthesis, useful for tests and offline demos.
- `fluidsynth`: a functioning SoundFont-backed render path using a configured General MIDI `.sf2`.

The browser OpenDAW proof harness remains useful research, but the application path does not currently depend on a real headless OpenDAW engine render.

## Related Docs

- Phase 0 provider contract: `docs/architecture/phase-0-provider-contracts.md`.
- Phase 3 instrument labeling: `docs/architecture/phase-3-instrument-label-normalization.md`.
- Phase 4 MIDI conversion: `docs/architecture/phase-4-midi-conversion.md`.
- Phase 5 session assembly: `docs/architecture/phase-5-opendaw-session-assembly.md`.
