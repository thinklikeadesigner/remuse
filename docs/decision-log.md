# Decision Log

| Time | Decision | Owner | Notes |
| --- | --- | --- | --- |
| TBD | Initial orchestration model created. | sprint-orchestrator | One orchestrator, parallel development/testing lanes, and dedicated review lanes. |
| 2026-05-09 | Phase 0 OpenDAW spike completed. | master-orchestrator | Use `@opendaw/studio-core`, `@opendaw/studio-adapters`, `@opendaw/studio-boxes`, and `@opendaw/lib-midi` behind `OpenDawProvider`; keep runtime proof as next OpenDAW task. |
| 2026-05-09 | External provider contract normalized. | master-orchestrator | Use async job contracts with signed artifact URLs, checksums, idempotency keys, and structured errors for de-reverb, stem separation, instrument identification, and MIDI conversion. |
| 2026-05-09 | Audio format policy changed to WAV. | master-orchestrator | Use WAV PCM 16-bit, 44.1 kHz as the working/provider/final format, while accepting 24-bit WAV inputs when provided. |
| 2026-05-09 | Phase 1 backend skeleton uses local file persistence. | workflow-engine-dev | Store raw canonical WAV inputs under `var/remuse/artifacts`, job records under `var/remuse/jobs`, and keep provider execution behind `PipelineProviders` for easy mock-to-real replacement. |
| 2026-05-09 | Select MVSEP as first de-reverb and stem-separation provider. | master-orchestrator | Build Phase 2 around MVSEP `sep_type=22` for de-reverb and `sep_type=63` for instrument stems, with AudioShake as the production-grade stem backup and Neural Analog as the de-reverb backup. |
| 2026-05-09 | MVSEP provider lane is opt-in behind `REMUSE_PROVIDER=mvsep`. | audio-provider-dev | Keep mocks as the default local path; real MVSEP mode requires `MVSEP_API_TOKEN`, persists downloaded provider artifacts, and requests MVSEP WAV 16-bit output as the working format. |
| 2026-05-09 | MVSEP de-reverb uses local residual fallback. | audio-provider-dev | Live MVSEP testing returned dry/no-reverb without a native reverb-only artifact, so Remuse renders `reverbOnly` as `original - dryOnly` and persists it with providerNative=false. |
| 2026-05-09 | MVSEP de-reverb model fixed to FoxJoy MDX23C. | audio-provider-dev | Use `sep_type=22`, `add_opt1=0`, and `add_opt2=1` for Reverb Removal (noreverb) instead of the MVSEP default anvuew BSRoformer model. |
