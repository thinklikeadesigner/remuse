# Audio-to-MIDI OpenDAW Pipeline Architecture

This application converts an uploaded 16-bit, 44.1 kHz AIFF mix into a new AIFF stereo bounce generated from MIDI tracks inside an OpenDAW session.

## First Scaffold Goal

The initial implementation is intentionally provider-neutral. Every external service is represented by a TypeScript interface and a mock provider. This lets agents build and test the full workflow before API credentials and exact provider contracts are finalized.

## Pipeline

```text
input AIFF
-> validate format
-> de-reverb split
-> dry-only instrument stem separation
-> instrument identification
-> stem-to-MIDI conversion
-> OpenDAW blank session creation
-> MIDI import and sample-library assignment
-> stereo AIFF bounce
```

## Core Boundaries

- `src/pipeline/types.ts` contains shared contracts for artifacts, provider interfaces, job input, job result, and OpenDAW track plans.
- `src/pipeline/workflow.ts` runs the current sequential pipeline.
- `src/pipeline/naming.ts` normalizes instrument labels and MIDI filenames.
- `src/providers/mock/**` implements deterministic mock providers for local development and test scaffolding.
- Real providers should match the mock providers' behavior at the interface boundary.

## Provider Interfaces

- `DereverbProvider`: input AIFF to dry-only and reverb-only AIFF tracks.
- `InstrumentStemSeparationProvider`: dry-only AIFF to individual instrument stems.
- `InstrumentIdentificationProvider`: instrument stem audio to normalized labels.
- `MidiConversionProvider`: labeled stems to MIDI files with instrument names preserved.
- `OpenDawProvider`: blank session creation, MIDI import, sample library assignment, and stereo bounce.

The Phase 0 provider contract is captured in `contracts/external-audio-services.openapi.yaml` and summarized in `docs/architecture/phase-0-provider-contracts.md`.

## OpenDAW Integration Notes

Phase 0 findings are captured in `docs/architecture/opendaw-integration-spike.md`. The OpenDAW integration agent should treat runtime proof as the next spike until these operations are proven together in the selected runtime:

- Create a blank session programmatically.
- Create tracks from a MIDI file list.
- Assign a sample playback device or library from an instrument label.
- Render or export a stereo 16-bit, 44.1 kHz AIFF bounce.

If the SDK cannot render headlessly in Node, the adapter should expose that limitation and provide a browser-worker or deterministic mock/export fallback for the demo path.
