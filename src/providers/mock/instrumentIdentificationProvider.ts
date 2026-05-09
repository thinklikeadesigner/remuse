import type { InstrumentIdentificationProvider, InstrumentStem } from "../../pipeline/types.ts";
import { inferInstrumentLabelFromName } from "../../pipeline/naming.ts";

export class MockInstrumentIdentificationProvider implements InstrumentIdentificationProvider {
  async identifyInstruments(stems: InstrumentStem[]): Promise<InstrumentStem[]> {
    return stems.map((item) => ({
      ...item,
      label: {
        ...inferInstrumentLabelFromName(item.stem.filename, item.stem.id),
        method: "mock",
        confidence: 0.94
      }
    }));
  }
}
