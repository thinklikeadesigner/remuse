import type { DereverbProvider, DereverbResult } from "../../pipeline/types.ts";
import { createMockAudioArtifact } from "./artifacts.ts";

export class MockDereverbProvider implements DereverbProvider {
  async splitReverb(input: Parameters<DereverbProvider["splitReverb"]>[0]): Promise<DereverbResult> {
    const baseName = input.filename.replace(/\.aiff?$/i, "");

    return {
      dryOnly: createMockAudioArtifact({
        kind: "dry-audio",
        filename: `${baseName}.dry-only.aiff`,
        sourceArtifactIds: [input.id],
        durationSeconds: input.durationSeconds,
        metadata: {
          provider: "mock-dereverb",
          separation: "dry-only"
        }
      }),
      reverbOnly: createMockAudioArtifact({
        kind: "reverb-audio",
        filename: `${baseName}.reverb-only.aiff`,
        sourceArtifactIds: [input.id],
        durationSeconds: input.durationSeconds,
        metadata: {
          provider: "mock-dereverb",
          separation: "reverb-only"
        }
      })
    };
  }
}
