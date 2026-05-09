# Phase 3: Instrument Label Normalization

## Decision

Phase 3 treats provider-native stem labels and provider output filenames as the authoritative signal for instrument labeling.

The current MVSEP stem-separation output already names stems with instrument suffixes such as `vocals`, `lead vocals`, `back vocals`, `drums`, `kick`, `snare`, `toms`, `cymbals`, `bass`, `guitar`, `piano`, `strings`, `wind`, `other`, and `instrum`. ReMuse normalizes those labels into its own instrument taxonomy and does not send stems through a separate AI/audio classifier.

## Flow

```text
MVSEP stem artifact
-> provider label and filename suffix
-> normalized ReMuse instrument label
-> MIDI filename and sample-library key
```

## Ensemble All-In Inventory

The MVSEP Ensemble All-In path is based on the multi-stem ensemble and adds dedicated extraction for guitar, piano, wind, strings, lead/back vocals, and drumsep outputs. ReMuse treats the following provider stem labels as canonical:

- `vocals`
- `lead-vocals`
- `back-vocals`
- `drums`
- `kick`
- `snare`
- `toms`
- `cymbals`
- `bass`
- `guitar`
- `piano`
- `strings`
- `wind`
- `instrumental`
- `other`

## Confidence Policy

- Known provider-native labels receive high confidence, for example `bass` -> `bass` with `0.88`.
- Broad provider buckets such as `other` and `instrum` stay low confidence and create human review requests.
- Filename-only inference is a fallback when no provider label is present.
- The user resolves non-specific labels by listening to a non-silent five-second review clip.

## Fallbacks

- `instrum` and `instrumental` normalize to `instrumental`.
- `other` normalizes to `other`.
- Unknown names are made filename-safe and routed to review when confidence remains low.
- MIDI filenames always use the normalized canonical instrument label.

## Human Review

When ReMuse sees a non-specific stem label, it creates a `review-clip` artifact and pauses the job in `awaiting-review`.

The clip generator scans the stem for audio content and extracts a five-second WAV clip around the first non-silent section. The review options are intentionally limited to instruments not already explicitly separated by MVSEP. `Wind` already covers brass and woodwinds in MVSEP, and `strings` is also separated by Ensemble All-In, so those are not duplicated as manual choices.

- Percussion
- Organ
- Synthesizer

Submitting a selection applies a manual label to the stem and resumes MIDI conversion.

## API Surface

- `GET /v1/jobs/<job-id>` includes `pendingInstrumentReviews` when a job is waiting for user input.
- `GET /v1/jobs/<job-id>/review-requests` returns the same pending review requests.
- `GET /v1/jobs/<job-id>/review-requests/<review-id>/clip` returns the WAV review clip.
- `POST /v1/jobs/<job-id>/review-requests/<review-id>` accepts JSON such as `{ "instrument": "Organ" }` and resumes the job after all pending reviews are resolved.

## Implementation Notes

- `src/pipeline/naming.ts` contains the shared inference rules.
- `src/audio/reviewClip.ts` creates non-silent review clips.
- `src/jobs/pipelineJobRunner.ts` manages `awaiting-review` pause/resume state.
- `src/providers/mvsep/normalization.ts` delegates MVSEP stem labels to the shared inference helper.
- `ProviderNativeInstrumentIdentificationProvider` preserves labels already produced during stem separation and only infers missing labels from provider metadata or filenames.
