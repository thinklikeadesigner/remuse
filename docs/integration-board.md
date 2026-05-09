# Integration Board

| Batch | Agent Branches | Status | Required Reviews | Risks |
| --- | --- | --- | --- | --- |
| 1 | TBD | Planned | code-review | TBD |
| phase-0 | `main` | Ready for review | architecture-review, security-privacy-review, code-review | OpenDAW headless rendering still needs runtime proof; provider contracts need real vendor mapping. |
| phase-1 | `main` | In progress | code-review, integration-test-agent | Mock backend now validates WAV upload, stores artifacts/state, and runs provider adapters; real provider auth and artifact transfer remain future risks. |
| phase-2 | `main` | In progress | audio-provider-dev, integration-test-agent, code-review | MVSEP response shape needs live-token validation, especially whether de-reverb returns a reverb-only artifact. |
