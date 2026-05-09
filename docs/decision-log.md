# Decision Log

| Time | Decision | Owner | Notes |
| --- | --- | --- | --- |
| TBD | Initial orchestration model created. | sprint-orchestrator | One orchestrator, parallel development/testing lanes, and dedicated review lanes. |
| 2026-05-09 | Phase 0 OpenDAW spike completed. | master-orchestrator | Use `@opendaw/studio-core`, `@opendaw/studio-adapters`, `@opendaw/studio-boxes`, and `@opendaw/lib-midi` behind `OpenDawProvider`; keep runtime proof as next OpenDAW task. |
| 2026-05-09 | External provider contract normalized. | master-orchestrator | Use async job contracts with signed artifact URLs, checksums, idempotency keys, and structured errors for de-reverb, stem separation, instrument identification, and MIDI conversion. |
| 2026-05-09 | Audio format policy changed to WAV. | master-orchestrator | Use WAV PCM 24-bit, 44.1 kHz as the internal/provider interchange format and WAV PCM 16-bit, 44.1 kHz as the default final output. |
| 2026-05-09 | Phase 1 backend skeleton uses local file persistence. | workflow-engine-dev | Store raw canonical WAV inputs under `var/remuse/artifacts`, job records under `var/remuse/jobs`, and keep provider execution behind `PipelineProviders` for easy mock-to-real replacement. |
