# Integration Board

| Batch | Branches | Status | Required Reviews | Notes/Risks |
| --- | --- | --- | --- | --- |
| phase-0 | `main` | Integrated | architecture-review, code-review | Provider contracts and OpenDAW spike recorded. Full OpenDAW engine render remains a research path. |
| phase-1 | `main` | Integrated | code-review, integration-test-agent | Job backend, file persistence, upload/status/result APIs, and review/status page are implemented. |
| phase-2 | `main` | Integrated | audio-provider-dev, integration-test-agent, code-review | MVSEP and LALAL.AI stem providers are available. De-reverb adapter exists but is bypassed in the main workflow. |
| phase-3 | `main` | Integrated | workflow-engine-dev, frontend-dev, code-review | Manual Review covers all stems, supports relabel/discard, renames accepted artifacts, and can cancel all-discard jobs. |
| phase-4 | `main` | Integrated | workflow-engine-dev, integration-test-agent | Basic Pitch and HTTP MIDI adapters are implemented. Basic Pitch requires file-backed stems. |
| phase-5 | `main` | Integrated | opendaw-integration-dev, integration-test-agent | Local session provider persists `.opendaw.json`; final bounce can use preview render or FluidSynth. |
| landing-page-video | `main` | Integrated | frontend-dev | Demo MP4 is served from `/output/` with byte-range support. |

## Open Follow-Ups

- Decide whether to re-enable de-reverb after comparing separation quality with and without it.
- Improve stem deduplication and music-aware stem selection before MIDI conversion.
- Add a drum/percussion-specific MIDI provider or postprocessor if drum MIDI quality becomes demo-critical.
- Continue OpenDAW engine-render research behind `OpenDawProvider` without blocking the FluidSynth render path.
