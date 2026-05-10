# Product Brief

## Product

ReMuse converts a user-provided WAV recording into a MIDI-driven re-orchestration workflow. The demo experience lets a user upload audio, review separated stems, choose instruments, and hear a final WAV bounce rendered from MIDI tracks.

## Primary User

A musician, producer, or hackathon judge who wants to see how an audio recording can be decomposed into stems, converted into editable MIDI-like musical structure, and rendered back through sample libraries.

## Core Demo Story

1. The user opens the landing page and sees the ReMuse demo video.
2. The user drops a WAV file onto the upload area.
3. ReMuse validates the file and sends it through stem separation.
4. ReMuse opens Manual Review when all stems are ready.
5. The user listens to the full audio for every stem, assigns instruments, and discards bad duplicates.
6. ReMuse converts accepted stems to MIDI.
7. ReMuse assembles a reproducible session plan and maps each track to a SoundFont instrument.
8. ReMuse renders and plays a final 16-bit/44.1 kHz WAV bounce.

## Current Non-Goals

- Perfect commercial-grade stem separation.
- Perfect drum/percussion MIDI extraction.
- Full OpenDAW engine rendering in the server runtime.
- Cloud-hosted artifact storage or production authentication.
- Supporting arbitrary input formats beyond WAV PCM 16-bit or 24-bit, 44.1 kHz.

## Demo Success Criteria

- WAV upload works from the landing page.
- Job status is visible and understandable.
- Manual Review lets the user correct every stem before MIDI conversion.
- Final bounce is playable on the landing page.
- Diagnostic per-track renders can be enabled when using FluidSynth.
- The same flow can run with mocks, MVSEP, LALAL.AI, Basic Pitch, and FluidSynth depending on available local credentials/tools.
