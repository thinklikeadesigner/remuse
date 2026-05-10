import type { BounceResult, MidiArtifact, OpenDawProvider, OpenDawSessionArtifact, OpenDawSessionResult, SampleLibraryAssignment } from "../../pipeline/types.ts";
import { createMockAudioArtifact, createMockSessionArtifact, finalOutputWavFormat } from "./artifacts.ts";

function mockSampleLibrary(midiFile: MidiArtifact): SampleLibraryAssignment {
  return {
    key: midiFile.instrument.sampleLibraryKey ?? "general-midi-fallback",
    displayName: midiFile.instrument.sampleLibraryKey ?? "General MIDI Fallback",
    family: midiFile.instrument.family,
    engine: midiFile.instrument.sampleLibraryKey === undefined ? "general-midi-fallback" : "opendaw-soundfont",
    ...(midiFile.instrument.midiProgram === undefined ? {} : { midiProgram: midiFile.instrument.midiProgram }),
    ...(midiFile.instrument.sampleLibraryKey === undefined ? { fallbackReason: "Instrument did not include a sample library key." } : {})
  };
}

export class MockOpenDawProvider implements OpenDawProvider {
  async createSession(context: Parameters<OpenDawProvider["createSession"]>[0]): Promise<OpenDawSessionArtifact> {
    return createMockSessionArtifact(context.jobId, 0);
  }

  async importMidiTracks(
    session: OpenDawSessionArtifact,
    midiFiles: MidiArtifact[]
  ): Promise<OpenDawSessionResult> {
    const tracks = midiFiles.map((midiFile, index) => ({
      trackId: `${session.sessionId}-track-${String(index + 1).padStart(2, "0")}`,
      trackIndex: index,
      trackName: midiFile.instrument.canonicalName,
      midiFile,
      sampleLibraryKey: midiFile.instrument.sampleLibraryKey ?? "general-midi-fallback",
      sampleLibrary: mockSampleLibrary(midiFile),
      sampleLibraryLoaded: true
    }));

    return {
      session: {
        ...session,
        trackCount: tracks.length,
        sourceArtifactIds: midiFiles.map((file) => file.id),
        metadata: {
          ...session.metadata,
          provider: "mock-opendaw",
          importedMidiFiles: midiFiles.length
        }
      },
      tracks
    };
  }

  async bounceSession(session: OpenDawSessionArtifact): Promise<BounceResult> {
    const bounce = createMockAudioArtifact({
      kind: "stereo-bounce",
      filename: `${session.filename.replace(/\.opendaw$/i, "")}.bounce.wav`,
      sourceArtifactIds: [session.id],
      format: finalOutputWavFormat,
      metadata: {
        provider: "mock-opendaw",
        renderMode: "offline-bounce"
      }
    });

    return { bounce, session };
  }
}
