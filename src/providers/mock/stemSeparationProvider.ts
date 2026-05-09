import type { InstrumentStem, InstrumentStemSeparationProvider } from "../../pipeline/types.ts";
import { createMockAudioArtifact } from "./artifacts.ts";

const mockStemNames = ["drums", "electric-bass", "clean-guitar", "piano"];

export class MockInstrumentStemSeparationProvider implements InstrumentStemSeparationProvider {
  async separateInstruments(
    dryOnly: Parameters<InstrumentStemSeparationProvider["separateInstruments"]>[0]
  ): Promise<InstrumentStem[]> {
    const baseName = dryOnly.filename.replace(/\.aiff?$/i, "");

    return mockStemNames.map((stemName, index) => ({
      stem: createMockAudioArtifact({
        kind: "instrument-stem",
        filename: `${baseName}.stem-${String(index + 1).padStart(2, "0")}.${stemName}.aiff`,
        sourceArtifactIds: [dryOnly.id],
        durationSeconds: dryOnly.durationSeconds,
        metadata: {
          provider: "mock-instrument-stem-separation",
          stemIndex: index,
          stemHint: stemName
        }
      })
    }));
  }
}
