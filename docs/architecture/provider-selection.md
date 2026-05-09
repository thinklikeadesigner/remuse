# Provider Selection: De-Reverb and Stem Separation

Date: 2026-05-09

## Decision

Use MVSEP as the first real provider for Phase 2.

- De-reverb: MVSEP `Reverb Removal (noreverb)` model, `sep_type=22`.
- Instrument separation: MVSEP `BS Roformer SW (vocals, bass, drums, guitar, piano, other)`, `sep_type=63`.
- Output target: request MVSEP `output_format=1`, WAV 16-bit.
- Demo/privacy setting: always set `is_demo=false`.

Phase 2 implementation note: WAV 16-bit is acceptable throughout the application, so no local conversion back to 24-bit WAV is needed.

This keeps Phase 2 fast because one adapter family can cover both early audio-processing steps. MVSEP also exposes OpenAPI documentation, API examples, webhooks, direct upload or URL input, a detailed algorithm catalog, and Premium concurrency for queue-sensitive work.

## Validation Needed During Adapter Build

MVSEP's de-reverb model is documented as a reverb-removal separation type, but the docs do not clearly guarantee both `dryOnly` and `reverbOnly` artifacts for every model response. The Phase 2 adapter should inspect a live response before locking behavior.

Live MVSEP testing confirmed this can happen. Remuse computes `reverbOnly` locally as a phase-aligned residual from `original - dryOnly`, records `providerNative=false` on that artifact, and keeps the external provider contract unchanged.

## Backup Providers

### Stem Separation Backup: AudioShake

AudioShake is the best production-grade backup for instrument separation. Its current developer API supports task-based extraction with one target per stem and WAV output, and its model catalog covers vocals, drums, bass, guitar, electric/acoustic guitar, piano, keys, strings, wind, and other. It does not solve the full-mix de-reverb step, so it should be a backup for Step 3 rather than the primary all-in provider.

### De-Reverb Backup: Neural Analog

Neural Analog is the most promising de-reverb backup. Its API has direct file upload, async status polling, downloads, and a `create-stems` endpoint with a `dereverb` preset and 24-bit WAV output. Use it if MVSEP de-reverb either does not expose a usable reverb residual or queues too slowly for the demo.

### General Stem Backup: LALAL.AI

LALAL.AI has a clean API shape for upload, split, check, and download, plus multi-stem separation. Its de-reverb is documented as voice/vocal-only, so it is not a good primary provider for Remuse's full-mix de-reverb requirement.

### Not Chosen

- Moises: useful stem-separation API, but current public docs appear legacy/staged and do not cover de-reverb.
- AudioPod AI: very easy stem API with attractive per-minute pricing, but it is less proven for this workflow and does not cover de-reverb.
- Dolby Enhance: async audio enhancement, not instrument-stem separation and not a dry/reverb stem split.

## Sources

- MVSEP API: https://mvsep.com/en/full_api
- MVSEP plans and concurrency: https://mvsep.com/en/plans
- AudioShake instrument separation: https://developer.audioshake.ai/separate-stems
- AudioShake models and formats: https://developer.audioshake.ai/models
- Neural Analog API docs: https://neuralanalog.com/api-docs
- LALAL.AI API OpenAPI: https://www.lalal.ai/api/v1/openapi.json
- LALAL.AI Echo & Reverb Remover limitation: https://www.lalal.ai/echo-reverb-remover/
- Moises developer stem separation: https://developer-legacy-stage.moises.ai/docs/media/stems-separation
- AudioPod AI stem API: https://docs.audiopod.ai/api-reference/stem-splitter
