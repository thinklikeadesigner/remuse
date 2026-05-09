# Phase 0 OpenDAW Integration Spike

Date: 2026-05-09

## Sources Checked

- openDAW repository: `https://github.com/andremichelle/openDAW`
- Published npm package metadata:
  - `@opendaw/studio-sdk@0.0.139`
  - `@opendaw/studio-core@0.0.137`
  - `@opendaw/studio-adapters@0.0.106`
  - `@opendaw/lib-midi@0.0.63`
  - `@opendaw/studio-boxes@0.0.88`

The package declarations were inspected from npm tarballs downloaded into `/private/tmp/remuse-opendaw-spike`.

## Summary

OpenDAW has usable lower-level TypeScript APIs for project/session creation, note tracks, MIDI parsing/export, soundfont-backed instruments, and offline rendering. The published `@opendaw/studio-sdk` package is currently a thin meta package; the implementation work should import directly from `@opendaw/studio-core`, `@opendaw/studio-adapters`, `@opendaw/studio-boxes`, and `@opendaw/lib-midi`.

The biggest unresolved risk is not whether these concepts exist. They do. The risk is whether the whole flow can run headlessly inside our Node/server runtime without browser-only APIs, workers, or AudioContext constraints. We should keep the OpenDAW adapter behind `OpenDawProvider` until that runtime proof is complete.

## Confirmed Public Surfaces

| Capability | Status | Evidence |
| --- | --- | --- |
| Create blank session/project | Confirmed | `Project.new(env, options?)` and `ProjectSkeleton.empty(...)` exist. |
| Load/save OpenDAW project | Confirmed | `Project.load`, `Project.loadAnyVersion`, `Project.fromSkeleton`, and `project.toArrayBuffer()` exist. |
| Create note tracks | Confirmed | `ProjectApi.createNoteTrack(audioUnitBox, insertIndex?)` exists. |
| Create note clips/regions/events | Confirmed | `ProjectApi.createNoteClip`, `createNoteRegion`, and `createNoteEvent` exist. |
| MIDI file decode | Confirmed | `@opendaw/lib-midi` exposes `MidiFile.decoder(buffer).decode()`. |
| MIDI file export | Confirmed | `NoteMidiExport.fromCollection(...)` and `ProjectApi.exportMIDI(...)` exist. |
| Soundfont sample-library path | Confirmed | `InstrumentFactories.Soundfont`, `SoundfontDeviceBoxAdapter`, `OpenSoundfontAPI`, and `SoundfontLoaderManager` exist. |
| OpenDAW-hosted soundfont API | Confirmed | `OpenSoundfontAPI.ApiRoot` is `https://api.opendaw.studio/soundfonts`; `FileRoot` is `https://assets.opendaw.studio/soundfonts`. |
| Offline audio render | Confirmed | `OfflineEngineRenderer.start(...)` returns `AudioData`; `AudioOfflineRenderer.start(...)` exists but is deprecated. |
| WAV export helper | Confirmed | `AudioWavExport` exists. |
| Final WAV export path | Confirmed | `AudioWavExport` exists and matches the selected default output format. |

## Proposed OpenDAW Adapter Flow

1. Build a `ProjectEnv` with AudioContext, worklets, sample service, soundfont service, sample manager, and soundfont manager.
2. Create a blank project with `Project.new(env, { noDefaultUser: true })`.
3. For each MIDI artifact:
   - Decode MIDI with `MidiFile.decoder(arrayBuffer).decode()`.
   - Create or select a soundfont instrument using `InstrumentFactories.Soundfont`.
   - Create a note track with `project.api.createNoteTrack(...)`.
   - Translate MIDI note events into OpenDAW note events using `project.api.createNoteEvent(...)`.
   - Wrap note events in a note clip/region with `createNoteClip` / `createNoteRegion`.
4. Save the session with `project.toArrayBuffer()`.
5. Render with `OfflineEngineRenderer.start(project, Option.None, progress, abortSignal, 44100)`.
6. Encode final output as stereo WAV PCM 16-bit, 44.1 kHz in our adapter layer.

## Sample Library Mapping

Use SoundFont as the first implementation target because it has the clearest public surface in OpenDAW:

| Remuse family | Initial OpenDAW target |
| --- | --- |
| drums | Soundfont percussion preset, fallback `studio-drums` key |
| bass | Soundfont bass preset |
| guitar | Soundfont clean guitar preset |
| keys | Soundfont piano/electric piano preset |
| strings | Soundfont strings preset |
| brass | Soundfont brass preset |
| woodwinds | Soundfont woodwind preset |
| synth | Soundfont synth preset |
| percussion | Soundfont percussion preset |
| vocal | Fallback synth/vocal pad preset until a better library is available |
| unknown | General MIDI piano fallback |

The adapter should store both our normalized `sampleLibraryKey` and the OpenDAW soundfont UUID/preset index selected for playback.

## Headless Runtime Risks

- `ProjectEnv` requires an `AudioContext`. Native Node does not provide this without a polyfill or browser runtime.
- `OfflineEngineRenderer.install(url)` and the exported `offline-engine.js` imply worker URL setup.
- Soundfont/sample loading may call OpenDAW-hosted APIs and asset URLs unless we configure local services.
- OpenDAW licensing is dual AGPL/commercial at the SDK package level; product distribution or SaaS use needs a legal decision before shipping a closed-source service.

## Decisions

- Use OpenDAW as an isolated adapter behind `OpenDawProvider`.
- Target SoundFont-backed playback first.
- Use WAV PCM 16-bit, 44.1 kHz as the default final output format.
- Keep a mock OpenDAW provider until a browser/headless runtime proof passes.
- Add a follow-up proof script owned by `opendaw-integration-dev` that imports OpenDAW packages, creates a project, creates one soundfont note track from one MIDI file, renders, and records runtime constraints.

## Open Questions

- Which runtime should own OpenDAW rendering: browser worker, Playwright-controlled browser, Electron, or Node with AudioContext/worklet polyfills?
- Which soundfont catalog UUIDs and preset indexes map best to the Remuse instrument taxonomy?
- Can the OpenDAW-hosted soundfont assets be used in the final deployment, or do we need bundled/licensed sample libraries?
- What is the cleanest path from `AudioData` to WAV PCM 16-bit, 44.1 kHz using OpenDAW's `AudioWavExport` or a small local encoder?
