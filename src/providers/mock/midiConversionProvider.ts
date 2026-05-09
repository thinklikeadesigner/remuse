import type { MidiArtifact, MidiConversionProvider, MidiConversionResult } from "../../pipeline/types.ts";
import { makeMidiFilename } from "../../pipeline/naming.ts";
import { createMockArtifactUri, nextId } from "./artifacts.ts";

export class MockMidiConversionProvider implements MidiConversionProvider {
  async convertStemsToMidi(
    stems: Parameters<MidiConversionProvider["convertStemsToMidi"]>[0],
    context: Parameters<MidiConversionProvider["convertStemsToMidi"]>[1]
  ): Promise<MidiConversionResult> {
    const midiFiles: MidiArtifact[] = stems.map((item, index) => {
      const filename = makeMidiFilename(context.jobId, item.label, index);

      return {
        id: nextId("midi"),
        kind: "midi",
        uri: createMockArtifactUri("midi", filename),
        filename,
        sourceArtifactIds: [item.stem.id],
        metadata: {
          provider: "mock-midi-conversion",
          sourceStem: item.stem.filename
        },
        instrument: item.label
      };
    });

    return { midiFiles };
  }
}
