# Phase 0 External Provider Contracts

Date: 2026-05-09

## Contract Files

- Machine-readable OpenAPI contract: `contracts/external-audio-services.openapi.yaml`
- TypeScript request/response contract: `src/providers/contracts/externalAudioContracts.ts`

## Contract Strategy

The external provider APIs are intentionally normalized into one Remuse-facing contract. Vendor adapters can translate from each vendor's native API into this contract, but the workflow engine should only depend on:

- Async job creation.
- Pollable job status.
- Signed artifact URLs.
- Stable SHA-256 checksums.
- Explicit media/format metadata.
- Structured retryable/non-retryable errors.

This keeps the workflow stable if we swap de-reverb, stem separation, or MIDI conversion vendors.

## Shared Rules

- All audio input to the first step must be WAV PCM 16-bit or 24-bit, 44.1 kHz.
- Intermediate provider outputs should remain WAV PCM 16-bit, 44.1 kHz unless a provider adapter records a justified exception.
- Remuse uses stereo WAV PCM 16-bit, 44.1 kHz as the working and final audio format.
- Provider input artifacts are signed HTTPS URLs readable for at least 30 minutes.
- Every provider call uses an `Idempotency-Key`.
- Each provider result includes `providerJobId`, `status`, and either outputs or a structured `error`.
- `failed` jobs must set `error.retryable`.
- MIDI conversion outputs MIDI format 1 by default.
- MIDI filenames must preserve normalized instrument names, for example `job-7_03_guitar.mid`.

## Provider Contracts

### De-Reverb

Input: WAV PCM 16-bit or 24-bit, 44.1 kHz artifact.

Output:

- `dryOnly`: dry-only track.
- `reverbOnly`: reverb-only track.

Acceptance criteria:

- Output tracks align with original duration.
- Output format is WAV PCM 16-bit, 44.1 kHz and mono/stereo as declared.
- Provider returns hashes for both output artifacts.

### Instrument Stem Separation

Input: dry-only audio artifact.

Output:

- Ordered `stems[]` with `stemIndex`, optional provider-native label, and audio artifact.

Acceptance criteria:

- Empty stem list is invalid for a successful job.
- Stem order must remain stable for downstream label normalization and MIDI conversion.
- Provider-native labels and stem filenames are accepted as the primary instrument source.
- Non-specific provider labels such as `other` and `instrumental` are routed to human review before MIDI conversion.

### MIDI Conversion

Input: ordered stem audio artifacts with labels.

Output:

- `midiFiles[]` keyed by `stemIndex`.
- Each output includes the label and MIDI artifact metadata.

Acceptance criteria:

- MIDI format 1 is the default output format.
- Output filenames preserve the normalized instrument label.
- Each MIDI file must include ticks-per-quarter metadata.

## Implementation Notes

- Real vendor adapters should implement contract tests using recorded provider responses.
- Mock providers should keep parity with these contracts, even when not making HTTP calls.
- The workflow engine should persist both Remuse artifact IDs and provider job IDs for replay/debugging.
- Provider errors should map into Remuse step failure events without leaking secrets or signed URLs to user-facing logs.
