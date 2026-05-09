import type { BounceResult, MidiArtifact, OpenDawProvider, OpenDawSessionArtifact, OpenDawSessionResult } from "../../pipeline/types.ts";
import { createMockAudioArtifact, createMockSessionArtifact, finalOutputWavFormat } from "./artifacts.ts";

export class MockOpenDawProvider implements OpenDawProvider {
  async createSession(context: Parameters<OpenDawProvider["createSession"]>[0]): Promise<OpenDawSessionArtifact> {
    return createMockSessionArtifact(context.jobId, 0);
  }

  async importMidiTracks(
    session: OpenDawSessionArtifact,
    midiFiles: MidiArtifact[]
  ): Promise<OpenDawSessionResult> {
    const tracks = midiFiles.map((midiFile) => ({
      trackName: midiFile.instrument.canonicalName,
      midiFile,
      sampleLibraryKey: midiFile.instrument.sampleLibraryKey ?? "general-midi-fallback"
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
