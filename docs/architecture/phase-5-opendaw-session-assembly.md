# Phase 5 OpenDAW Session Assembly

Date: 2026-05-09

## Goal

Create an OpenDAW session artifact from converted MIDI tracks, assign each track to a sample library based on the normalized instrument label, and produce a stereo WAV PCM 16-bit, 44.1 kHz bounce artifact.

## Implementation

Phase 5 adds `LocalOpenDawSessionProvider` at `src/providers/opendaw/localSessionProvider.ts`.

The provider is file-backed and deterministic. It does not yet claim to be a full headless OpenDAW SDK render, because the Phase 0 spike found unresolved runtime risks around AudioContext, workers, and soundfont asset loading in Node. Instead, it implements the full ReMuse provider boundary in a way that can be replaced by the real renderer later:

1. Create a blank session document.
2. Create one track per MIDI artifact.
3. Preserve MIDI artifact references on each track.
4. Map normalized instrument labels to sample-library assignments.
5. Mark sample libraries as loaded in the session plan.
6. Save a reproducible `.opendaw.json` session artifact.
7. Render a valid stereo WAV PCM 16-bit, 44.1 kHz preview bounce.

The job server uses this provider by default through:

```bash
REMUSE_OPENDAW_PROVIDER=local-session
```

Use `REMUSE_OPENDAW_PROVIDER=mock` to return to the older mock-only OpenDAW provider.

## Session Artifact

The persisted session artifact is a stable JSON document with schema version `remuse.opendaw-session.v1`. It records:

- Job ID and deterministic session ID.
- Target output format: WAV PCM 16-bit, 44.1 kHz stereo.
- Ordered track list.
- MIDI artifact ID, filename, URI, and normalized instrument per track.
- Sample library assignment per track.
- Whether the sample library was loaded for that track.
- Render mode and current headless-renderer status.

The artifact is saved under the job's `opendaw-session` stage and returned as the pipeline's `opendaw.session`.

## Sample Library Mapping

Sample libraries are selected in `src/providers/opendaw/sampleLibraries.ts`.

Initial mappings:

| ReMuse key | OpenDAW target |
| --- | --- |
| `lead-vocal-synth` | General MIDI Voice Oohs |
| `backing-vocal-synth` | General MIDI Synth Voice |
| `vocal-synth` | General MIDI Voice Oohs |
| `studio-drums` | General MIDI Standard Drum Kit |
| `electric-bass` | General MIDI Acoustic Bass |
| `clean-electric-guitar` | General MIDI Clean Electric Guitar |
| `grand-piano` | General MIDI Acoustic Grand Piano |
| `tonewheel-organ` | General MIDI Drawbar Organ |
| `studio-strings` | General MIDI String Ensemble |
| `studio-winds` | General MIDI Flute |
| `analog-synth` | General MIDI Square Lead |
| `world-percussion` | General MIDI Standard Drum Kit |

Missing or unknown keys fall back to `general-midi-fallback` and record a fallback reason.

## Bounce Artifact

The local provider writes a valid WAV file through `renderSessionPreviewBounceWav`. The preview bounce is deterministic and derived from the assembled track plan, but it is not yet a true OpenDAW audio-engine render of the MIDI performances. Metadata marks this explicitly:

- `provider`: `local-opendaw-session`.
- `renderMode`: `deterministic-preview`.
- `headlessOpenDawRenderer`: `false`.
- `targetFormat`: `wav-pcm-16-44100-stereo`.
- `trackCount`: number of assembled MIDI tracks.

This gives ReMuse a real artifact to persist, download, validate, and pass through the rest of the workflow while keeping the real SDK-backed renderer isolated behind `OpenDawProvider`.

## FluidSynth Renderer

ReMuse can now use FluidSynth as the functioning render backend while preserving the OpenDAW-style session artifact and provider boundary.

Enable it with:

```bash
REMUSE_OPENDAW_RENDERER=fluidsynth
REMUSE_FLUIDSYNTH_SOUNDFONT=/absolute/path/to/general-midi.sf2
```

Optional settings:

- `REMUSE_FLUIDSYNTH_COMMAND`: path/name of the `fluidsynth` executable. Defaults to `fluidsynth`.
- `REMUSE_FLUIDSYNTH_TIMEOUT_MS`: render timeout. Defaults to five minutes.

When this mode is active, `LocalOpenDawSessionProvider.bounceSession(...)`:

1. Reads the reproducible session plan.
2. Loads each file-backed MIDI artifact.
3. Builds a merged type-1 Standard MIDI file with one render track per ReMuse MIDI artifact.
4. Rewrites each render track to a stable MIDI channel.
5. Injects program changes from the mapped sample-library assignment.
6. Runs FluidSynth with `-T wav -O s16 -r 44100`.
7. Persists the returned WAV as the final `stereo-bounce` artifact.

The current FluidSynth renderer assumes one configured SoundFont file for the whole render. That keeps the first production path simple and robust. More advanced per-instrument SoundFont routing can be added later if ReMuse needs specialty libraries beyond a General MIDI `.sf2`.

## Acceptance Coverage

Tests cover:

- OpenDAW session artifact persistence.
- Instrument-to-sample-library mapping and fallback behavior.
- Blank session creation.
- MIDI track import into a reproducible session artifact.
- Sample-library loading metadata per track.
- Stereo WAV PCM 16-bit, 44.1 kHz preview bounce generation.
- FluidSynth command rendering through a fake executable, including generated render settings and persisted WAV validation.
- Provider factory wiring for `REMUSE_OPENDAW_PROVIDER=local-session` and `REMUSE_OPENDAW_PROVIDER=mock`.

## Headless Browser Harness

`scripts/opendawBrowserHarness.mjs` is the current OpenDAW runtime proof. It bundles the OpenDAW browser packages with esbuild, serves the bundle locally, launches Chromium through Playwright, and calls the harness through `page.evaluate()`.

Run it with a local Chrome binary if Playwright's bundled Chromium is not installed:

```bash
npm run opendaw:browser-spike -- --browser-executable "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

The proof now completes these steps in a headless browser:

1. Creates a blank `StudioCore.Project`.
2. Creates one OpenDAW soundfont instrument track per MIDI input.
3. Decodes each MIDI file with `@opendaw/lib-midi` and imports parsed note events into OpenDAW note regions.
4. Maps normalized ReMuse instruments to OpenDAW soundfont/preset assignments.
5. Loads each mapped sample-library target into the respective MIDI track through OpenDAW `SoundfontDeviceBox` attachments and preset indexes.
6. Saves both a deterministic session-plan JSON artifact and a native OpenDAW project artifact from `project.toArrayBuffer()`.
7. Writes a stereo WAV PCM 16-bit, 44.1 kHz bounce from the assembled note plan using the browser `OfflineAudioContext`.

Each run writes artifacts under `var/opendaw-browser-spike/<timestamp>/session/`:

- `remuse-headless-opendaw-session.plan.json`
- `remuse-headless-opendaw-project.opendaw`
- `remuse-headless-opendaw-bounce.wav`
- `remuse-headless-opendaw-proof-report.json`

The remaining gap is the final render engine. The harness creates and serializes a real OpenDAW project, but the WAV bounce is still a deterministic browser preview renderer rather than `OfflineEngineRenderer.start(...)`. The next OpenDAW-specific task is to serve/install OpenDAW's worker and worklet assets in the harness, then replace the preview bounce with the actual OpenDAW offline engine output.
