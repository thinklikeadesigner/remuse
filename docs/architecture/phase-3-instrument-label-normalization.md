# Phase 3: Instrument Label Normalization And Manual Review

## Decision

ReMuse trusts provider-native stem labels and provider output filenames as the first instrument signal. It normalizes those values into the ReMuse taxonomy and does not run a separate AI/audio classifier.

Manual Review is now mandatory for every separated stem. Provider labels are defaults, not final truth. The user can relabel any stem, discard duplicates or useless stems, and then submit one complete review.

## Flow

```text
provider stem artifact
-> provider label and filename suffix
-> normalized ReMuse label default
-> full-stem Manual Review
-> accepted/discarded review result
-> renamed accepted stem artifact
-> MIDI filename and sample-library key
```

## Provider Stem Inventories

### MVSEP BS Roformer SW

The active MVSEP stem path uses `BS Roformer SW`, `sep_type=63`, with no algorithm-specific `add_opt` fields. ReMuse expects at most seven stem artifacts:

- `vocals`
- `instrumental`
- `bass`
- `drums`
- `guitar`
- `piano`
- `other`

### LALAL.AI Multistem

The LALAL.AI path uses `/api/v1/split/multistem/` with WAV output. By default ReMuse requests:

- `vocals`
- `drum`
- `piano`
- `bass`
- `electric_guitar`
- `acoustic_guitar`

LALAL.AI may also return `no_multistem`; ReMuse normalizes that remainder to `other`.

## Manual Review Options

The dropdown contains both provider stem categories and additional manual categories:

- Lead Vocals
- Backing Vocals
- Drums
- Bass
- Guitar
- Piano
- Brass
- Woodwinds
- Strings
- Percussion
- Organ
- Synthesizer

Generic provider `vocals` defaults to `Lead Vocals`. There is intentionally no generic `Vocals` option in the dropdown.

## Review Behavior

When stem separation completes, `PipelineJobRunner` creates a review request for every stem and stores a `review-clip` artifact. Despite the historical artifact kind name, this review audio is now the full stem, not a five-second excerpt.

The review page:

- Plays the full stem audio.
- Shows the provider label.
- Lets the user assign or change the instrument.
- Lets the user discard the stem.
- Keeps choices editable until `Complete Review`.
- Enables `Complete Review` only after every stem is assigned or discarded.
- Asks for confirmation if all stems are discarded.

On completion:

- Accepted stems get `method: "manual"` labels.
- Accepted stem files are physically renamed to include the selected instrument.
- Discarded stems are removed from the active MIDI workflow.
- If every stem is discarded, the job becomes `cancelled`.

## API Surface

- `GET /v1/jobs/<job-id>` includes `pendingInstrumentReviews` when a job is waiting for user input.
- `GET /review/<job-id>` shows live progress and the Manual Review UI.
- `GET /v1/jobs/<job-id>/review-requests` returns pending review requests.
- `GET /v1/jobs/<job-id>/review-requests/<review-id>/clip` streams the full-stem WAV review audio.
- `POST /review/<job-id>/complete` completes the browser review form and resumes or cancels the job.
- `POST /v1/jobs/<job-id>/review-requests/<review-id>` remains available as a JSON draft/update endpoint but is not the primary UI path.

## Implementation Notes

- `src/pipeline/naming.ts` contains inference rules, manual review options, and default provider-to-manual mappings.
- `src/audio/reviewClip.ts` creates full-stem review audio and retains the older five-second helper for tests/future use.
- `src/jobs/pipelineJobRunner.ts` manages `awaiting-review` pause state and review request creation.
- `src/server/http.ts` applies the completed review, renames accepted artifacts, resumes the pipeline, or records `cancelled`.
- `src/providers/mvsep/normalization.ts` delegates MVSEP labels to the shared inference helper.
- `ProviderNativeInstrumentIdentificationProvider` preserves labels already produced during stem separation and infers missing labels from metadata or filenames.
